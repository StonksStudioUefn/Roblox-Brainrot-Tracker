//   node --import ./test/cf_loader.mjs test/cierre.cpu.mjs [--runs=7]
// Procesos Node nuevos (JIT frío, como un isolate recién arrancado); D1 y R2 no cuentan como CPU.
import { fileURLToPath } from "node:url";
import { cpuMs as cpu, enFrio, fmtMs, rng } from "./comun.mjs";

if (process.argv[2] === "--child") {
  const mode = process.argv[3];
  const { idPart, radarDailyRows, radarPrepare, radarReadingsPart } = await import("../src/db.js");
  const { RADAR_CLOSE_PARTS } = await import("../src/sampler.js");
  const R = rng(7);
  const ids = Array.from({ length: 2800 }, () => 1_000_000 + Math.floor(R() * 1e10));
  const radarFiles = Array.from({ length: 8 }, () => JSON.stringify(Object.fromEntries(ids.map(id => [id, 150 + Math.floor(R() * 20000)]))));
  const radarBytes = radarFiles.map(t => new TextEncoder().encode(t));   // como llegan de R2
  const prepared = mode === "close-radar-sig" ? radarPrepare(radarFiles) : null;
  const sel = ids.slice(0, 242);
  const split = r => {
    const out = Array.from({ length: RADAR_CLOSE_PARTS }, () => ({}));
    for (const id in r) out[idPart(id, RADAR_CLOSE_PARTS)][id] = r[id];
    return out;
  };
  const voteFiles = Array.from({ length: 56 }, (_, i) => {
    const v = Object.fromEntries(sel.slice(i * 5, i * 5 + 5).map(id => [id, [1e5, 5e4, 1e3]]));
    const r = Object.fromEntries(ids.slice(242 + i * 46, 242 + (i + 1) * 46).map(id => [id, [400, 1e7]]));
    return JSON.stringify({ v, r: split(r) });
  });
  const metaParts = Array.from({ length: RADAR_CLOSE_PARTS }, () => ({}));
  for (const t of voteFiles) JSON.parse(t).r.forEach((m, k) => Object.assign(metaParts[k], m));
  const metaText = JSON.stringify(metaParts[0]);
  const c0 = cpu();
  let bytes = 0;
  if (mode === "close") {
    const votes = {}, parts = Array.from({ length: RADAR_CLOSE_PARTS }, () => ({}));
    for (const t of voteFiles) { const part = JSON.parse(t); Object.assign(votes, part.v); part.r.forEach((m, k) => Object.assign(parts[k], m)); }
    bytes = parts.reduce((a, m) => a + JSON.stringify(m).length, 0) + JSON.stringify(votes).length;
  } else {
    const files = prepared || radarPrepare(radarBytes.map(b => new TextDecoder().decode(b)));
    const rows = radarDailyRows(radarReadingsPart(files, 0, RADAR_CLOSE_PARTS), JSON.parse(metaText), 0, RADAR_CLOSE_PARTS);
    bytes = JSON.stringify(rows).length;
  }
  console.log(JSON.stringify({ ms: cpu() - c0, bytes }));
  process.exit(0);
}

const runs = Number((process.argv.find(a => a.startsWith("--runs=")) || "=7").split("=")[1]);
console.log(`RADAR_CLOSE_PARTS = ${(await import("../src/sampler.js")).RADAR_CLOSE_PARTS}`);
for (const mode of ["close", "close-radar", "close-radar-sig"]) {
  const { ms, last } = enFrio(fileURLToPath(import.meta.url), ["--child", mode], { runs });
  console.log(`${mode.padEnd(15)} ${fmtMs(ms)}  · ${Math.round(last.bytes / 1024)} KB a D1`);
}
