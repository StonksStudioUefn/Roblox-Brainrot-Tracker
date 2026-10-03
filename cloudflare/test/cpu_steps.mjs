// Mide en Node la CPU de la parte de cómputo de cada paso del Workflow, con
// respuestas reales guardadas. Cada medida corre en un proceso nuevo (sin JIT
// caliente, como un isolate recién arrancado) con --single-threaded, N veces.
//   node test/cpu_steps.mjs <dir_fixtures> [N]
// Fixtures (ver README): games_pages.json, votes_pages.json (20 páginas de 50),
// explore_pages.json, search_pages.json, rolimons.json, part-<i>.json (partes
// del export en R2), telegram.json, ids.json.
// La red, D1 y R2 no cuentan como CPU en Workers; aquí se simula lo que sí
// cuenta: decodificar y parsear las respuestas, el cálculo y serializar.
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const LOADER = new URL("./cf_loader.mjs", import.meta.url).pathname;
const dir = process.argv[2];

if (process.env.CPU_STEP) {
  const step = process.env.CPU_STEP;
  const src = new URL("../src/", import.meta.url);
  const { processGames, SAMPLE_CHUNK, META_CHUNK } = await import(new URL("sampler.js", src));
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
  // Parte "en régimen": cada juego con 24 filas diarias y 16 muestras
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
  } else if (step === "export-join") {
    fn = () => enc.encode(JSON.stringify({ generated_at: now, last_sample: now, samples_24h: 8 })).length;
  } else if (step === "tg-scan" || step === "tg-scan-steady") {
    const frag = step === "tg-scan" ? biggest : steady();
    const b = enc.encode(frag);
    const n = JSON.parse(`[${frag}]`).length, k = Math.ceil(n / 100);
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
  } else if (step.startsWith("telegram")) {
    const b = enc.encode(read("telegram.json"));
    const force = step === "telegram-daily" ? "daily" : step === "telegram-weekly" ? "weekly" : undefined;
    fn = async () => {
      const r = await tg.runTelegram({
        env: {}, exportData: parse(b), now, force, log: () => {},
        getState: async () => ({ alerted: {}, last_daily: now.slice(0, 10), last_weekly: tg.isoWeek(new Date(now)) }),
        setState: async () => {},
        fetch: async () => new Response("{}"),
      });
      return r.messages;
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
  "export-slice-steady", "export-join", "tg-scan", "tg-scan-steady", "tg-reduce", "telegram", "telegram-daily", "telegram-weekly"];
for (const s of steps) {
  const ms = [];
  let out;
  for (let i = 0; i < N; i++) {
    const r = JSON.parse(execFileSync(process.execPath, ["--single-threaded", "--no-warnings", "--import", LOADER, SELF, dir], {
      env: { ...process.env, CPU_STEP: s },
    }).toString());
    ms.push(r.ms); out = r.out;
  }
  ms.sort((a, b) => a - b);
  console.log(`${s.padEnd(20)} mediana ${ms[N >> 1].toFixed(2)} ms  (min ${ms[0].toFixed(2)} · max ${ms[N - 1].toFixed(2)})  [${out}]`);
}
