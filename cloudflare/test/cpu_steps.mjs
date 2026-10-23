//   node test/cpu_steps.mjs <dir_fixtures> [N]
// Procesos Node nuevos (JIT frío, como un isolate recién arrancado); D1 y R2 no cuentan como CPU.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { enFrio, fmtMs } from "./comun.mjs";

const dir = process.argv[2];

if (process.env.CPU_STEP) {
  const step = process.env.CPU_STEP;
  const src = new URL("../src/", import.meta.url);
  const { processGames, SAMPLE_CHUNK, META_CHUNK, TG_SCAN_GAMES } = await import(new URL("sampler.js", src));
  const { filterRolimons } = await import(new URL("sources.js", src));
  const tg = await import(new URL("telegram.js", src));
  const enc = new TextEncoder(), dec = new TextDecoder();
  const read = f => readFileSync(`${dir}/${f}`, "utf8");
  const load = f => JSON.parse(read(f));
  const bytes = list => list.map(t => enc.encode(t));
  const parse = b => JSON.parse(dec.decode(b));
  // D1 devuelve { results: [ { col: valor } ], meta }: el Worker lo decodifica entero
  const wire = obj => enc.encode(JSON.stringify({ results: [obj], success: true, meta: { rows_read: 1 } }));
  const parts = readdirSync(dir).filter(f => /^part-\d+\.json$/.test(f)).sort();
  const biggest = parts.map(f => read(f)).sort((a, b) => b.length - a.length)[0];
  const steady = () => {
    const games = JSON.parse(`[${biggest}]`);
    for (const g of games) {
      while (g.d.length < 24) { const r = [...g.d[0]]; r[0] = new Date(Date.parse(r[0]) - 864e5).toISOString().slice(0, 10); r[5] = null; g.d.unshift(r); }
      while (g.s.length < 16) { const r = [...g.s[0]]; r[0] -= 180; r[2] = null; g.s.unshift(r); }
    }
    return JSON.stringify(games).slice(1, -1);
  };
  const now = load("telegram.json").generated_at;
  const sortsOf = d => d.sorts || [{ sortId: d.sortId, games: d.games }];
  const explore = pages => () => {
    const games = new Map(), hits = new Map();
    for (const b of pages) for (const s of sortsOf(parse(b))) (s.games || []).forEach((g, i) => {
      if (g.playerCount >= 300 && !games.has(g.universeId)) games.set(g.universeId, [g.universeId, g.rootPlaceId, g.name]);
      hits.set(`${g.universeId}|${s.sortId}`, [g.universeId, s.sortId, i + 1]);
    });
    return JSON.stringify([...games.values()]).length + JSON.stringify([...hits.values()]).length;
  };
  let fn;
  const ex = load("explore_pages.json");
  if (step === "explore-page") {
    const big = ex.filter(t => t.includes('"nextSortsPageToken"') || t.includes('"sorts"')).sort((a, b) => b.length - a.length)[0];
    fn = explore(bytes([big]));
  } else if (step === "explore-more") {
    fn = explore(bytes(ex.filter(t => !t.includes('"sorts"'))));
  } else if (step === "search") {
    const pages = bytes(load("search_pages.json"));
    fn = () => { let n = 0; for (const b of pages) { const d = parse(b); for (const g of d.searchResults) for (const c of g.contents || []) n += c.playerCount >= 300; } return n; };
  } else if (step === "rolimons") {
    const b = enc.encode(read("rolimons.json"));
    fn = () => JSON.stringify(filterRolimons(dec.decode(b), 300).map(r => r[0])).length;
  } else if (step === "sample" || step === "meta") {
    const meta = step === "meta";
    const n = (meta ? META_CHUNK : SAMPLE_CHUNK) / 50;
    const gp = bytes(load("games_pages.json").slice(0, n)), vp = bytes(load("votes_pages.json").slice(0, n));
    const ids = load("ids.json").slice(0, n * 50);
    fn = () => {
      const games = { data: [], failed: 0 }, vts = { data: [], failed: 0 };
      for (const b of gp) games.data.push(...parse(b).data);
      if (meta) for (const b of vp) vts.data.push(...parse(b).data);
      const r = processGames(ids, games, meta ? vts : null, meta);
      return JSON.stringify(r.samples).length + JSON.stringify(r.low).length + JSON.stringify(r.metaRows).length + JSON.stringify(r.votes).length;
    };
  } else if (step === "export-slice" || step === "export-slice-steady") {
    const frag = step === "export-slice" ? biggest : steady();
    const w = wire({ frag, n: 1, last_ts: 1, ts24: "[1,2,3]" });
    fn = () => { const r = parse(w).results[0]; enc.encode(r.frag); return r.frag.length; };   // + put a R2 (UTF-8)
  } else if (step === "tg-scan" || step === "tg-scan-steady") {
    const frag = step === "tg-scan" ? biggest : steady();
    const b = enc.encode(frag);
    const n = JSON.parse(`[${frag}]`).length, k = Math.max(1, Math.ceil(n / TG_SCAN_GAMES));
    fn = () => tg.telegramScanText(`{"games":[${dec.decode(b)}]}`, { now, part: 0, parts: k }).length;
  } else if (step === "tg-reduce") {
    const rows = parts.flatMap(f => tg.telegramScanText(`{"games":[${read(f)}]}`, { now }));
    const rowsWire = enc.encode(JSON.stringify(rows));          // salidas de los pasos anteriores
    const red = load("telegram.json");
    const w = wire({ frag: JSON.stringify(red.games).slice(1, -1), n: red.games.length, last_ts: 1, ts24: "[]" });
    fn = () => {
      const { counts, ids } = tg.pickCandidates(JSON.parse(dec.decode(rowsWire)));
      const r = parse(w).results[0];
      const text = `${JSON.stringify({ a: 1, totals: counts, telegram: { counts, total: 1, candidates: ids.size } }).slice(0, -1)},"games":[${r.frag}]}`;
      return enc.encode(text).length;
    };
  }
  const t = process.cpuUsage();
  const out = await fn();
  const d = process.cpuUsage(t);
  console.log(JSON.stringify({ step, ms: (d.user + d.system) / 1000, out }));
  process.exit(0);
}

const N = Number(process.argv[3] || 5);
const steps = ["explore-page", "explore-more", "search", "rolimons", "sample", "meta", "export-slice",
  "export-slice-steady", "tg-scan", "tg-scan-steady", "tg-reduce"];
for (const s of steps) {
  const { ms, last } = enFrio(fileURLToPath(import.meta.url), [dir], { runs: N, env: { ...process.env, CPU_STEP: s } });
  console.log(`${s.padEnd(20)} ${fmtMs(ms)}  [${last.out}]`);
}
