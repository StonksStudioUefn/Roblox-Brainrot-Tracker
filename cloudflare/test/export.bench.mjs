//   node --import ./test/cf_loader.mjs test/export.bench.mjs <src> <salida> [--persist=test/.state] [--now=ISO] [--config=wrangler.toml]
// En Windows, d1 execute --file con un volcado grande falla y --persist necesita una ruta corta.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getPlatformProxy } from "wrangler";
import { contador, memBucket } from "./comun.mjs";

const arg = (name, dflt) => (process.argv.find(a => a.startsWith(`--${name}=`)) || `=${dflt ?? ""}`).split("=").slice(1).join("=");
const [srcdir, outdir] = process.argv.slice(2).filter(a => !a.startsWith("--"));
if (!srcdir || !outdir) throw new Error("Uso: export.bench.mjs <src> <salida> [--persist=…] [--now=ISO]");

const proxy = await getPlatformProxy({ configPath: arg("config", "wrangler.toml"), persist: { path: resolve(arg("persist", "test/.state")) } });
const raw = proxy.env.DB;
const log = [];
const DB = contador(raw, log);
const BUCKET = memBucket();

const { runExport } = await import(pathToFileURL(resolve(srcdir, "sampler.js")).href);
const { migrateHist } = await import(pathToFileURL(resolve(srcdir, "db.js")).href);
await migrateHist(DB);
const steps = [];
const step = { do: async (name, a, b) => { const i = log.length; const r = await (b || a)(); steps.push([name, log.slice(i).reduce((s, x) => s + x.read, 0)]); return r; } };
const summary = { steps: {}, errors: [] };
const safe = async (name, fn) => { try { return await step.do(name, fn); } catch (e) { summary.errors.push(`${name}: ${e.message}`); return null; } };
const last = Number(JSON.parse((await raw.prepare("SELECT value FROM state WHERE key = 'last_sample_ts'").first())?.value ?? "null"));
const nowMs = arg("now") ? Date.parse(arg("now")) : (last + 20) * 60000;

await runExport({ DB, BUCKET }, step, nowMs, safe, summary);
mkdirSync(outdir, { recursive: true });
writeFileSync(resolve(outdir, "export.json"), BUCKET.store.get("data/export.json") || "");
writeFileSync(resolve(outdir, "telegram.json"), BUCKET.store.get("data/telegram.json") || "");
console.log(JSON.stringify({
  now: new Date(nowMs).toISOString(), errors: summary.errors,
  rows_read: log.reduce((s, x) => s + x.read, 0), rows_written: log.reduce((s, x) => s + x.written, 0),
  steps: steps.filter(([, n]) => n), queries: log,
}, null, 1));
await proxy.dispose();
