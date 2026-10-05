/**
 * cierre.parity.mjs — Las consultas del cierre del día reescritas el 05/10/2026
 * para leer menos filas dan EXACTAMENTE lo mismo que las de antes, sobre un D1
 * local (miniflare) con datos aleatorios:
 *   - radarDailyRows (JS, también por partes desde el texto de los ficheros con
 *     radarReadingsPart) + radarCloseStmt  ==  radarCloseStmt de antes (SQL con ROW_NUMBER)
 *   - closeDayStmt (sortedMedian; todos o solo los seguidos)  ==  closeDayStmt de antes
 *   - mergeHistStmt (tabla hist) y migrateHist  ==  mergeHistStmt de antes (state.hist_agg)
 *   - rebuildHistStmts  ==  rebuildHistStmt de antes
 * Mediana y media con los .5 al par (round() de Python), muestras repetidas,
 * nulos, juegos solo en el meta y filas que ya existían.
 *
 *   node --import ./test/cf_loader.mjs test/cierre.parity.mjs [--seed=N] [--rondas=N]
 *
 * Sale con código 1 si algo no cuadra.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPlatformProxy } from "wrangler";
import {
  DAY_MIN, MEAN_SQL, MEDIAN_SQL, addDays, closeDayStmt, dayStart, mergeHistStmt, migrateHist, radarCloseStmt, radarDailyRows,
  radarReadingsPart, rebuildHistStmts,
} from "../src/db.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => Number((process.argv.find(a => a.startsWith(`--${name}=`)) || `=${dflt}`).split("=")[1]);
let seed = arg("seed", 20261005);
const R = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const int = (a, b) => a + Math.floor(R() * (b - a + 1));

// ─── Referencia: las sentencias de antes (main del 05/10/2026, db.js) ───────
function old_radarCloseStmt(db, date, readings, meta) {
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
function old_closeDayStmt(db, date, votes) {
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
function old_mergeHistStmt(db, date) {
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
function old_rebuildHistStmt(db) {
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

// ─── D1 local ───────────────────────────────────────────────────────────────
const dir = mkdtempSync(join(tmpdir(), "cierre-parity-"));
const proxy = await getPlatformProxy({ configPath: resolve(HERE, "filas.wrangler.toml"), persist: { path: dir } });
const db = proxy.env.DB;
const schema = readFileSync(resolve(HERE, "../schema.sql"), "utf8").replace(/--.*$/gm, "");
for (const q of schema.split(";").map(x => x.trim()).filter(Boolean)) await db.prepare(q).run();

const ROUNDS = arg("rondas", 6);
const DATE = "2026-10-04";
const START = dayStart(DATE);
let fails = 0, checks = 0;
const same = (label, a, b) => {
  checks++;
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) return;
  fails++;
  const n = Math.max(0, [...x].findIndex((c, i) => c !== y[i]) - 120);
  console.log(`✗ ${label}\n  antes: …${x.slice(n, n + 300)}\n  ahora: …${y.slice(n, n + 300)}`);
};
const insert = (table, cols, rows) => rows.length ? db.prepare(
  `INSERT INTO ${table} (${cols.join(", ")}) SELECT ${cols.map((_, i) => `j.value ->> ${i}`).join(", ")} FROM json_each(?1) j`,
).bind(JSON.stringify(rows)).run() : null;
const dailyRows = async () => (await db.prepare("SELECT * FROM daily ORDER BY universe_id, date").all()).results;
const histJson = async () => {
  const { results } = await db.prepare("SELECT * FROM hist ORDER BY universe_id").all();
  return Object.fromEntries(results.map(r => [r.universe_id, [r.peak, r.peak_date, r.days, r.first_day, r.favorites, r.up, r.down, r.last_date]]));
};
const aggJson = async () => {
  const v = (await db.prepare("SELECT value FROM state WHERE key = 'hist_agg'").first())?.value;
  const o = v ? JSON.parse(v) : {};
  return Object.fromEntries(Object.keys(o).map(Number).sort((a, b) => a - b).map(k => [k, o[k]]));
};
const reset = () => db.batch(["DELETE FROM games", "DELETE FROM samples", "DELETE FROM daily", "DELETE FROM hist", "DELETE FROM state"].map(q => db.prepare(q)));

for (let round = 0; round < ROUNDS; round++) {
  await reset();
  const ids = [...new Set(Array.from({ length: 260 }, () => int(1_000, 9_000_000)))];
  const sel = new Set(ids.filter(() => R() < 0.4));
  await insert("games", ["universe_id", "tracked", "sel"], ids.map(id => [id, 1, sel.has(id) ? 1 : 0]));
  // Valores en un rango estrecho: muchos empates y muchas medias y medianas en .5
  const p = () => (R() < 0.5 ? int(300, 312) : int(300, 4_000_000));

  // ── closeDayStmt ──────────────────────────────────────────────────────────
  for (const onlySel of [true, false]) {
    await db.batch(["DELETE FROM samples", "DELETE FROM daily"].map(q => db.prepare(q)));
    const samples = [];
    for (const id of ids) {
      if (onlySel && !sel.has(id)) continue;
      if (R() < 0.2) continue;
      const n = int(1, 30), used = new Set();
      for (let k = 0; k < n; k++) {
        const ts = START + int(-90, DAY_MIN + 90);   // también fuera del día
        if (used.has(ts)) continue;
        used.add(ts);
        samples.push([id, ts, p(), R() < 0.3 ? null : int(1e6, 9e9)]);
      }
    }
    await insert("samples", ["universe_id", "ts", "playing", "visits"], samples);
    const pre = ids.filter(() => R() < 0.15).map(id => [id, DATE, int(1, 9), p(), p(), p(), p(), R() < 0.5 ? null : 5, R() < 0.5 ? null : 7, 1, null]);
    const votes = Object.fromEntries(ids.filter(() => R() < 0.5).map(id => [id, [R() < 0.2 ? null : int(0, 1e6), R() < 0.2 ? null : int(0, 1e6), int(0, 1e5)]]));
    const cols = ["universe_id", "date", "n", "median", "mean", "min", "max", "visits", "favorites", "up", "down"];
    for (const v of [votes, null]) {
      await db.prepare("DELETE FROM daily").run(); await insert("daily", cols, pre);
      await old_closeDayStmt(db, DATE, v).run();
      const want = await dailyRows();
      for (const selected of onlySel ? [true, false] : [false]) {
        await db.prepare("DELETE FROM daily").run(); await insert("daily", cols, pre);
        await closeDayStmt(db, DATE, v, { selected }).run();
        same(`closeDayStmt ronda ${round} (${onlySel ? "muestras de seguidos" : "de todos"}, selected=${selected}, votos=${!!v})`, want, await dailyRows());
      }
    }
  }

  // ── radarCloseStmt ────────────────────────────────────────────────────────
  {
    const pool = [...ids, ...Array.from({ length: 20 }, () => int(9_100_000, 9_200_000)), 12_345_678_901];   // algunos no están en games
    // Los ficheros del día (radar/<día>/<ts>.json) y las lecturas por juego, como las juntaba el cierre de antes
    const files = Array.from({ length: 8 }, () => Object.fromEntries(pool.filter(() => R() < 0.6).map(id => [id, R() < 0.05 ? null : p()])));
    const readings = {}, meta = {};
    for (const f of files) for (const id in f) (readings[id] ||= []).push(f[id]);
    for (const id of pool) if (R() < 0.4) meta[id] = [R() < 0.15 ? null : p(), R() < 0.3 ? null : int(1e6, 9e9)];
    const texts = files.map(f => JSON.stringify(f));
    texts.push(JSON.stringify({ [pool[0]]: 400 }, null, 1));   // otra forma: se parsea entero
    readings[pool[0]] = [...(readings[pool[0]] || []), 400];
    const cols = ["universe_id", "date", "n", "median", "mean", "min", "max", "visits"];
    const pre = ids.filter(() => R() < 0.3).map(id => [id, DATE, int(1, 9), p(), p(), p(), p(), R() < 0.5 ? null : int(1e6, 9e9)]);
    for (const [r, m] of [[readings, meta], [readings, null], [null, meta], [{}, {}]]) {
      await db.prepare("DELETE FROM daily").run(); await insert("daily", cols, pre);
      await old_radarCloseStmt(db, DATE, r, m).run();
      const want = await dailyRows();
      await db.prepare("DELETE FROM daily").run(); await insert("daily", cols, pre);
      await radarCloseStmt(db, DATE, radarDailyRows(r, m)).run();
      same(`radarCloseStmt ronda ${round} (lecturas=${!!r}, meta=${!!m})`, want, await dailyRows());
      // Por partes desde el texto de los ficheros, como el paso close-radar-<día>-<k>
      for (const parts of [1, 4]) {
        await db.prepare("DELETE FROM daily").run(); await insert("daily", cols, pre);
        for (let k = 0; k < parts; k++) {
          const rows = radarDailyRows(r === readings ? radarReadingsPart(texts, k, parts) : r && new Map(), m, k, parts);
          if (rows.length) await radarCloseStmt(db, DATE, rows).run();
        }
        same(`radarCloseStmt ronda ${round} por ${parts} partes (lecturas=${!!r}, meta=${!!m})`, want, await dailyRows());
      }
    }
  }

  // ── hist: mergeHistStmt, migrateHist y rebuildHistStmts ───────────────────
  {
    await db.batch(["DELETE FROM daily", "DELETE FROM hist", "DELETE FROM state"].map(q => db.prepare(q)));
    const days = Array.from({ length: 25 }, (_, i) => addDays("2026-09-01", i));
    const rows = [];
    for (const id of ids) for (const d of days) {
      if (R() < 0.3) continue;
      rows.push([id, d, int(1, 24), p(), p(), p(), R() < 0.05 ? null : p(), int(1e6, 9e9),
        R() < 0.2 ? (R() < 0.5 ? 0 : null) : int(1, 1e6), R() < 0.2 ? null : int(0, 1e6), R() < 0.2 ? null : int(0, 1e5)]);
    }
    const cols = ["universe_id", "date", "n", "median", "mean", "min", "max", "visits", "favorites", "up", "down"];
    await insert("daily", cols, rows);
    // Orden de cierres: los días en orden, uno repetido (votos nuevos del mismo día) y uno viejo fuera de orden
    const order = [...days.slice(0, 12), days[11], days[3], ...days.slice(12)];
    const revote = async d => db.prepare("UPDATE daily SET favorites = favorites + 1, up = COALESCE(up, 0) + 2 WHERE date = ?1").bind(d).run();
    const run = async (fn, list) => { for (const [i, d] of list.entries()) { if (i === 12) await revote(d); await fn(d); } };
    await insert("daily", cols, []);
    const snapshot = (await dailyRows()).map(r => cols.map(c => r[c]));

    await run(d => old_mergeHistStmt(db, d).run(), order);
    const want = await aggJson();
    // Con la tabla desde el principio
    await db.prepare("DELETE FROM daily").run(); await insert("daily", cols, snapshot);
    await run(d => mergeHistStmt(db, d).run(), order);
    same(`mergeHistStmt ronda ${round}`, want, await histJson());
    // La mitad con hist_agg, migrar y la otra mitad con la tabla
    await db.batch(["DELETE FROM daily", "DELETE FROM hist", "DELETE FROM state"].map(q => db.prepare(q)));
    await insert("daily", cols, snapshot);
    const half = 9;
    for (const [i, d] of order.entries()) {
      if (i === 12) await revote(d);
      if (i < half) await old_mergeHistStmt(db, d).run();
      else {
        if (i === half) await migrateHist(db);
        await mergeHistStmt(db, d).run();
      }
    }
    same(`migrateHist a mitad ronda ${round}`, want, await histJson());
    same(`migrateHist borra hist_agg ronda ${round}`, {}, await aggJson());
    // rebuild
    await old_rebuildHistStmt(db).run();
    const wantRebuild = await aggJson();
    await db.batch(rebuildHistStmts(db));
    same(`rebuildHistStmts ronda ${round}`, wantRebuild, await histJson());
    same(`rebuildHistStmts borra hist_agg ronda ${round}`, {}, await aggJson());
  }
}

// migrateHist sin la tabla (código desplegado antes que el esquema): la crea
await db.prepare("DROP TABLE hist").run();
await db.prepare("INSERT INTO state (key, value) VALUES ('hist_agg', '{\"7\":[10,\"2026-10-01\",3,\"2026-09-29\",5,6,7,\"2026-10-01\"]}')").run();
await migrateHist(db);
same("migrateHist sin la tabla hist", { 7: [10, "2026-10-01", 3, "2026-09-29", 5, 6, 7, "2026-10-01"] }, await histJson());

await proxy.dispose();
rmSync(dir, { recursive: true, force: true });
console.log(fails ? `✗ ${fails} de ${checks} comprobaciones distintas` : `✓ ${checks} comprobaciones idénticas a las consultas de antes`);
process.exit(fails ? 1 : 0);
