/**
 * filas.bench.mjs — Filas de D1 (leídas y escritas) de pasadas COMPLETAS del
 * muestreo: el Workflow `Sampler` de verdad, con Roblox y Rolimons simulados,
 * R2 en memoria y un D1 local (miniflare) del tamaño de producción.
 *
 *   node --import ./test/cf_loader.mjs test/filas.bench.mjs [hoy|regimen|anio|todos|regimen,anio] [--src=src] [-v] [--dia] [--seed]
 *     [--sin-topes] [--sin-cascada] [--exacto] [--salida=<carpeta>]
 *
 * El plan gratis da 5 M filas leídas al día a TODA la cuenta, y al pasarse D1
 * cae en todas las apps hasta las 00:00 UTC: esta prueba falla si una pasada se
 * pasa de su tope o si una consulta crece con el tamaño de la base.
 *
 * Escenarios (2.953 juegos, 2.797 en el radar, 242 seguidos, como el 05/10/2026):
 *   hoy      ~4 días de muestras, 10 filas diarias por juego, 3 días de puestos
 *   regimen  9 días de muestras, 30 filas diarias, 30 días de puestos
 *   anio     9 días de muestras, 365 filas diarias (~1 M), 365 días de puestos (~650 k)
 * La base se siembra una vez en test/.filas/<escenario>/semilla (--seed la
 * rehace) como estaba en producción antes de este cambio (con state.hist_agg)
 * y cada prueba trabaja sobre una copia.
 *
 * Pasadas: 23:00 (calentamiento: la primera tras desplegar, con lo que haya que
 * migrar) → 00:00 (la primera del día: meta, cierre, selección, mantenimiento y
 * export_d nuevo) → 01:00 y 02:00 (normales) → 03:00 (con radar). Día ≈
 * 00:00 + 7 × radar + 16 × normal; con --dia se corren las 24 de verdad.
 *
 * Comprobaciones (salvo --sin-topes):
 *   - cada pasada, por debajo de TOPES (≈ 20 % sobre lo medido el 05/10/2026);
 *   - ninguna consulta lee > 20 % (y > 10.000 filas) más en `anio` que en
 *     `regimen` (misma pasada y misma consulta): eso es recorrer daily o
 *     sort_hits enteras, que crecen con los días.
 * Y con `regimen` (salvo --sin-cascada): «cascada» (un cierre que falla
 * siempre), «cortes» (dos pasadas que se cortan antes de las tareas del día
 * no les gastan los intentos, y maint borra lo que deja en tmp/run/ una pasada
 * cortada hace más de un día) y «despliegue» (una ejecución encadenada del
 * código de antes hace el cierre de las 00:00: hist tiene que acabar igual que
 * recalculada desde daily, con y sin el esquema aplicado).
 * --src=<carpeta> mide otra versión del código (p. ej. una copia de main) con
 * los mismos datos: así se compara antes y después. --salida=<carpeta> guarda
 * el export y telegram.json de cada pasada (para `cmp -r` entre versiones).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPlatformProxy } from "wrangler";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const args = process.argv.slice(2);
const arg = (name, dflt) => (args.find(a => a.startsWith(`--${name}=`)) || `=${dflt ?? ""}`).split("=").slice(1).join("=");
const flag = name => args.includes(name);
const SRC = resolve(arg("src", resolve(ROOT, "src")));
const VERBOSE = flag("-v");
const SCEN = {
  hoy: { sampleDays: 3.9, dailyPerGame: 10, sortDays: 3 },
  regimen: { sampleDays: 9, dailyPerGame: 30, sortDays: 30 },
  anio: { sampleDays: 9, dailyPerGame: 365, sortDays: 365 },
};
// Topes por pasada (filas leídas), ~20 % sobre lo medido tras optimizar (05/10/2026, con --dia):
//            00:00    normal (01:00 → 23:00)   radar (03:00)   día
//   hoy      181 k    15 k → 21,6 k            24,7 k          691 k
//   regimen  212 k    15 k → 21,6 k            24,7 k          722 k
//   anio     217 k    15 k → 21,6 k            24,7 k          727 k
// (la pasada normal crece durante el día: los que entran en la selección a las
// 00:00 solo traen el relleno del radar y van sumando muestras de 48 h)
const TOPES = {
  hoy: { "00:00": 217_000, normal: 26_000, radar: 30_000, dia: 830_000 },
  regimen: { "00:00": 254_000, normal: 26_000, radar: 30_000, dia: 866_000 },
  anio: { "00:00": 261_000, normal: 26_000, radar: 30_000, dia: 873_000 },
};
const CRECE = { factor: 1.2, filas: 10_000 };   // anio frente a regimen

const wanted = (args.find(a => !a.startsWith("-")) || "todos");
const scens = wanted === "todos" ? ["hoy", "regimen", "anio"] : wanted.split(",");
if (scens.some(s => !SCEN[s])) throw new Error(`Escenario desconocido: ${wanted}`);

const mod = f => import(pathToFileURL(resolve(SRC, f)).href);
const D = await mod("db.js");
const { Sampler } = await mod("sampler.js");
const { classifyHorror } = await mod("horror.js");
const { TRACK_MIN_PLAYERS } = await mod("config.js");
const { espacioD1 } = await mod("stonks.js");

// ─── El mundo simulado (determinista) ───────────────────────────────────────
const NG = 2953, NT = 2797, NSEL = 242, NPLACES = 2582;
const DAY0 = "2026-10-05";                       // día de la semilla (abierto); 2026-10-04 cerrado
const T0 = D.dayStart(DAY0) + 22 * 60;           // última muestra de la semilla: 05/10 22:00
const rng = seed => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const R = rng(12345);
const ids = [...new Set(Array.from({ length: NG + 50 }, () => 1_000_000 + Math.floor(R() * 10_767_000_000)))].slice(0, NG).sort((a, b) => a - b);
const tracked = ids.slice(0, NT).sort(() => R() - 0.5);
const trackedSet = new Set(tracked);
const base = new Map(ids.map(id => [id, 150 + Math.floor(20000 * R() ** 3)]));
const sel0 = [...tracked].sort((a, b) => base.get(b) - base.get(a)).slice(0, NSEL).sort((a, b) => a - b);
const horrorish = new Set(ids.filter(() => R() < 0.25));
const pidOf = id => id * 3 + 1;
const idOfPid = new Map(ids.map(id => [pidOf(id), id]));
const unknownPids = Array.from({ length: 60 }, (_, i) => 9_000_000_000_000 + i * 7);
const frac = x => x - Math.floor(x);
const playing = (id, ts) => Math.round(base.get(id) * (0.75 + 0.5 * frac(Math.sin(id * 0.001 + ts * 0.37) * 10000)));
const visits = (id, ts) => base.get(id) * 1000 + Math.floor(ts / 60) * 7;
const metaOf = (id, i) => ({
  name: `Juego ${i}`, description: horrorish.has(id) ? "A scary horror game: escape the monster, survive the night" : "Build your tycoon with friends",
  creator: { name: `Creador ${i % 400}`, hasVerifiedBadge: i % 7 === 0 },
  created: "2026-08-01T00:00:00Z", updated: "2026-10-01T00:00:00Z",
  genre: "All", genre_l1: horrorish.has(id) ? "Horror" : "Simulation", genre_l2: "Tycoon", maxPlayers: 12,
});
const idx = new Map(ids.map((id, i) => [id, i]));

let NOW_TS = T0;
function fakeFetch(url) {
  const u = new URL(String(url));
  const ok = body => new Response(typeof body === "string" ? body : JSON.stringify(body), { headers: { "content-type": "application/json" } });
  const h = Math.floor(NOW_TS / 60);
  if (u.hostname === "api.rolimons.com") {
    const games = {};
    for (const id of tracked) {
      const p = playing(id, NOW_TS);
      if (p >= 150 && (id % 9) !== 0) games[pidOf(id)] = [`Juego ${idx.get(id)}`, p, "icon"];
    }
    unknownPids.forEach((pid, i) => { games[pid] = [`Nuevo ${i}`, 400 + i, "icon"]; });
    return ok({ success: true, game_count: Object.keys(games).length, games });
  }
  if (u.pathname.endsWith("/get-sorts")) {
    const page = Number(u.searchParams.get("sortsPageToken") || 0);
    const sorts = Array.from({ length: 4 }, (_, k) => {
      const n = page * 4 + k;
      return {
        contentType: "Games", sortId: n === 0 ? "top-trending" : n === 1 ? "up-and-coming" : `sort-${n}`,
        nextPageToken: k < 1 ? `t${n}` : null,
        games: Array.from({ length: 40 }, (_, j) => tracked[(n * 97 + j * 13 + h) % 600]).map(gameTuple),
      };
    });
    return ok({ sorts, nextSortsPageToken: page < 4 ? String(page + 1) : null });
  }
  if (u.pathname.endsWith("/get-sort-content")) {
    return ok({ games: Array.from({ length: 40 }, (_, j) => tracked[(j * 17 + h) % 900]).map(gameTuple), nextPageToken: null });
  }
  if (u.pathname.endsWith("/omni-search")) {
    return ok({ searchResults: [{ contentGroupType: "Game", contents: Array.from({ length: 50 }, (_, j) => tracked[(j * 31 + h) % 1200]).map(gameTuple) }] });
  }
  if (u.hostname === "games.roblox.com" && u.pathname === "/v1/games") {
    const list = (u.searchParams.get("universeIds") || "").split(",").map(Number).filter(id => base.has(id));
    return ok({
      data: list.map(id => ({
        id, rootPlaceId: pidOf(id), ...metaOf(id, idx.get(id)),
        playing: playing(id, NOW_TS), visits: visits(id, NOW_TS), favoritedCount: base.get(id) * 10 + Math.floor(NOW_TS / 1440),
      })),
    });
  }
  if (u.pathname === "/v1/games/votes") {
    const list = (u.searchParams.get("universeIds") || "").split(",").map(Number);
    return ok({ data: list.map(id => ({ id, upVotes: (base.get(id) || 1) * 5, downVotes: base.get(id) || 1 })) });
  }
  if (u.hostname === "apis.roblox.com" && u.pathname.startsWith("/universes/v1/places/")) {
    const pid = Number(u.pathname.split("/")[4]);
    return ok({ universeId: idOfPid.get(pid) ?? null });
  }
  return ok({ data: [] });   // miniaturas, iconos
}
function gameTuple(id) {
  return { universeId: id, rootPlaceId: pidOf(id), name: `Juego ${idx.get(id)}`, playerCount: playing(id, NOW_TS) };
}

// ─── R2 en memoria ──────────────────────────────────────────────────────────
function memBucket() {
  const store = new Map(), uploaded = new Map();   // uploaded: con la hora simulada
  const text = async v => typeof v === "string" ? v : v instanceof ReadableStream ? new Response(v).text() : new TextDecoder().decode(v);
  const obj = (k, t) => ({ key: k, size: Buffer.byteLength(t), text: async () => t, json: async () => JSON.parse(t), get body() { return new Response(t).body; }, httpEtag: "x" });
  return {
    store,
    seed(k, t, date) { store.set(k, t); uploaded.set(k, date); },
    async put(k, v) { const t = await text(v); store.set(k, t); uploaded.set(k, new Date(NOW_TS * 60000)); return { key: k, size: Buffer.byteLength(t) }; },
    async get(k) { return store.has(k) ? obj(k, store.get(k)) : null; },
    async head(k) { return store.has(k) ? obj(k, store.get(k)) : null; },
    async list({ prefix = "", limit = 1000 } = {}) {
      const keys = [...store.keys()].filter(k => k.startsWith(prefix)).sort().slice(0, limit);
      return { objects: keys.map(key => ({ key, size: Buffer.byteLength(store.get(key)), uploaded: uploaded.get(key) })), truncated: false, delimitedPrefixes: [] };
    },
    async delete(keys) { for (const k of [].concat(keys)) { store.delete(k); uploaded.delete(k); } },
  };
}
globalThis.FixedLengthStream ??= class { constructor() { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; } };

// ─── Semilla ────────────────────────────────────────────────────────────────
async function seed(raw, s) {
  const schema = readFileSync(resolve(ROOT, "schema.sql"), "utf8").replace(/--.*$/gm, "");
  for (const q of schema.split(";").map(x => x.trim()).filter(Boolean)) await raw.prepare(q).run();
  const chunked = async (sql, rows, n = 20000) => {
    for (let i = 0; i < rows.length; i += n) await raw.prepare(sql).bind(JSON.stringify(rows.slice(i, i + n))).run();
  };
  const selSet = new Set(sel0);
  await chunked(`INSERT INTO games (universe_id, place_id, name, creator, creator_verified, created, updated, genre, genre_l1, genre_l2,
      max_players, first_seen, horror, horror_score, horror_reasons, sources, tracked, low_since, meta_date, sel)
    SELECT j.value->>0, j.value->>1, j.value->>2, j.value->>3, j.value->>4, j.value->>5, j.value->>6, j.value->>7, j.value->>8, j.value->>9,
      j.value->>10, j.value->>11, j.value->>12, j.value->>13, j.value->>14, j.value->>15, j.value->>16, j.value->>17, j.value->>18, j.value->>19
    FROM json_each(?1) j`, ids.map((id, i) => {
    const m = metaOf(id, i);
    const hz = classifyHorror({ universe_id: id, name: m.name, description: m.description, genre: m.genre, genre_l1: m.genre_l1, genre_l2: m.genre_l2 });
    return [id, pidOf(id), m.name, m.creator.name, m.creator.hasVerifiedBadge ? 1 : 0, m.created, m.updated, m.genre, m.genre_l1, m.genre_l2,
      m.maxPlayers, "2026-08-01T00:00Z", hz.horror ? 1 : 0, hz.score, JSON.stringify(hz.reasons || []),
      i % 2 ? '["rolimons"]' : '["rolimons","explore"]', trackedSet.has(id) ? 1 : 0,
      base.get(id) < TRACK_MIN_PLAYERS ? "2026-10-01" : null, DAY0, selSet.has(id) ? 1 : 0];
  }));
  await chunked(`INSERT INTO places (place_id, universe_id) SELECT j.value->>0, j.value->>1 FROM json_each(?1) j`,
    ids.slice(0, NPLACES).map(id => [pidOf(id), id]));
  const samp = [];
  const n = Math.round(s.sampleDays * 24);
  for (const id of sel0) for (let k = 0; k < n; k++) {
    const ts = T0 - k * 60, p = playing(id, ts);
    if (p >= TRACK_MIN_PLAYERS) samp.push([id, ts, p, visits(id, ts)]);
  }
  await chunked(`INSERT INTO samples (universe_id, ts, playing, visits) SELECT j.value->>0, j.value->>1, j.value->>2, j.value->>3 FROM json_each(?1) j`, samp);
  const daily = [];
  for (const id of tracked) for (let d = 1; d <= s.dailyPerGame; d++) {
    const date = D.addDays(DAY0, -d), t = D.dayStart(date) + 720, p = playing(id, t);
    daily.push([id, date, 8, p, p, Math.round(p * 0.8), Math.round(p * 1.2), visits(id, t), base.get(id) * 10, base.get(id) * 5, base.get(id)]);
  }
  await chunked(`INSERT INTO daily (universe_id, date, n, median, mean, min, max, visits, favorites, up, down)
    SELECT j.value->>0, j.value->>1, j.value->>2, j.value->>3, j.value->>4, j.value->>5, j.value->>6, j.value->>7, j.value->>8, j.value->>9, j.value->>10
    FROM json_each(?1) j`, daily);
  const hits = [];
  const sorts = ["top-trending", "up-and-coming", "popular", "top-earning", "fun-with-friends", "search:horror"];
  const RH = rng(777);
  for (let d = 0; d < s.sortDays; d++) for (let k = 0; k < 1900; k++) hits.push([tracked[Math.floor(RH() * NT)], D.addDays(DAY0, -d), sorts[k % 6], k % 100 + 1]);
  await chunked(`INSERT OR IGNORE INTO sort_hits (universe_id, date, sort_id, rank) SELECT j.value->>0, j.value->>1, j.value->>2, j.value->>3 FROM json_each(?1) j`, hits);
  // Como en producción antes de la tabla `hist`: los agregados en state.hist_agg
  await raw.prepare(`WITH a AS (SELECT universe_id AS id, MAX(max) AS peak, MIN(date) AS first_day, COUNT(*) AS days, MAX(date) AS last FROM daily GROUP BY universe_id),
     pk AS (SELECT d.universe_id AS id, MIN(d.date) AS pd FROM daily d JOIN a ON a.id = d.universe_id AND d.max = a.peak GROUP BY d.universe_id),
     lv AS (SELECT universe_id AS id, favorites, up, down FROM daily d WHERE date = (SELECT MAX(date) FROM daily WHERE universe_id = d.universe_id))
     INSERT INTO state (key, value) SELECT 'hist_agg', json_group_object(a.id, json_array(a.peak, pk.pd, a.days, a.first_day, lv.favorites, lv.up, lv.down, a.last))
     FROM a LEFT JOIN pk ON pk.id = a.id LEFT JOIN lv ON lv.id = a.id`).run();
  const st = {
    day: DAY0, closed_day: D.addDays(DAY0, -1), sel_day: DAY0, maint_day: DAY0, sel_ids: sel0,
    last_sample_ts: T0, search_cursor: 0, selection: { day: DAY0, total: NSEL },
  };
  for (const [k, v] of Object.entries(st)) await D.setState(raw, k, v);
}

/** Ficheros del radar de los dos días anteriores a la primera pasada (cierre y relleno). */
function seedRadar(bucket) {
  for (const date of [D.addDays(DAY0, -1), DAY0]) {
    for (let h = 0; h < 24; h += 3) {
      const ts = D.dayStart(date) + h * 60;
      if (ts > T0) continue;
      const players = {};
      for (const id of tracked) { const p = playing(id, ts); if (p >= 150) players[id] = p; }
      bucket.store.set(`roblox-tracker/radar/${date}/${ts}.json`, JSON.stringify(players));
    }
  }
}

// ─── Contador de filas ──────────────────────────────────────────────────────
function counting(raw, log, tagRef, fallos = new Set()) {
  const add = (sql, meta) => log.push({ tag: tagRef.tag, sql: sql.replace(/\s+/g, " ").trim().slice(0, 80), read: meta?.rows_read ?? 0, written: meta?.rows_written ?? 0 });
  // fallos: pasos cuyos batch fallan; tagRef.corte: un paso en el que falla todo (la ejecución se corta)
  const corte = () => { if (tagRef.corte && tagRef.tag === tagRef.corte) throw new Error(`corte simulado en ${tagRef.tag}`); };
  class Stmt {
    constructor(s, sql) { this.s = s; this.sql = sql; }
    bind(...a) { return new Stmt(this.s.bind(...a), this.sql); }
    async all() { corte(); const r = await this.s.all(); add(this.sql, r.meta); return r; }
    async run() { corte(); const r = await this.s.run(); add(this.sql, r.meta); return r; }
    async raw(o) { return this.s.raw(o); }
    // first() de D1 no devuelve meta: se hace con all() para contar sus filas
    async first(col) { const row = (await this.all()).results[0]; return row ? (col ? row[col] : row) : null; }
  }
  return {
    prepare: sql => new Stmt(raw.prepare(sql), sql),
    async batch(list) {
      corte();
      if (fallos.has(tagRef.tag)) throw new Error(`fallo simulado en ${tagRef.tag}`);
      const r = await raw.batch(list.map(x => x.s));
      r.forEach((x, i) => add(list[i].sql, x.meta));
      return r;
    },
    exec: sql => raw.exec(sql),
  };
}

// ─── Una pasada: la cadena de ejecuciones del Workflow ─────────────────────
async function pasada(env, tagRef, iso, params = null) {
  NOW_TS = D.minuteOf(Date.parse(iso));
  const queue = [{ id: `cron-${iso.slice(0, 16)}`, params: params || { now: iso } }];
  env.SAMPLER = { create: async ({ id, params }) => { queue.push({ id, params }); return { id }; }, get: async () => ({ status: async () => ({}) }) };
  const errors = [];
  let summary = null;
  while (queue.length) {
    const { id, params } = queue.shift();
    const step = {
      do: async (name, a, b) => { tagRef.tag = name.replace(/\d+/g, "#"); return (b || a)(); },
      sleep: async () => {},
    };
    try {
      summary = await new Sampler({}, env).run({ payload: params, instanceId: id, timestamp: Date.parse(iso) }, step);
      errors.push(...(summary?.errors || []));
    } catch (e) {
      // Un paso sin safe() que falla tumba la ejecución (y la cadena se corta ahí)
      errors.push(`ejecución cortada: ${String(e?.message || e).slice(0, 120)}`);
    }
  }
  return { errors: [...new Set(errors)], summary };
}

const sum = (list, k) => list.reduce((a, x) => a + x[k], 0);
const fmt = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

async function scenario(name, { hours, fallos = new Set(), cortes = {}, primera = null, work = "trabajo", espacio = false, alPrincipio = null, alFinal = null } = {}) {
  const dir = resolve(HERE, ".filas", name);
  const seedDir = resolve(dir, "semilla"), workDir = resolve(dir, work);
  if ((flag("--seed") && !seeded.has(name)) || !existsSync(resolve(seedDir, "ok"))) {
    rmSync(seedDir, { recursive: true, force: true });
    mkdirSync(seedDir, { recursive: true });
    const p = await getPlatformProxy({ configPath: resolve(HERE, "filas.wrangler.toml"), persist: { path: seedDir } });
    await seed(p.env.DB, SCEN[name]);
    await p.dispose();
    writeFileSync(resolve(seedDir, "ok"), new Date().toISOString());
  }
  seeded.add(name);
  rmSync(workDir, { recursive: true, force: true });
  cpSync(seedDir, workDir, { recursive: true });
  const proxy = await getPlatformProxy({ configPath: resolve(HERE, "filas.wrangler.toml"), persist: { path: workDir } });
  const log = [], tagRef = { tag: "" };
  const bucket = memBucket();
  seedRadar(bucket);
  const env = { DB: counting(proxy.env.DB, log, tagRef, fallos), BUCKET: bucket };
  if (alPrincipio) await alPrincipio(proxy.env.DB, bucket);
  const runs = [];
  for (const [k, iso] of hours.entries()) {
    const hh = k === 0 ? "cal" : iso.slice(0, 10) > D.addDays(DAY0, 1) ? "00+1" : iso.slice(11, 13);
    const i = log.length;
    tagRef.corte = cortes[hh] || null;
    const { errors, summary } = await pasada(env, tagRef, iso, k === 0 ? primera?.(iso) : null);
    tagRef.corte = null;
    const q = log.slice(i);
    const st = await D.getStates(proxy.env.DB, ["meta_day", "closed_day", "sel_day", "maint_day", "daily_tries"]);
    runs.push({ iso, hh, read: sum(q, "read"), written: sum(q, "written"), q, errors, summary, st });
    // --salida=<carpeta>: el export de cada pasada, para compararlo con el de otra versión (cmp)
    if (arg("salida")) {
      mkdirSync(resolve(arg("salida"), name, work), { recursive: true });
      for (const k of ["export", "telegram"]) {
        writeFileSync(resolve(arg("salida"), name, work, `${k}-${iso.slice(0, 13)}.json`), bucket.store.get(`roblox-tracker/data/${k}.json`) || "");
      }
    }
  }
  // espacio() del Almacén: el desglose se rehace como mucho una vez al día
  let esp = null;
  if (espacio) {
    await proxy.env.DB.prepare("DELETE FROM state WHERE key = 'espacio'").run();
    const i = log.length;
    tagRef.tag = "espacio";
    const r = await espacioD1(env.DB);
    const q = log.slice(i);
    esp = { read: sum(q, "read"), written: sum(q, "written"), q, tablas: r.base.tablas };
    if (flag("--exacto")) {
      const ex = await espacioD1(proxy.env.DB, { exacto: true });
      esp.exacto = ex.base.tablas;
    }
  }
  const extra = alFinal ? await alFinal(proxy.env.DB, bucket) : null;
  await proxy.dispose();
  return { runs, esp, extra };
}

const seeded = new Set();
/** 05/10 23:00 (calentamiento) y `n` pasadas cada hora desde el 06/10 00:00. */
const horas = n => [T0 + 60, ...Array.from({ length: n }, (_, h) => D.dayStart(D.addDays(DAY0, 1)) + h * 60)]
  .map(ts => new Date(ts * 60000).toISOString());

// La consola del Workflow (Telegram sin token escribe sus mensajes) no ensucia la salida
const out = (...a) => process.stdout.write(a.join(" ") + "\n");
console.log = () => {};
console.warn = () => {};
globalThis.fetch = async (url) => fakeFetch(url);

const results = {};
let fail = false;
const kind = r => (r.hh === "cal" ? "calentamiento" : r.hh === "00" || r.hh === "00+1" ? "00:00" : Number(r.hh) % 3 === 0 ? "radar" : "normal");
function printRun(r) {
  out(`${r.iso.slice(0, 16)}  ${kind(r).padEnd(13)} ${fmt(r.read).padStart(10)} leídas ${fmt(r.written).padStart(8)} escritas${r.errors.length ? `  ERRORES: ${r.errors.join(" | ")}` : ""}`);
  const steps = {};
  for (const x of r.q) {
    const st = (steps[x.tag] ||= { read: 0, written: 0, q: {} });
    st.read += x.read; st.written += x.written;
    const e = (st.q[x.sql] ||= { read: 0, written: 0, n: 0 });
    e.read += x.read; e.written += x.written; e.n++;
  }
  for (const [tag, st] of Object.entries(steps).sort((a, b) => b[1].read - a[1].read)) {
    if (!VERBOSE && st.read < 1000) continue;
    out(`    ${fmt(st.read).padStart(9)} r ${fmt(st.written).padStart(7)} w  ${tag}`);
    if (VERBOSE) for (const [sql, e] of Object.entries(st.q).sort((a, b) => b[1].read - a[1].read)) out(`        ${fmt(e.read).padStart(9)} r ${fmt(e.written).padStart(7)} w ×${e.n}  ${sql}`);
  }
}

for (const name of scens) {
  const hours = horas(flag("--dia") ? 25 : 4);
  const { runs, esp } = await scenario(name, { hours, espacio: true });
  const by = hh => runs.find(r => r.hh === hh);
  const day = runs.filter(r => r.hh !== "cal" && r.hh !== "00+1");
  const total = k => flag("--dia")
    ? day.reduce((a, r) => a + r[k], 0)
    : by("00")[k] + 7 * by("03")[k] + 8 * (by("01")[k] + by("02")[k]);
  const dia = total("read") + esp.read, diaW = total("written") + esp.written;
  results[name] = { runs, dia };
  out(`\n══ ${name} (${SRC === resolve(ROOT, "src") ? "src" : SRC}) ══`);
  for (const r of runs) {
    printRun(r);
    if (r.errors.length && r.hh !== "cal") fail = true;
  }
  out(`espacio() (Almacén, desglose rehecho: 1 al día) ${fmt(esp.read).padStart(10)} leídas ${fmt(esp.written).padStart(8)} escritas`);
  if (VERBOSE) for (const x of esp.q) out(`        ${fmt(x.read).padStart(9)} r ${fmt(x.written).padStart(7)} w  ${x.sql}`);
  if (esp.exacto) for (const t of esp.tablas) out(`        ${t.nombre.padEnd(10)} estimadas ${fmt(t.filas).padStart(9)} · exactas ${fmt(esp.exacto.find(e => e.nombre === t.nombre)?.filas ?? "?").padStart(9)}`);
  out(`Día (${flag("--dia") ? "24 pasadas" : "00:00 + 7 × radar + 16 × normal"} + espacio()): ${fmt(dia)} leídas, ${fmt(diaW)} escritas`);
  if (!flag("--sin-topes")) {
    const t = TOPES[name];
    const check = (label, got, tope) => {
      if (tope && got > tope) { fail = true; out(`✗ ${label}: ${fmt(got)} > tope ${fmt(tope)}`); }
    };
    for (const r of runs) {
      if (r.hh !== "cal") check(`pasada de las ${r.iso.slice(11, 16)} (${kind(r)})`, r.read, t[kind(r)]);
    }
    check("día", dia, t.dia);
  }
}

// Un cierre que falla no repite cada hora las tareas del día: cada una tiene su
// marca y como mucho DAILY_TRIES intentos (antes, ~450.000 filas por hora)
if (scens.includes("regimen") && !flag("--sin-cascada")) {
  const { runs } = await scenario("regimen", { hours: horas(5), fallos: new Set(["close"]), work: "cascada" });
  out("\n══ cascada: el cierre falla siempre (regimen) ══");
  const didMeta = r => r.q.some(x => x.sql.startsWith("UPDATE games SET place_id"));
  const didClose = r => r.errors.some(e => e.startsWith("close:"));
  for (const r of runs) {
    out(`${r.iso.slice(0, 16)}  ${fmt(r.read).padStart(10)} leídas${didMeta(r) ? "  meta" : ""}${didClose(r) ? "  cierre (falla)" : ""}`);
  }
  const later = runs.filter(r => ["02", "03", "04"].includes(r.hh));
  const tope = TOPES.regimen.radar || Infinity;
  const metaRuns = runs.filter(r => r.hh !== "cal" && didMeta(r)).length;
  const closeRuns = runs.filter(r => r.hh !== "cal" && didClose(r)).length;
  if (metaRuns > 1 || closeRuns > 2 || later.some(r => r.read > tope)) {
    fail = true;
    out(`✗ cascada: meta en ${metaRuns} pasadas, cierre en ${closeRuns}; 02–04 h: ${later.map(r => fmt(r.read)).join(" / ")} leídas`);
  } else out(`✓ cascada: meta en ${metaRuns} pasada, cierre en ${closeRuns} (tope ${2}); 02–04 h: ${later.map(r => fmt(r.read)).join(" / ")} leídas`);
}

// Una pasada que se corta antes de las tareas del día no gasta sus intentos:
// a las 00:00 y a la 01:00 falla sample-list (sin safe(): la ejecución se
// corta antes del meta, el cierre, select y maint) y a las 02:00 se hacen todas
// Y lo que una pasada cortada deja en tmp/run/ (no llega a su `finish`) lo
// borra maint cuando tiene más de un día; lo de las cortadas de hace 1–2 h se
// queda (podría ser una pasada que sigue en marcha)
if (scens.includes("regimen") && !flag("--sin-cascada")) {
  const VIEJO = "roblox-tracker/tmp/run/cron-2026-10-04T05:00/ids.json";
  const { runs, extra } = await scenario("regimen", {
    hours: horas(3), cortes: { "00": "sample-list-#", "01": "sample-list-#" }, work: "cortes",
    alPrincipio: async (db, bucket) => bucket.seed(VIEJO, "{}", new Date(D.dayStart("2026-10-04") * 60000 + 5 * 3600_000)),
    alFinal: async (db, bucket) => ({
      viejo: bucket.store.has(VIEJO),
      cortadas: [...bucket.store.keys()].filter(k => /\/tmp\/run\/cron-2026-10-06T0[01]:00\//.test(k)).length,
      ultima: [...bucket.store.keys()].filter(k => k.includes("/tmp/run/cron-2026-10-06T02:00")).length,
    }),
  });
  out("\n══ cortes: las pasadas de las 00:00 y la 01:00 se cortan antes de las tareas del día (regimen) ══");
  for (const r of runs) out(`${r.iso.slice(0, 16)}  ${fmt(r.read).padStart(10)} leídas  ${JSON.stringify(r.st)}${r.errors.length ? `  ${r.errors.join(" | ").slice(0, 120)}` : ""}`);
  const last = runs[runs.length - 1], today = last.iso.slice(0, 10);
  const done = last.st.meta_day === today && last.st.closed_day === D.addDays(today, -1) && last.st.sel_day === today && last.st.maint_day === today;
  if (!done || last.errors.length) { fail = true; out("✗ cortes: a las 02:00 no se han hecho las tareas del día"); }
  else out("✓ cortes: las pasadas cortadas no gastan intentos; a las 02:00 se hacen meta, cierre, select y maint");
  if (extra.viejo || !extra.cortadas || extra.ultima) {
    fail = true;
    out(`✗ tmp/run: ${extra.viejo ? "lo de una pasada cortada hace 2 días sigue ahí" : "bien lo viejo"}; ${extra.cortadas} ficheros de las cortadas de hoy (tienen que quedarse); ${extra.ultima} de la de las 02:00 (finish los borra)`);
  } else out(`✓ tmp/run: maint borra lo de una pasada cortada hace 2 días y deja lo de las de hace 1–2 h (${extra.cortadas} ficheros)`);
}

// Desplegar a media pasada: una ejecución encadenada que creó el código de
// antes (init sin `daily`, sin pasar por el init nuevo ni por la migración)
// hace el cierre de las 00:00 y el export. La tabla hist tiene que acabar
// igual que recalculada desde daily (con state.hist_agg migrado antes de
// escribir en ella) y el export no puede salir sin los datos de hist.
// Con el esquema aplicado antes (tabla hist vacía) y sin él (la crea migrateHist).
if (scens.includes("regimen") && !flag("--sin-cascada")) for (const esquema of [true, false]) {
  const iso0 = new Date((D.dayStart(D.addDays(DAY0, 1))) * 60000).toISOString();
  const schema = readFileSync(resolve(ROOT, "schema.sql"), "utf8").replace(/--.*$/gm, "");
  const { runs, extra } = await scenario("regimen", {
    hours: [iso0, new Date((D.dayStart(D.addDays(DAY0, 1)) + 60) * 60000).toISOString()], work: "despliegue",
    alPrincipio: async db => {
      await db.prepare("DROP TABLE IF EXISTS hist").run();
      if (esquema) for (const q of schema.split(";").map(x => x.trim()).filter(Boolean)) await db.prepare(q).run();
    },
    primera: iso => ({
      now: iso, seg: 2, base: "cron-antes", phase: "finalize",
      init: { ts: D.minuteOf(Date.parse(iso)), today: iso.slice(0, 10), firstOfDay: true, closedDay: D.addDays(DAY0, -1), selDay: DAY0, cursor: 0, session: "x" },
    }),
    alFinal: async (db, bucket) => {
      const exp = JSON.parse(bucket.store.get("roblox-tracker/data/export.json") || "{}");
      const hist = async () => (await db.prepare("SELECT * FROM hist ORDER BY universe_id").all()).results;
      const now = await hist();
      await db.batch(D.rebuildHistStmts(db));
      return { igual: JSON.stringify(now) === JSON.stringify(await hist()), filas: now.length, sinPico: (exp.games || []).filter(g => g.peak == null || g.days_tracked == null).length, juegos: (exp.games || []).length };
    },
  });
  out(`\n══ despliegue (${esquema ? "con el esquema aplicado" : "el código antes que el esquema"}): el cierre de las 00:00 lo hace una ejecución encadenada del código de antes (regimen) ══`);
  for (const r of runs) printRun(r);
  if (!extra.igual || extra.sinPico || !extra.juegos) { fail = true; out(`✗ despliegue: hist ${extra.igual ? "bien" : "distinta de la recalculada desde daily"} (${extra.filas} filas); export: ${extra.sinPico} de ${extra.juegos} juegos sin pico o días`); }
  else out(`✓ despliegue: hist igual que recalculada desde daily (${extra.filas} juegos) y export con pico y días en sus ${extra.juegos} juegos`);
}

// Una consulta que lee más en `anio` que en `regimen` crece con la base
if (results.regimen && results.anio && !flag("--sin-topes")) {
  const key = (r, x) => `${r.hh} ${x.tag} ${x.sql}`;
  const agg = runs => { const m = new Map(); for (const r of runs) for (const x of r.q) m.set(key(r, x), (m.get(key(r, x)) || 0) + x.read); return m; };
  const a = agg(results.regimen.runs.filter(r => r.hh !== "cal")), b = agg(results.anio.runs.filter(r => r.hh !== "cal"));
  let n = 0;
  for (const [k, vb] of b) {
    const va = a.get(k) ?? 0;
    if (vb > va * CRECE.factor && vb - va > CRECE.filas) { fail = true; n++; out(`✗ crece con la base: ${fmt(va)} → ${fmt(vb)}  ${k}`); }
  }
  if (!n) out("\n✓ ninguna consulta crece con la base (regimen → anio)");
}
out(fail ? "\n✗ FALLA" : "\n✓ dentro de los topes");
process.exit(fail ? 1 : 0);
