/**
 * db.js — Acceso a D1: inserciones por lotes, cierre diario, export e historial.
 *
 * Idea general: el Worker apenas toca filas. Las filas viajan como UN parámetro
 * JSON (`json_each(?)`), así una sentencia inserta miles de filas sin pasar del
 * límite de 100 parámetros de D1 y sin construir SQL en JS, y los agregados y
 * el export los hace SQLite (window functions, json_group_array…): el Worker
 * solo recibe un string ya hecho.
 *
 * Escrituras: todos los UPSERT llevan `WHERE … IS NOT excluded…` para no
 * reescribir filas sin cambios (D1 cuenta filas escritas, no sentencias).
 *
 * Lecturas: `samples` no tiene índice por ts (ver schema.sql). Las consultas
 * por rango de tiempo recorren `games` y buscan por la clave primaria
 * (universe_id, ts) con CROSS JOIN, que obliga a SQLite a usar ese orden.
 */

import {
  CATEGORIES, EMERGING, EXPORT_DAILY_DAYS, EXPORT_SAMPLE_HOURS,
  HISTORY_DAYS, HISTORY_SAMPLE_DAYS, TRACK_MIN_PLAYERS, UNTRACK_AFTER_DAYS,
} from "./config.js";

// ─── Tiempo ───────────────────────────────────────────────────────────────────
// ts = minutos desde epoch UTC
export const DAY_MIN = 1440;
export const minuteOf = ms => Math.floor(ms / 60000);
export const isoMinute = ts => new Date(ts * 60000).toISOString().slice(0, 16) + "Z";
export const isoDate = ts => new Date(ts * 60000).toISOString().slice(0, 10);
export const dayStart = date => Date.parse(`${date}T00:00:00Z`) / 60000;
export const addDays = (date, n) => isoDate(dayStart(date) + n * DAY_MIN);

// ─── Mediana y media con el redondeo de Python ───────────────────────────────
// round() de Python redondea los .5 al par (8688,5 → 8688) y ROUND de SQLite
// hacia arriba: con ROUND salía distinto el 30 % de las medianas de 2 muestras.
// Se trabaja con enteros: la suma de los dos valores centrales (o el central)
// y la suma total / n, redondeando al par a mano.
const MID = "SUM(CASE WHEN rn IN ((cnt + 1) / 2, (cnt + 2) / 2) THEN p END)";
/** Mediana (window: rn = ROW_NUMBER por p, cnt = COUNT) redondeada como Python. */
export const MEDIAN_SQL = `(CASE WHEN MAX(cnt) % 2 = 1 THEN ${MID}
  ELSE ${MID} / 2 + (${MID} % 2) * ((${MID} / 2) % 2) END)`;
/** round(fmean(p)) de Python, con enteros. */
export const MEAN_SQL = `(CASE
  WHEN 2 * (SUM(p) % COUNT(*)) > COUNT(*) THEN SUM(p) / COUNT(*) + 1
  WHEN 2 * (SUM(p) % COUNT(*)) < COUNT(*) THEN SUM(p) / COUNT(*)
  ELSE SUM(p) / COUNT(*) + (SUM(p) / COUNT(*)) % 2 END)`;

// ─── Estado (tabla state, valores JSON) ──────────────────────────────────────
export async function getState(db, key, fallback = null) {
  const row = await db.prepare("SELECT value FROM state WHERE key = ?1").bind(key).first();
  if (!row || row.value == null) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setStateStmt(db, key, value) {
  return db.prepare(
    `INSERT INTO state (key, value) VALUES (?1, ?2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE state.value IS NOT excluded.value`,
  ).bind(key, JSON.stringify(value));
}

export async function setState(db, key, value) {
  return setStateStmt(db, key, value).run();
}

export async function getStates(db, keys) {
  const { results } = await db.prepare(
    "SELECT key, value FROM state WHERE key IN (SELECT value FROM json_each(?1))",
  ).bind(JSON.stringify(keys)).all();
  const out = {};
  for (const r of results) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

/** Suma rows_written de los resultados de un batch / run. */
export function written(res) {
  const list = Array.isArray(res) ? res : [res];
  return list.reduce((a, r) => a + (r?.meta?.rows_written || 0), 0);
}

// ─── Descubrimiento (explore, search, rolimons) ──────────────────────────────
/**
 * Juegos vistos en una fuente: [[universe_id, place_id, name], …].
 * Los nuevos entran con tracked=1; los existentes se vuelven a seguir si
 * estaban parados y se añade la fuente a `sources` si faltaba.
 * Solo escribe las filas que cambian.
 *
 * La fuente se busca en `sources` como texto (`instr` con la cadena JSON
 * entre comillas) y no con json_each: D1 cuenta como leída cada fila de un
 * json_each, y esto corre con cada página de explore y cada búsqueda.
 * `"explore"` con sus comillas solo casa con un elemento entero del array.
 */
export function upsertDiscoveredStmt(db, rows, source, firstSeen) {
  const has = "instr(COALESCE(games.sources, '[]'), json_quote(?3)) > 0";
  return db.prepare(
    `INSERT INTO games (universe_id, place_id, name, first_seen, sources, tracked)
     SELECT j.value ->> 0, j.value ->> 1, j.value ->> 2, ?2, json_array(?3), 1
     FROM json_each(?1) j WHERE (j.value ->> 0) IS NOT NULL
     ON CONFLICT (universe_id) DO UPDATE SET
       tracked = 1,
       low_since = CASE WHEN games.tracked = 0 THEN NULL ELSE games.low_since END,
       place_id = COALESCE(games.place_id, excluded.place_id),
       name = COALESCE(games.name, excluded.name),
       sources = CASE WHEN ${has} THEN games.sources
         ELSE json_insert(COALESCE(games.sources, '[]'), '$[#]', ?3) END
     WHERE games.tracked IS NOT 1
        OR (games.place_id IS NULL AND excluded.place_id IS NOT NULL)
        OR (games.name IS NULL AND excluded.name IS NOT NULL)
        OR NOT ${has}`,
  ).bind(JSON.stringify(rows), firstSeen, source);
}

/**
 * Puestos en listas: [[universe_id, sort_id, rank], …], solo de juegos que
 * están en `games`. Se guarda el mejor puesto del día.
 */
export function sortHitsStmt(db, rows, date) {
  return db.prepare(
    `INSERT INTO sort_hits (universe_id, date, sort_id, rank)
     SELECT j.value ->> 0, ?2, j.value ->> 1, j.value ->> 2 FROM json_each(?1) j
     WHERE EXISTS (SELECT 1 FROM games g WHERE g.universe_id = (j.value ->> 0))
     ON CONFLICT (universe_id, date, sort_id) DO UPDATE SET rank = excluded.rank
     WHERE excluded.rank < sort_hits.rank`,
  ).bind(JSON.stringify(rows), date);
}

// ─── Rolimons: caché place → universe ────────────────────────────────────────
/** Devuelve los place_id de `pids` que no están en la caché `places`. */
export async function unknownPlaces(db, pids) {
  const { results } = await db.prepare(
    `SELECT j.value AS pid FROM json_each(?1) j
     WHERE NOT EXISTS (SELECT 1 FROM places p WHERE p.place_id = j.value)`,
  ).bind(JSON.stringify(pids)).all();
  return results.map(r => r.pid);
}

/** Vuelve a seguir (y marca con "rolimons") los juegos conocidos de esos places. */
export function retrackPlacesStmt(db, pids) {
  return db.prepare(
    `UPDATE games SET tracked = 1, low_since = NULL,
       sources = CASE
         WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(sources, '[]')) s WHERE s.value = 'rolimons') THEN sources
         ELSE json_insert(COALESCE(sources, '[]'), '$[#]', 'rolimons') END
     WHERE universe_id IN (SELECT p.universe_id FROM json_each(?1) j JOIN places p ON p.place_id = j.value)
       AND (tracked IS NOT 1
            OR NOT EXISTS (SELECT 1 FROM json_each(COALESCE(sources, '[]')) s WHERE s.value = 'rolimons'))`,
  ).bind(JSON.stringify(pids));
}

export function insertPlacesStmt(db, rows) {
  return db.prepare(
    `INSERT INTO places (place_id, universe_id)
     SELECT j.value ->> 0, j.value ->> 1 FROM json_each(?1) j WHERE true
     ON CONFLICT (place_id) DO UPDATE SET universe_id = excluded.universe_id
     WHERE places.universe_id IS NOT excluded.universe_id`,
  ).bind(JSON.stringify(rows));
}

// ─── Muestras ─────────────────────────────────────────────────────────────────
/** Ids del radar (tracked = 1) o, con `selected`, solo los seguidos (sel = 1). */
export async function trackedIds(db, { selected = false } = {}) {
  const { results } = await db.prepare(
    `SELECT universe_id AS id FROM games WHERE tracked = 1 ${selected ? "AND sel = 1" : ""} ORDER BY universe_id`,
  ).all();
  return results.map(r => r.id);
}

/** Ids seguidos (sel = 1) dentro de `ids`. */
export async function selectedAmong(db, ids) {
  const { results } = await db.prepare(
    `SELECT g.universe_id AS id FROM json_each(?1) j JOIN games g ON g.universe_id = j.value WHERE g.sel = 1`,
  ).bind(JSON.stringify(ids)).all();
  return results.map(r => r.id);
}

// ─── Radar ────────────────────────────────────────────────────────────────────
/**
 * Lecturas de Rolimons [[placeId, name, players], …] → {universe_id: players}
 * de los juegos del radar (tracked = 1) cuyo place está en la caché.
 */
export async function radarPlayers(db, list, today) {
  const map = await radarPlaces(db, today);
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const id = map.get(list[i][0]);
    if (id != null) out[id] = Math.max(out[id] ?? 0, list[i][2]);   // varios places de un juego: el mayor
  }
  return out;
}

/**
 * Map place_id → universe_id de los places de juegos del radar, guardado como
 * pares en state.radar_places (una fila). Cruzar en SQL la lista de Rolimons
 * (~3.500 places) con places y games leía ~10.000 filas en cada lectura del
 * radar (8 al día); así se rehace una vez al día o cuando cambian places o
 * tracked (radarStaleStmt lo borra). Un juego que explore vuelve a seguir a
 * media tarde entra en el radar al día siguiente.
 */
export async function radarPlaces(db, today) {
  const cached = await getState(db, "radar_places");
  if (cached?.day === today && Array.isArray(cached.pairs)) return new Map(cached.pairs);
  const { results } = await db.prepare(
    `SELECT pl.place_id AS pid, pl.universe_id AS id
     FROM places pl JOIN games g ON g.universe_id = pl.universe_id WHERE g.tracked = 1`,
  ).all();
  const pairs = results.map(r => [r.pid, r.id]);
  await setState(db, "radar_places", { day: today, pairs });
  return new Map(pairs);
}

/** Cachés de state que dependen de tracked, sel o places: se borran al cambiarlos. */
export const radarStaleStmt = db =>
  db.prepare("DELETE FROM state WHERE key IN ('radar_places', 'radar_counts')");

/**
 * Filas diarias del radar para `date`: `readings` = {universe_id: [jugadores
 * de cada muestreo (o null)…]} (Rolimons) y `meta` = {universe_id: [playing,
 * visits]} (Games API del meta diario, de los juegos no seguidos). Mediana,
 * media, mín y máx como el cierre desde samples. Un juego que ya tiene fila
 * del día (de sus muestras) solo la cambia si el radar tiene más lecturas; las
 * visitas solo se rellenan si faltaban.
 */
export function radarCloseStmt(db, date, readings, meta) {
  return db.prepare(
    `WITH r AS (
       SELECT CAST(o.key AS INTEGER) AS id, i.value AS p
       FROM json_each(?1) o, json_each(o.value) i WHERE i.value IS NOT NULL
     ),
     s AS (
       SELECT id, p, ROW_NUMBER() OVER (PARTITION BY id ORDER BY p) AS rn, COUNT(*) OVER (PARTITION BY id) AS cnt
       FROM r
     ),
     a AS (
       SELECT id, MAX(cnt) AS n, ${MEDIAN_SQL} AS median, ${MEAN_SQL} AS mean, MIN(p) AS mn, MAX(p) AS mx
       FROM s GROUP BY id
     ),
     mt AS MATERIALIZED (
       SELECT CAST(key AS INTEGER) AS id, value ->> 0 AS p, value ->> 1 AS v FROM json_each(?2)
     ),
     u AS (
       SELECT a.id, a.n, a.median, a.mean, a.mn, a.mx, mt.v FROM a LEFT JOIN mt ON mt.id = a.id
       UNION ALL
       SELECT mt.id, 1, mt.p, mt.p, mt.p, mt.p, mt.v FROM mt
       WHERE mt.p IS NOT NULL AND mt.id NOT IN (SELECT id FROM a)
     )
     INSERT INTO daily (universe_id, date, n, median, mean, min, max, visits)
     SELECT u.id, ?3, u.n, u.median, u.mean, u.mn, u.mx, u.v FROM u
     WHERE EXISTS (SELECT 1 FROM games g WHERE g.universe_id = u.id)
     ON CONFLICT (universe_id, date) DO UPDATE SET
       n = CASE WHEN excluded.n > daily.n THEN excluded.n ELSE daily.n END,
       median = CASE WHEN excluded.n > daily.n THEN excluded.median ELSE daily.median END,
       mean = CASE WHEN excluded.n > daily.n THEN excluded.mean ELSE daily.mean END,
       min = CASE WHEN excluded.n > daily.n THEN excluded.min ELSE daily.min END,
       max = CASE WHEN excluded.n > daily.n THEN excluded.max ELSE daily.max END,
       visits = COALESCE(daily.visits, excluded.visits)
     WHERE excluded.n > daily.n OR (daily.visits IS NULL AND excluded.visits IS NOT NULL)`,
  ).bind(JSON.stringify(readings || {}), JSON.stringify(meta || {}), date);
}

/**
 * Datos para elegir los juegos seguidos: los del radar con universe_id en
 * [lo, hi], con las últimas `days` filas diarias hasta `before` (excluido).
 * → [[id, horror, sel, created, first_seen, first_day, sorts, d], …] (d como en el export)
 */
export async function radarSlice(db, { lo, hi, days, before, today }) {
  const { results } = await db.prepare(
    `WITH hj AS (SELECT COALESCE((SELECT value FROM state WHERE key = 'hist_agg'), '{}') AS j)
     SELECT json_array(g.universe_id, COALESCE(g.horror, 0), COALESCE(g.sel, 0), g.created, g.first_seen,
       json_extract(hj.j, '$."' || g.universe_id || '"[3]'),
       json(COALESCE((SELECT json_group_object(k.sort_id, k.rank) FROM sort_hits k
              WHERE k.universe_id = g.universe_id AND k.date = ?5 AND k.sort_id NOT LIKE 'search:%'), '{}')),
       json(COALESCE((SELECT json_group_array(json_array(r.date, r.median, r.min, r.max, r.n, r.visits)) FROM (
              SELECT * FROM (SELECT date, median, min, max, n, visits FROM daily
                             WHERE universe_id = g.universe_id AND date < ?4 ORDER BY date DESC LIMIT ?3)
              ORDER BY date) r), '[]'))) AS row
     FROM games g CROSS JOIN hj WHERE g.tracked = 1 AND g.universe_id BETWEEN ?1 AND ?2`,
  ).bind(lo, hi, days, before, today).all();
  return results.map(r => JSON.parse(r.row));
}

/** sel = 1 para `ids` y 0 para el resto (solo escribe los que cambian). */
export function applySelectionStmt(db, ids) {
  return db.prepare(
    `UPDATE games SET sel = (universe_id IN (SELECT value FROM json_each(?1)))
     WHERE COALESCE(sel, 0) IS NOT (universe_id IN (SELECT value FROM json_each(?1)))`,
  ).bind(JSON.stringify(ids));
}

/**
 * Juegos en el radar y seguidos (para la cabecera del export). Contarlos lee
 * `games` entera (~3.000 filas) y el export corre cada hora: se guarda en
 * state.radar_counts para el día y se borra cuando select o maint cambian sel
 * o tracked (radarStaleStmt). Los que explore añade durante el día se cuentan
 * al día siguiente.
 */
export async function radarCounts(db, today = isoDate(minuteOf(Date.now()))) {
  const cached = await getState(db, "radar_counts");
  if (cached?.day === today) return { radar: cached.radar, selected: cached.selected };
  const row = await db.prepare(
    "SELECT COUNT(*) AS radar, COALESCE(SUM(sel = 1), 0) AS selected FROM games WHERE tracked = 1",
  ).first();
  const out = { radar: row?.radar ?? 0, selected: row?.selected ?? 0 };
  await setState(db, "radar_counts", { day: today, ...out });
  return out;
}

/** [[universe_id, playing, visits], …] con el mismo ts. Idempotente (OR IGNORE). */
export function insertSamplesStmt(db, rows, ts) {
  return db.prepare(
    `INSERT OR IGNORE INTO samples (universe_id, ts, playing, visits)
     SELECT j.value ->> 0, ?2, j.value ->> 1, j.value ->> 2 FROM json_each(?1) j`,
  ).bind(JSON.stringify(rows), ts);
}

/**
 * low_since: [[universe_id, playing], …]. Marca la fecha en que bajan de
 * TRACK_MIN_PLAYERS y la borra cuando vuelven a subir (solo escribe cambios).
 */
export function lowSinceStmts(db, rows, today) {
  const low = [], high = [];
  for (const [id, p] of rows) (p >= TRACK_MIN_PLAYERS ? high : low).push(id);
  const out = [];
  if (low.length) out.push(db.prepare(
    `UPDATE games SET low_since = ?2
     WHERE universe_id IN (SELECT value FROM json_each(?1)) AND low_since IS NULL`,
  ).bind(JSON.stringify(low), today));
  if (high.length) out.push(db.prepare(
    `UPDATE games SET low_since = NULL
     WHERE universe_id IN (SELECT value FROM json_each(?1)) AND low_since IS NOT NULL`,
  ).bind(JSON.stringify(high)));
  return out;
}

// ─── Meta diario ──────────────────────────────────────────────────────────────
export const META_COLS = [
  "place_id", "name", "creator", "creator_verified", "created", "updated", "genre",
  "genre_l1", "genre_l2", "max_players", "horror", "horror_score", "horror_reasons",
];

/**
 * rows: [[universe_id, ...META_COLS], …]. Solo escribe las fichas que cambian
 * (y entonces actualiza meta_date).
 */
export function updateMetaStmt(db, rows, today) {
  const set = META_COLS.map((c, i) => `${c} = COALESCE(j.value ->> ${i + 1}, games.${c})`).join(", ");
  const diff = META_COLS.map((c, i) => `(j.value ->> ${i + 1}) IS NOT NULL AND games.${c} IS NOT (j.value ->> ${i + 1})`).join(" OR ");
  return db.prepare(
    `UPDATE games SET ${set}, meta_date = ?2
     FROM json_each(?1) j
     WHERE games.universe_id = (j.value ->> 0) AND (${diff})`,
  ).bind(JSON.stringify(rows), today);
}

// ─── Cierre del día ───────────────────────────────────────────────────────────
/**
 * Cierra `date` desde samples: n, mediana (ROW_NUMBER), media, min, max y
 * visitas. `votes` = {universe_id: [favorites, up, down]} (o null) del meta
 * diario. ON CONFLICT DO UPDATE sin pisar los favoritos/votos ya guardados.
 */
export function closeDayStmt(db, date, votes) {
  const start = dayStart(date);
  return db.prepare(
    `WITH s AS (
       SELECT s.universe_id AS id, s.playing AS p, s.visits AS v,
              ROW_NUMBER() OVER (PARTITION BY s.universe_id ORDER BY s.playing) AS rn,
              COUNT(*) OVER (PARTITION BY s.universe_id) AS cnt
       FROM games g CROSS JOIN samples s ON s.universe_id = g.universe_id AND s.ts >= ?1 AND s.ts < ?2
     ),
     a AS (
       SELECT id, MAX(cnt) AS n,
              ${MEDIAN_SQL} AS median,
              ${MEAN_SQL} AS mean, MIN(p) AS mn, MAX(p) AS mx, MAX(v) AS v
       FROM s GROUP BY id
     ),
     vt AS MATERIALIZED (
       SELECT CAST(key AS INTEGER) AS id, value ->> 0 AS fav, value ->> 1 AS up, value ->> 2 AS down
       FROM json_each(?4)
     )
     INSERT INTO daily (universe_id, date, n, median, mean, min, max, visits, favorites, up, down)
     SELECT a.id, ?3, a.n, a.median, a.mean, a.mn, a.mx, a.v, vt.fav, vt.up, vt.down
     FROM a LEFT JOIN vt ON vt.id = a.id WHERE true
     ON CONFLICT (universe_id, date) DO UPDATE SET
       n = excluded.n, median = excluded.median, mean = excluded.mean,
       min = excluded.min, max = excluded.max,
       visits = COALESCE(excluded.visits, daily.visits),
       favorites = COALESCE(excluded.favorites, daily.favorites),
       up = COALESCE(excluded.up, daily.up),
       down = COALESCE(excluded.down, daily.down)
     WHERE daily.n IS NOT excluded.n OR daily.median IS NOT excluded.median
        OR daily.mean IS NOT excluded.mean OR daily.min IS NOT excluded.min
        OR daily.max IS NOT excluded.max
        OR (excluded.visits IS NOT NULL AND daily.visits IS NOT excluded.visits)
        OR (excluded.favorites IS NOT NULL AND daily.favorites IS NOT excluded.favorites)
        OR (excluded.up IS NOT NULL AND daily.up IS NOT excluded.up)
        OR (excluded.down IS NOT NULL AND daily.down IS NOT excluded.down)`,
  ).bind(start, start + DAY_MIN, date, JSON.stringify(votes || {}));
}

/** Favoritos y votos para un día ya cerrado (si el cierre no hacía falta). */
export function applyVotesStmt(db, date, votes) {
  return db.prepare(
    `UPDATE daily SET favorites = COALESCE(j.value ->> 0, favorites),
                      up = COALESCE(j.value ->> 1, up), down = COALESCE(j.value ->> 2, down)
     FROM json_each(?1) j
     WHERE daily.universe_id = CAST(j.key AS INTEGER) AND daily.date = ?2
       AND (favorites IS NOT (j.value ->> 0) OR up IS NOT (j.value ->> 1) OR down IS NOT (j.value ->> 2))`,
  ).bind(JSON.stringify(votes || {}), date);
}

/**
 * state.hist_agg = {universe_id: [peak, peak_date, days, first_day, favorites, up, down, last_date]}
 * de TODA la serie diaria. Se mantiene de forma incremental (1 fila escrita y
 * ~nº de juegos filas leídas al día) para que el export no tenga que leer
 * toda `daily` 8 veces al día (crecería a millones de filas leídas).
 * `mergeHistStmt(date)` incorpora un día cerrado; `rebuildHistStmt` lo
 * recalcula entero (tras importar datos o por /api/admin/rebuild).
 */
export function mergeHistStmt(db, date) {
  return db.prepare(
    `WITH prev AS MATERIALIZED (
       SELECT CAST(key AS INTEGER) AS id, value ->> 0 AS peak, value ->> 1 AS peak_date,
              value ->> 2 AS days, value ->> 3 AS first_day, value ->> 4 AS fav,
              value ->> 5 AS up, value ->> 6 AS down, value ->> 7 AS last
       FROM json_each(COALESCE((SELECT value FROM state WHERE key = 'hist_agg'), '{}'))
     ),
     nw AS MATERIALIZED (
       SELECT d.universe_id AS id, d.date AS nd, d.max AS nmax, d.favorites AS nfav, d.up AS nup, d.down AS ndown
       FROM games g CROSS JOIN daily d ON d.universe_id = g.universe_id AND d.date = ?1
     ),
     m AS (
       SELECT p.*, n.nd, n.nmax, n.nfav, n.nup, n.ndown,
              (n.nd IS NOT NULL AND n.nd > COALESCE(p.last, '')) AS isnew,
              (n.nd IS NOT NULL AND n.nd = p.last) AS issame
       FROM prev p LEFT JOIN nw n ON n.id = p.id
       UNION ALL
       SELECT n.id, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, n.nd, n.nmax, n.nfav, n.nup, n.ndown, 1, 0
       FROM nw n WHERE n.id NOT IN (SELECT id FROM prev)
     )
     INSERT INTO state (key, value)
     SELECT 'hist_agg', json_group_object(id, json_array(
       CASE WHEN isnew AND nmax > COALESCE(peak, -1) THEN nmax ELSE peak END,
       CASE WHEN isnew AND nmax > COALESCE(peak, -1) THEN nd ELSE peak_date END,
       COALESCE(days, 0) + isnew,
       COALESCE(first_day, CASE WHEN isnew THEN nd END),
       CASE WHEN (isnew OR issame) AND nfav > 0 THEN nfav ELSE fav END,
       CASE WHEN (isnew OR issame) AND nup IS NOT NULL THEN nup ELSE up END,
       CASE WHEN (isnew OR issame) AND ndown IS NOT NULL THEN ndown ELSE down END,
       CASE WHEN isnew THEN nd ELSE last END))
     FROM m WHERE true
     ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE state.value IS NOT excluded.value`,
  ).bind(date);
}

export function rebuildHistStmt(db) {
  return db.prepare(
    `WITH a AS (
       SELECT universe_id AS id, MAX(max) AS peak, MIN(date) AS first_day, COUNT(*) AS days, MAX(date) AS last
       FROM daily GROUP BY universe_id
     ),
     pk AS (
       SELECT d.universe_id AS id, MIN(d.date) AS pd FROM daily d JOIN a ON a.id = d.universe_id AND d.max = a.peak
       GROUP BY d.universe_id
     ),
     fv AS (
       SELECT id, fav FROM (SELECT universe_id AS id, favorites AS fav,
              ROW_NUMBER() OVER (PARTITION BY universe_id ORDER BY date DESC) AS rn
              FROM daily WHERE favorites > 0) WHERE rn = 1
     ),
     vu AS (
       SELECT id, up FROM (SELECT universe_id AS id, up,
              ROW_NUMBER() OVER (PARTITION BY universe_id ORDER BY date DESC) AS rn
              FROM daily WHERE up IS NOT NULL) WHERE rn = 1
     ),
     vd AS (
       SELECT id, down FROM (SELECT universe_id AS id, down,
              ROW_NUMBER() OVER (PARTITION BY universe_id ORDER BY date DESC) AS rn
              FROM daily WHERE down IS NOT NULL) WHERE rn = 1
     )
     INSERT INTO state (key, value)
     SELECT 'hist_agg', COALESCE(json_group_object(a.id,
              json_array(a.peak, pk.pd, a.days, a.first_day, fv.fav, vu.up, vd.down, a.last)), '{}')
     FROM a LEFT JOIN pk ON pk.id = a.id LEFT JOIN fv ON fv.id = a.id
            LEFT JOIN vu ON vu.id = a.id LEFT JOIN vd ON vd.id = a.id
     WHERE true
     ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE state.value IS NOT excluded.value`,
  );
}

// ─── Poda y untrack ───────────────────────────────────────────────────────────
/** Borra muestras con ts < cutoff (buscando por clave primaria juego a juego). */
export function pruneSamplesStmt(db, cutoffTs) {
  return db.prepare(
    `DELETE FROM samples WHERE ts < ?1
       AND universe_id IN (SELECT universe_id FROM games)`,
  ).bind(cutoffTs);
}

/**
 * Lo que tiene más de un año: filas diarias y puestos en listas anteriores a
 * `cutoffDate`. Por clave primaria juego a juego (solo lee las filas viejas).
 */
export function pruneOldStmts(db, cutoffDate) {
  return [
    db.prepare(`DELETE FROM daily WHERE date < ?1 AND universe_id IN (SELECT universe_id FROM games)`).bind(cutoffDate),
    db.prepare(`DELETE FROM sort_hits WHERE date < ?1 AND universe_id IN (SELECT universe_id FROM games)`).bind(cutoffDate),
  ];
}

/** Muestras huérfanas (juegos que ya no existen en games): casi nunca hay. */
export function pruneOrphansStmt(db, cutoffTs) {
  return db.prepare(
    `DELETE FROM samples WHERE ts < ?1 AND universe_id NOT IN (SELECT universe_id FROM games)`,
  ).bind(cutoffTs);
}

/**
 * tracked=0 para los que llevan UNTRACK_AFTER_DAYS por debajo del mínimo,
 * salvo que hayan salido en explore o search (sort_hits) hoy o ayer.
 */
export function untrackStmt(db, today) {
  const limit = addDays(today, -UNTRACK_AFTER_DAYS);
  const yesterday = addDays(today, -1);
  return db.prepare(
    `UPDATE games SET tracked = 0
     WHERE tracked = 1 AND low_since IS NOT NULL AND low_since <= ?1
       AND NOT EXISTS (SELECT 1 FROM sort_hits h
                       WHERE h.universe_id = games.universe_id AND h.date >= ?2)`,
  ).bind(limit, yesterday);
}

// ─── Export (/api/export = R2 data/export.json, y data/telegram.json) ────────
/**
 * El export se genera por TROZOS de juegos (rangos de universe_id): recibir de
 * D1 un JSON de ~2 MB cuesta ~13 ms de CPU solo en decodificarlo, y el plan
 * gratis da 10 ms por paso. Cada trozo devuelve los objetos de sus juegos ya
 * serializados (texto separado por comas) y se guarda en R2; el paso final los
 * une en `data/export.json` con un stream (sin pasar el contenido por JS).
 *
 * data/telegram.json (candidatos de Telegram) lo calcula sampler.js con
 * telegramScanText/pickCandidates de telegram.js sobre las partes, y copia de
 * esas mismas partes los juegos elegidos (no vuelve a D1).
 *
 * Lecturas: el export corre cada hora y era el ~57 % de las filas leídas del
 * día (límite de 5 M en el plan gratis). D1 cuenta cada fila que pasa por un
 * cursor: tablas, CTE materializadas, ordenaciones, ventanas y también las de
 * json_each. Por eso cada juego recorre sus muestras UNA vez (en orden de la
 * clave primaria, sin ordenar) y todo lo demás sale de ese recorrido o de
 * funciones JSON escalares (json_set, json_insert…), que no recorren filas.
 */

/** Rangos de universe_id con ~`size` juegos seguidos cada uno. → [[lo, hi], …] */
export async function exportPlan(db, size, { selected = false } = {}) {
  const { results } = await db.prepare(
    `SELECT universe_id AS lo FROM (
       SELECT universe_id, ROW_NUMBER() OVER (ORDER BY universe_id) - 1 AS rn FROM games
       WHERE tracked = 1 ${selected ? "AND sel = 1" : ""})
     WHERE rn % ?1 = 0 ORDER BY lo`,
  ).bind(size).all();
  const los = results.map(r => r.lo);
  if (!los.length) return [[0, Number.MAX_SAFE_INTEGER]];
  los[0] = 0;   // el primer rango empieza en 0 y el último acaba en el máximo
  return los.map((lo, i) => [lo, i + 1 < los.length ? los[i + 1] - 1 : Number.MAX_SAFE_INTEGER]);
}

/** ts de la última muestra (state.last_sample_ts; si falta, se busca en samples). */
export async function lastSampleTs(db) {
  const v = await getState(db, "last_sample_ts");
  if (Number.isFinite(Number(v)) && v) return Number(v);
  // Sin índice por ts esto recorre la tabla: solo pasa tras una migración
  const row = await db.prepare("SELECT MAX(ts) AS ts FROM samples").first();
  return row?.ts ?? null;
}

/**
 * state.export_d = {day: openDay, g: {universe_id: entrada}}: las filas
 * cerradas de `daily` que salen en `d`, que no cambian hasta que se cierra
 * otro día (y entonces cambia openDay). Se calculan una vez al día por juego
 * en vez de leer ~24 filas por juego en cada export. Las muestras NO se
 * guardan aquí: se leen siempre de `samples`, así que da igual cuándo se
 * inserten (también las de fechas pasadas). Quien reescriba filas cerradas de
 * `daily` fuera del cierre (import, rebuild) tiene que borrar esta clave.
 */
export const EXPORT_D_KEY = "export_d";

export function dropExportCacheStmt(db) {
  return db.prepare("DELETE FROM state WHERE key = ?1").bind(EXPORT_D_KEY);
}

// Días sin cerrar que puede tocar la ventana de muestras (48 h tocan como
// mucho 3 fechas; la 4ª por si entra una pasada más nueva que lastTs).
const OPEN_DAYS = [0, 1, 2, 3];

// Entrada de un juego (?9 = filas de `d`, ?10 = openDay, como en buildExportSlice):
// [filas cerradas asc ([fecha, mediana, mín, máx, n, null], las últimas ?9 antes
// de openDay), [[índice, visitas] de las 2 últimas de esas filas con visitas, la
// más reciente primero]]. Las visitas van aparte porque cuáles se enseñan depende
// de los días abiertos de cada export.
const closedEntrySql = id => `(SELECT json_array(
    (SELECT json_group_array(json_array(date, median, min, max, n, NULL) ORDER BY date) FROM (
       SELECT date, median, min, max, n FROM daily
       WHERE universe_id = ${id} AND date < ?10 ORDER BY date DESC LIMIT ?9)),
    (SELECT json_group_array(json_array(
              (SELECT COUNT(*) FROM daily dd WHERE dd.universe_id = ${id} AND dd.date >= w.lo AND dd.date < v.date),
              v.visits) ORDER BY v.date DESC)
     FROM (SELECT date, visits FROM daily
           WHERE universe_id = ${id} AND date >= w.lo AND date < ?10 AND visits IS NOT NULL
           ORDER BY date DESC LIMIT 2) v))
  FROM (SELECT COALESCE((SELECT date FROM daily WHERE universe_id = ${id} AND date < ?10
                         ORDER BY date DESC LIMIT 1 OFFSET ?9 - 1), '') AS lo) w)`;

// Juegos del trozo: los de la lista ?13 o los del rango (y seguidos si ?15).
// La rama que no toca se descarta antes de recorrer nada.
const SLICE_GAMES = `g0 AS (
      SELECT universe_id AS id FROM games
      WHERE ?13 IS NULL AND universe_id BETWEEN ?11 AND ?12 AND (?15 = 0 OR sel = 1)
      UNION ALL
      SELECT value FROM json_each(?13) WHERE ?13 IS NOT NULL
    )`;

/** Mediana redondeada como Python de los `n` elementos ORDENADOS de `a` que empiezan en `f`. */
const sortedMedian = (a, f, n) => {
  const mid = `(CASE WHEN ${n} % 2 = 1 THEN ${a} ->> (${f} + ${n} / 2) ELSE (${a} ->> (${f} + ${n} / 2 - 1)) + (${a} ->> (${f} + ${n} / 2)) END)`;
  return `(CASE WHEN ${n} % 2 = 1 THEN ${mid} ELSE ${mid} / 2 + (${mid} % 2) * ((${mid} / 2) % 2) END)`;
};

/**
 * Un trozo del export: los juegos con universe_id en [lo, hi] o los de `ids`
 * que cumplen el filtro del contrato (`filter: false`, todos los que tengan
 * muestras). Con `ids` se usa y se completa state.export_d.
 * → { frag: '{…},{…}', n, last_ts, ts24: [ts…], meta }
 */
export async function buildExportSlice(db, { nowMs, lastTs, openDay, lo = 0, hi = Number.MAX_SAFE_INTEGER, ids = null, selected = false, filter = true }) {
  const now = minuteOf(nowMs);
  const today = isoDate(now);
  openDay = openDay && openDay < today ? openDay : today;
  lastTs = lastTs ?? now;
  const sFrom = lastTs - EXPORT_SAMPLE_HOURS * 60;      // muestras: última − 48 h (incluida)
  const cut24 = lastTs - 24 * 60;                        // máximo de 24 h para el filtro
  const openTs = Math.max(dayStart(openDay), sFrom);
  const binds = [
    sFrom, cut24,
    CATEGORIES.general.min_players, CATEGORIES.horror.min_players,
    EMERGING.max_visits, EMERGING.min_players,
    openTs, today, EXPORT_DAILY_DAYS, openDay, lo, hi,
    ids ? JSON.stringify(ids) : null, now - 24 * 60, selected ? 1 : 0,
    filter ? 1 : 0, Math.floor(openTs / DAY_MIN), EXPORT_D_KEY,
  ];
  // Con una lista (los seguidos, ~200 juegos) las filas cerradas van a
  // state.export_d; sin ella (aún sin selección: todo el radar) no caben en
  // una fila de D1 y se leen de daily en cada export, como antes.
  const cache = !!ids;

  // Días sin cerrar, de lo que deja cada juego en `a`: x[5] = jugadores de los
  // días abiertos ordenados por día y jugadores; el día k empieza en x[6 + 3k],
  // tiene x[7 + 3k] muestras y x[8 + 3k] es su máximo de visitas.
  const K = OPEN_DAYS.map(k => ({
    a: "(s.x -> 5)", f: `(s.x ->> ${6 + 3 * k})`, n: `(s.x ->> ${7 + 3 * k})`, v: `(s.x ->> ${8 + 3 * k})`,
    day: `date((?17 + ${k}) * 86400, 'unixepoch')`,
  }));
  for (const k of K) {
    k.has = `(${k.n} > 0)`;
    k.mn = `(${k.a} ->> ${k.f})`;
    k.mx = `(${k.a} ->> (${k.f} + ${k.n} - 1))`;
    k.median = sortedMedian(k.a, k.f, k.n);
  }
  const days = `(${K.map(k => k.has).join(" + ")})`;
  const vdays = `(${K.map(k => `(${k.has} AND ${k.v} IS NOT NULL)`).join(" + ")})`;
  const pmx = `NULLIF(MAX(${K.map(k => `CASE WHEN ${k.has} THEN ${k.mx} ELSE -1 END`).join(", ")}), -1)`;

  const sql = `
    WITH
    ${SLICE_GAMES},
    -- Última muestra con visitas (t1) y la última ≥ 20 h anterior (t0): las
    -- únicas de "s" que llevan visitas. Hacia atrás por la clave primaria.
    g1 AS (
      SELECT id, (SELECT ts FROM samples WHERE universe_id = g0.id AND ts >= ?1 AND visits IS NOT NULL
                  ORDER BY ts DESC LIMIT 1) AS t1
      FROM g0
    ),
    g2 AS MATERIALIZED (
      SELECT id, t1, (SELECT ts FROM samples WHERE universe_id = g1.id AND ts >= ?1 AND ts <= g1.t1 - 1200
                      AND visits IS NOT NULL ORDER BY ts DESC LIMIT 1) AS t0
      FROM g1
    ),
    -- Un solo recorrido de las muestras de 48 h de cada juego:
    -- x = [último ts, máx 24 h, máx visitas, "s", ts de 24 h, jugadores de los
    --      días abiertos ordenados (para las medianas), y por día abierto k
    --      dónde empieza, cuántas muestras tiene y su máximo de visitas]
    a AS MATERIALIZED (
      SELECT g2.id, g2.t1, (SELECT json_array(
          MAX(ts), MAX(CASE WHEN ts >= ?2 THEN playing END), MAX(visits),
          json_group_array(json_array(ts, playing, CASE WHEN ts = g2.t1 OR ts = g2.t0 THEN visits END)),
          json_group_array(ts) FILTER (WHERE ts >= ?14),
          json_group_array(playing ORDER BY ts / 1440, playing) FILTER (WHERE ts >= ?7),
          ${OPEN_DAYS.map(k => `COUNT(*) FILTER (WHERE ts >= ?7 AND ts / 1440 < ?17 + ${k}),
          COUNT(*) FILTER (WHERE ts >= ?7 AND ts / 1440 = ?17 + ${k}),
          MAX(visits) FILTER (WHERE ts >= ?7 AND ts / 1440 = ?17 + ${k})`).join(",\n          ")})
        FROM (SELECT ts, playing, visits FROM samples WHERE universe_id = g2.id AND ts >= ?1 ORDER BY ts)) AS x
      FROM g2
    ),
    st AS (SELECT id, t1, x, x ->> 1 AS max24, x ->> 2 AS visits FROM a WHERE x ->> 0 IS NOT NULL),
    sel AS MATERIALIZED (
      SELECT g.*, st.max24, st.t1, st.x
      FROM st CROSS JOIN games g ON g.universe_id = st.id
      WHERE ?16 = 0
         OR st.max24 >= ?3
         OR (g.horror = 1 AND st.max24 >= ?4)
         OR (st.max24 >= ?6 AND COALESCE(st.visits, (SELECT d.visits FROM daily d WHERE d.universe_id = g.universe_id
               AND d.visits IS NOT NULL ORDER BY d.date DESC LIMIT 1)) < ?5)   -- sin visitas conocidas, no
    ),
    -- Días sin cerrar (pmx/pday/pdays/pfirst = pico, su día, nº de días y el primero)
    -- y filas cerradas de daily (ce: de state.export_d o, si falta, de daily).
    -- Sin caché, MATERIALIZED: ce se usa varias veces y cada uso volvería a leer daily
    s3 AS ${cache ? "" : "MATERIALIZED "}(
      SELECT s.*, ${days} AS pdays, ${vdays} AS pvdays, ${pmx} AS pmx,
             CASE ${K.map(k => `WHEN ${k.has} THEN ${k.day}`).join(" ")} END AS pfirst,
             COALESCE(json_extract((SELECT CASE WHEN value ->> '$.day' = ?10 THEN value END FROM state WHERE key = ?18),
                                   '$.g."' || s.universe_id || '"'),
                      ${closedEntrySql("s.universe_id")}) AS ce
      FROM sel s
    ),
    s4 AS (
      SELECT s.*, CASE ${K.map(k => `WHEN ${k.has} AND ${k.mx} = s.pmx THEN ${k.day}`).join(" ")} END AS pday,
             MAX(0, json_array_length(s.ce -> 0) + s.pdays - ?9) AS dropn,
             json_extract((SELECT value FROM state WHERE key = 'hist_agg'), '$."' || s.universe_id || '"') AS hv
      FROM s3 s
    ),
    games_json AS (
      SELECT s.universe_id AS id, json_object(
        'id', s.universe_id, 'place_id', s.place_id, 'name', s.name,
        'creator', s.creator,
        'creator_verified', json(CASE s.creator_verified WHEN 1 THEN 'true' WHEN 0 THEN 'false' ELSE 'null' END),
        'created', s.created, 'updated', s.updated,
        'genre', s.genre, 'genre_l1', s.genre_l1, 'genre_l2', s.genre_l2,
        'max_players', s.max_players, 'first_seen', s.first_seen,
        'horror', json(CASE WHEN s.horror = 1 THEN 'true' ELSE 'false' END),
        'horror_score', COALESCE(s.horror_score, 0),
        'horror_reasons', json(COALESCE(s.horror_reasons, '[]')),
        'sorts', json(COALESCE((SELECT json_group_object(k.sort_id, k.rank) FROM sort_hits k
                       WHERE k.universe_id = s.universe_id AND k.date = ?8 AND k.sort_id NOT LIKE 'search:%'), '{}')),
        'favorites', s.hv ->> 4, 'up', s.hv ->> 5, 'down', s.hv ->> 6,
        'peak', CASE WHEN s.pmx > COALESCE(s.hv ->> 0, -1) THEN s.pmx ELSE s.hv ->> 0 END,
        'peak_date', CASE WHEN s.pmx > COALESCE(s.hv ->> 0, -1) THEN s.pday ELSE s.hv ->> 1 END,
        'days_tracked', COALESCE(s.hv ->> 2, 0) + s.pdays,
        'first_day', COALESCE(s.hv ->> 3, s.pfirst),
        -- Últimas ?9 filas: las cerradas (sin las ?dropn más viejas) y los días
        -- abiertos. visits solo en las 2 últimas filas que la tienen (lo único
        -- que usa metrics.js): primero las de los días abiertos y, si faltan, las
        -- cerradas. Las rutas '$.x' no existen en un array: json_set/json_insert/
        -- json_remove las ignoran, y así cada paso es condicional sin repetir texto.
        'd', json(json_insert(json_remove(json_set(s.ce -> 0,
                 CASE WHEN s.pvdays < 2 AND json_array_length(s.ce -> 1) >= 1 AND (s.ce ->> '$[1][0][0]') >= s.dropn
                      THEN '$[' || (s.ce ->> '$[1][0][0]') || '][5]' ELSE '$.x' END, s.ce ->> '$[1][0][1]',
                 CASE WHEN s.pvdays < 1 AND json_array_length(s.ce -> 1) >= 2 AND (s.ce ->> '$[1][1][0]') >= s.dropn
                      THEN '$[' || (s.ce ->> '$[1][1][0]') || '][5]' ELSE '$.x' END, s.ce ->> '$[1][1][1]'),
               ${OPEN_DAYS.map(k => `CASE WHEN s.dropn > ${k} THEN '$[0]' ELSE '$.x' END`).join(", ")}),
               ${K.map((k, i) => `CASE WHEN ${k.has} THEN '$[#]' ELSE '$.x' END,
                 json_array(${k.day}, ${k.median}, ${k.mn}, ${k.mx}, ${k.n},
                            CASE WHEN ${k.v} IS NOT NULL AND (${K.slice(i + 1).map(j => `(${j.has} AND ${j.v} IS NOT NULL)`).join(" + ") || "0"}) < 2
                                 THEN ${k.v} END)`).join(",\n               ")})),
        's', json(s.x -> 3)
      ) AS gj
      FROM s4 s
    )
    SELECT
      (SELECT group_concat(gj, ',') FROM (SELECT gj FROM games_json ORDER BY id)) AS frag,
      (SELECT COUNT(*) FROM sel) AS n,
      (SELECT MAX(x ->> 0) FROM a) AS last_ts,
      (SELECT json_group_array(json(x -> 4)) FROM a WHERE x ->> 0 IS NOT NULL) AS ts24`;

  const stmts = [db.prepare(sql).bind(...binds)];
  if (cache) {
    // Filas cerradas de los juegos que aún no están en state.export_d (con un
    // día nuevo, todos): una escritura al día, o cuando cambia la selección.
    stmts.unshift(db.prepare(`
      WITH
      ${SLICE_GAMES},
      c AS (SELECT CASE WHEN value ->> '$.day' = ?10 THEN value END AS j FROM state WHERE key = ?18),
      miss AS (SELECT id FROM g0 WHERE json_type((SELECT j FROM c), '$.g."' || id || '"') IS NULL)
      INSERT INTO state (key, value)
      SELECT ?18, json_object('day', ?10, 'g', json_patch(COALESCE((SELECT j FROM c) -> '$.g', '{}'),
                                                          json_group_object(id, json(${closedEntrySql("miss.id")}))))
      FROM miss WHERE true HAVING COUNT(*) > 0
      ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE state.value IS NOT excluded.value`).bind(...binds));
  }
  const res = await db.batch(stmts);
  const main = res[res.length - 1];
  const row = main.results?.[0] || {};
  const ts24 = [...new Set(JSON.parse(row.ts24 || "[]").flat())];
  return {
    frag: row.frag || "",
    n: row.n || 0,
    last_ts: row.last_ts ?? null,
    ts24,
    meta: {
      rows_read: res.reduce((t, r) => t + (r.meta?.rows_read || 0), 0),
      rows_written: res.reduce((t, r) => t + (r.meta?.rows_written || 0), 0),
    },
  };
}

/** Cabecera común de export.json y telegram.json. */
export function exportHeader({ nowMs, lastTs, ts24, radar = null }) {
  return {
    generated_at: new Date(nowMs).toISOString().slice(0, 19) + "Z",
    last_sample: lastTs != null ? isoMinute(lastTs) : null,
    samples_24h: new Set(ts24).size,
    ...(radar ? { radar_games: radar.radar, selected_games: radar.selected } : {}),
  };
}

// ─── /api/history/:id ─────────────────────────────────────────────────────────
export async function history(db, id, { nowMs = Date.now(), openDay } = {}) {
  const now = minuteOf(nowMs);
  const today = isoDate(now);
  openDay = openDay && openDay < today ? openDay : today;
  const dFrom = addDays(today, -(HISTORY_DAYS - 1));
  const rFrom = now - HISTORY_SAMPLE_DAYS * DAY_MIN;
  const openTs = dayStart(openDay);
  const sql = `
    WITH pr AS (
      SELECT playing AS p, date(ts * 60, 'unixepoch') AS day,
             ROW_NUMBER() OVER (PARTITION BY date(ts * 60, 'unixepoch') ORDER BY playing) AS rn,
             COUNT(*) OVER (PARTITION BY date(ts * 60, 'unixepoch')) AS cnt
      FROM samples WHERE universe_id = ?1 AND ts >= ?4
    ),
    part AS (
      SELECT day, MAX(cnt) AS n,
             ${MEDIAN_SQL} AS median,
             ${MEAN_SQL} AS mean,
             MIN(p) AS mn, MAX(p) AS mx
      FROM pr GROUP BY day
    )
    SELECT json_object(
      -- [fecha, mediana, mín, máx, n, (hueco: la web marca ahí los eventos), media]
      'd', json(COALESCE((SELECT json_group_array(json(r.x)) FROM (
             SELECT json_array(date, median, min, max, n, 0, mean) AS x, date AS o FROM daily
             WHERE universe_id = ?1 AND date >= ?2 AND date < ?3
             UNION ALL SELECT json_array(day, median, mn, mx, n, 0, mean), day FROM part
             ORDER BY o) r), '[]')),
      'r', json(COALESCE((SELECT json_group_array(json(r.x)) FROM (
             SELECT json_array(strftime('%Y-%m-%dT%H:%MZ', ts * 60, 'unixepoch'), playing) AS x
             FROM samples WHERE universe_id = ?1 AND ts >= ?5 ORDER BY ts) r), '[]'))
    ) AS out,
    EXISTS (SELECT 1 FROM games WHERE universe_id = ?1) AS known`;
  const row = await db.prepare(sql).bind(id, dFrom, openDay, openTs, rFrom).first();
  if (!row?.known) return null;
  return row.out;
}

// ─── Importación (migración) ──────────────────────────────────────────────────
export const IMPORT_TABLES = {
  games: {
    pk: ["universe_id"],
    cols: ["universe_id", "place_id", "name", "creator", "creator_verified", "created", "updated",
      "genre", "genre_l1", "genre_l2", "max_players", "first_seen", "horror", "horror_score",
      "horror_reasons", "sources", "tracked", "low_since", "meta_date"],
  },
  places: { pk: ["place_id"], cols: ["place_id", "universe_id"] },
  daily: {
    pk: ["universe_id", "date"],
    cols: ["universe_id", "date", "n", "median", "mean", "min", "max", "visits", "favorites", "up", "down"],
  },
  samples: { pk: ["universe_id", "ts"], cols: ["universe_id", "ts", "playing", "visits"] },
  sort_hits: { pk: ["universe_id", "date", "sort_id"], cols: ["universe_id", "date", "sort_id", "rank"] },
  state: { pk: ["key"], cols: ["key", "value"] },
};

/**
 * UPSERT genérico: `columns` ⊆ columnas de la tabla (debe incluir la clave),
 * `rows` = arrays en ese orden. Solo escribe filas nuevas o distintas, así
 * que se puede repetir sin duplicar ni gastar escrituras.
 */
export function importStmt(db, table, columns, rows) {
  const t = IMPORT_TABLES[table];
  if (!t) throw new Error(`Tabla no permitida: ${table}`);
  for (const c of columns) if (!t.cols.includes(c)) throw new Error(`Columna no permitida: ${table}.${c}`);
  for (const k of t.pk) if (!columns.includes(k)) throw new Error(`Falta la clave ${table}.${k}`);
  const sel = columns.map((c, i) => `j.value ->> ${i}`).join(", ");
  const rest = columns.filter(c => !t.pk.includes(c));
  const upsert = rest.length
    ? `DO UPDATE SET ${rest.map(c => `${c} = excluded.${c}`).join(", ")}
       WHERE ${rest.map(c => `${table}.${c} IS NOT excluded.${c}`).join(" OR ")}`
    : "DO NOTHING";
  return db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")})
     SELECT ${sel} FROM json_each(?1) j WHERE true
     ON CONFLICT (${t.pk.join(", ")}) ${upsert}`,
  ).bind(JSON.stringify(rows));
}
