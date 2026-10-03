// Mide en Node la CPU de la parte de cómputo de cada paso del Workflow, con
// respuestas reales guardadas (test/fixtures o el directorio que se pase).
// Cada medida corre en un proceso nuevo (sin JIT caliente, como un isolate
// recién arrancado) con --single-threaded, y se repite N veces.
//   node test/cpu_steps.mjs <dir_fixtures> [N]
// Fixtures: games_pages.json, votes_pages.json (20 páginas de 50 juegos),
// explore_pages.json, search_pages.json, rolimons.json, export.json, ids.json
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const [dir, which] = [process.argv[2], process.argv[3]];

if (process.env.CPU_STEP) {
  const step = process.env.CPU_STEP;
  const src = new URL("../src/", import.meta.url);
  const { processGames } = await import(new URL("sampler.js", src));
  const { filterRolimons } = await import(new URL("sources.js", src));
  const tg = await import(new URL("telegram.js", src));
  const metrics = await import(new URL("metrics.js", src));
  const enc = new TextEncoder(), dec = new TextDecoder();
  const load = f => JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  // Las respuestas llegan como bytes: se mide decodificar + parsear
  const bytes = list => list.map(t => enc.encode(t));
  const parse = b => JSON.parse(dec.decode(b));
  let fn;
  if (step === "explore") {
    const pages = bytes(load("explore_pages.json"));
    fn = () => {
      const games = new Map(), hits = new Map();
      for (const b of pages) {
        const d = parse(b);
        for (const s of d.sorts || [{ sortId: d.sortId, games: d.games }]) {
          (s.games || []).forEach((g, i) => {
            if (g.playerCount >= 300 && !games.has(g.universeId)) games.set(g.universeId, [g.universeId, g.rootPlaceId, g.name]);
            hits.set(`${g.universeId}|${s.sortId}`, [g.universeId, s.sortId, i + 1]);
          });
        }
      }
      return JSON.stringify([...games.values()]).length + JSON.stringify([...hits.values()]).length;
    };
  } else if (step === "search") {
    const pages = bytes(load("search_pages.json"));
    fn = () => { let n = 0; for (const b of pages) { const d = parse(b); for (const g of d.searchResults) for (const c of g.contents || []) n += c.playerCount >= 300; } return n; };
  } else if (step === "rolimons") {
    const b = enc.encode(readFileSync(`${dir}/rolimons.json`, "utf8"));
    fn = () => { const list = filterRolimons(dec.decode(b), 300); return JSON.stringify(list.map(r => r[0])).length; };
  } else if (step === "sample" || step === "meta") {
    const meta = step === "meta";
    const n = meta ? 10 : 20;
    const gp = bytes(load("games_pages.json").slice(0, n)), vp = bytes(load("votes_pages.json").slice(0, n));
    const ids = load("ids.json").slice(0, n * 50);
    fn = () => {
      const games = { data: [], failed: 0 }, vts = { data: [], failed: 0 };
      for (const b of gp) games.data.push(...parse(b).data);
      if (meta) for (const b of vp) vts.data.push(...parse(b).data);
      const r = processGames(ids, games, meta ? vts : null, meta);
      return JSON.stringify(r.samples).length + JSON.stringify(r.low).length + JSON.stringify(r.metaRows).length + JSON.stringify(r.votes).length;
    };
  } else if (step === "export") {
    // El Worker recibe de D1 el JSON ya hecho (un string dentro de la respuesta)
    const raw = readFileSync(`${dir}/export.json`, "utf8");
    const wire = enc.encode(JSON.stringify({ results: [{ out: raw, n: 1 }], meta: {} }));
    fn = () => parse(wire).results[0].out.length;
  } else if (step === "telegram-parse") {
    const b = enc.encode(readFileSync(`${dir}/export.json`, "utf8"));
    fn = () => parse(b).games.length;
  } else if (step === "telegram-candidates") {
    const b = enc.encode(readFileSync(`${dir}/export.json`, "utf8"));
    fn = () => tg.telegramCandidates(parse(b), { now: process.env.NOW }).games.length;
  } else if (step === "telegram-dashboard") {
    const red = tg.telegramCandidates(JSON.parse(readFileSync(`${dir}/export.json`, "utf8")), { now: process.env.NOW });
    const b = enc.encode(JSON.stringify(red));
    fn = () => Object.keys(metrics.buildDashboard(parse(b), { now: process.env.NOW }).games).length;
  }
  const t = process.cpuUsage();
  const out = fn();
  const d = process.cpuUsage(t);
  console.log(JSON.stringify({ step, ms: (d.user + d.system) / 1000, out }));
  process.exit(0);
}

const N = Number(which || 5);
const steps = ["explore", "search", "rolimons", "sample", "meta", "export", "telegram-parse", "telegram-candidates", "telegram-dashboard"];
const now = JSON.parse(readFileSync(`${dir}/export.json`, "utf8")).generated_at;
for (const s of steps) {
  const ms = [];
  let out;
  for (let i = 0; i < N; i++) {
    const r = JSON.parse(execFileSync(process.execPath, ["--single-threaded", "--no-warnings", "--import", new URL("./cf_loader.mjs", import.meta.url).pathname, SELF, dir], {
      env: { ...process.env, CPU_STEP: s, NOW: now },
    }).toString());
    ms.push(r.ms); out = r.out;
  }
  ms.sort((a, b) => a - b);
  console.log(`${s.padEnd(20)} mediana ${ms[N >> 1].toFixed(2)} ms  (min ${ms[0].toFixed(2)} · max ${ms[N - 1].toFixed(2)})  [${out}]`);
}
