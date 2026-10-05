/**
 * export.bench.mjs — Filas leídas del export (runExport de sampler.js) contra un
 * D1 local con datos reales, y su salida (data/export.json y data/telegram.json).
 *
 *   node --import ./test/cf_loader.mjs test/export.bench.mjs <src> <salida> [--persist=test/.state] [--now=ISO] [--config=wrangler.toml]
 *
 * <src> es la carpeta con sampler.js/db.js (la de ahora o una copia de otra
 * versión, p. ej. `git show main:cloudflare/src/db.js`), así se comparan dos
 * versiones sobre los mismos datos: mismas filas → `cmp` de las dos salidas.
 * Para cargar el D1 local: `wrangler d1 export roblox-tracker --remote --output=x.sql`
 * y ejecutar sus INSERT con este mismo proxy (en Windows, `wrangler d1 execute
 * --file` con un volcado grande falla, y la ruta de --persist tiene que ser corta).
 * Por defecto `now` = 20 min después de state.last_sample_ts. Con una versión
 * que tiene la tabla `hist`, antes del export se pasa state.hist_agg a la tabla
 * (como hace el init de cada pasada): así se compara con la base de antes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getPlatformProxy } from "wrangler";

const arg = (name, dflt) => (process.argv.find(a => a.startsWith(`--${name}=`)) || `=${dflt ?? ""}`).split("=").slice(1).join("=");
const [srcdir, outdir] = process.argv.slice(2).filter(a => !a.startsWith("--"));
if (!srcdir || !outdir) throw new Error("Uso: export.bench.mjs <src> <salida> [--persist=…] [--now=ISO]");

// --config: otro wrangler.toml (p. ej. test/filas.wrangler.toml para la base de test/filas.bench.mjs)
const proxy = await getPlatformProxy({ configPath: arg("config", "wrangler.toml"), persist: { path: resolve(arg("persist", "test/.state")) } });
const raw = proxy.env.DB;
const log = [];
const add = (sql, meta) => log.push({ sql: sql.replace(/\s+/g, " ").trim().slice(0, 60), read: meta?.rows_read ?? 0, written: meta?.rows_written ?? 0 });
// first() de D1 no devuelve meta: se hace con all() para contar sus filas
class Stmt {
  constructor(s, sql) { this.s = s; this.sql = sql; }
  bind(...a) { return new Stmt(this.s.bind(...a), this.sql); }
  async all() { const r = await this.s.all(); add(this.sql, r.meta); return r; }
  async run() { const r = await this.s.run(); add(this.sql, r.meta); return r; }
  async first(col) { const row = (await this.all()).results[0]; return row ? (col ? row[col] : row) : null; }
}
const DB = {
  prepare: sql => new Stmt(raw.prepare(sql), sql),
  async batch(list) { const r = await raw.batch(list.map(x => x.s)); r.forEach((x, i) => add(list[i].sql, x.meta)); return r; },
};
const store = new Map();
const text = async v => typeof v === "string" ? v : v instanceof ReadableStream ? new Response(v).text() : new TextDecoder().decode(v);
const BUCKET = {
  async put(k, v) { const t = await text(v); store.set(k, t); return { size: Buffer.byteLength(t) }; },
  async get(k) {
    if (!store.has(k)) return null;
    const t = store.get(k);
    return { key: k, size: Buffer.byteLength(t), text: async () => t, json: async () => JSON.parse(t), body: new Response(t).body };
  },
  async list({ prefix = "" } = {}) { return { objects: [...store.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
  async delete(keys) { for (const k of [].concat(keys)) store.delete(k); },
};
globalThis.FixedLengthStream ??= class { constructor() { const t = new TransformStream(); this.readable = t.readable; this.writable = t.writable; } };

const { runExport } = await import(pathToFileURL(resolve(srcdir, "sampler.js")).href);
// Como el init de cada pasada: state.hist_agg → tabla hist (en versiones que la tienen)
const dbmod = await import(pathToFileURL(resolve(srcdir, "db.js")).href);
if (dbmod.migrateHist) await dbmod.migrateHist(DB);
const steps = [];
const step = { do: async (name, a, b) => { const i = log.length; const r = await (b || a)(); steps.push([name, log.slice(i).reduce((s, x) => s + x.read, 0)]); return r; } };
const summary = { steps: {}, errors: [] };
const safe = async (name, fn) => { try { return await step.do(name, fn); } catch (e) { summary.errors.push(`${name}: ${e.message}`); return null; } };
const last = Number(JSON.parse((await raw.prepare("SELECT value FROM state WHERE key = 'last_sample_ts'").first())?.value ?? "null"));
const nowMs = arg("now") ? Date.parse(arg("now")) : (last + 20) * 60000;

await runExport({ DB, BUCKET }, step, nowMs, safe, summary);
mkdirSync(outdir, { recursive: true });
writeFileSync(resolve(outdir, "export.json"), store.get("data/export.json") || "");
writeFileSync(resolve(outdir, "telegram.json"), store.get("data/telegram.json") || "");
console.log(JSON.stringify({
  now: new Date(nowMs).toISOString(), errors: summary.errors,
  rows_read: log.reduce((s, x) => s + x.read, 0), rows_written: log.reduce((s, x) => s + x.written, 0),
  steps: steps.filter(([, n]) => n), queries: log,
}, null, 1));
await proxy.dispose();
