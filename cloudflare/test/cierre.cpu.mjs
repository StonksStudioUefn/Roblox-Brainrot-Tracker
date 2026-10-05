/**
 * cierre.cpu.mjs — CPU del paso `close` (lo que en Workers cuenta: parsear los
 * ficheros de R2, calcular y serializar; D1 y R2 no cuentan), en procesos Node
 * NUEVOS (JIT frío, como un isolate recién arrancado), con el tamaño de
 * producción: 2.800 juegos en el radar, 8 lecturas al día, votos de 242
 * seguidos en 56 ficheros y el meta de ~2.550 no seguidos.
 *
 *   node --import ./test/cf_loader.mjs test/cierre.cpu.mjs [--runs=7]
 *
 * «antes»: el paso close de antes: JSON.parse de todo, juntar las lecturas por
 *   juego y mandar a D1 el JSON de las lecturas y del meta enteros (la mediana la hacía SQL).
 * «close»: el paso close de ahora: votos y meta de los 56 ficheros (el meta ya
 *   viene repartido en RADAR_CLOSE_PARTS), un fichero por parte y los votos a D1.
 * «close-radar»: un paso close-radar-<día>-<k> en frío (el primero de la
 *   ejecución, o tras reanudarla): decodificar los 8 ficheros de R2, comprobar
 *   su forma (radarPrepare), sacar su parte (radarReadingsPart), su parte del
 *   meta y radarDailyRows.
 * «close-radar-sig»: las partes siguientes en la misma ejecución, con los
 *   ficheros ya leídos y comprobados (sampler.js los guarda por día).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const LOADER = new URL("./cf_loader.mjs", import.meta.url).pathname;
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };

if (process.argv[2] === "--child") {
  const mode = process.argv[3];
  const { idPart, radarDailyRows, radarPrepare, radarReadingsPart } = await import("../src/db.js");
  const { RADAR_CLOSE_PARTS } = await import("../src/sampler.js");
  let seed = 7;
  const R = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const ids = Array.from({ length: 2800 }, () => 1_000_000 + Math.floor(R() * 1e10));
  // Lo que llega de R2 (texto): 8 ficheros del radar y 56 de votos
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
    // Antes el meta iba entero; ahora, ya repartido en partes (lo hace cada paso sample-i)
    return { antes: JSON.stringify({ v, r }), ahora: JSON.stringify({ v, r: split(r) }) };
  });
  const metaParts = Array.from({ length: RADAR_CLOSE_PARTS }, () => ({}));
  for (const t of voteFiles) JSON.parse(t.ahora).r.forEach((m, k) => Object.assign(metaParts[k], m));
  const metaText = JSON.stringify(metaParts[0]);
  const c0 = cpu();
  let bytes = 0;
  if (mode === "antes") {
    const votes = {}, radarMeta = {};
    for (const t of voteFiles) { const part = JSON.parse(t.antes); Object.assign(votes, part.v); Object.assign(radarMeta, part.r); }
    const readings = {};
    for (const t of radarFiles) { const players = JSON.parse(t); for (const id in players) (readings[id] ||= []).push(players[id]); }
    bytes = JSON.stringify(readings).length + JSON.stringify(radarMeta).length + JSON.stringify(votes).length;
  } else if (mode === "close") {
    const votes = {}, parts = Array.from({ length: RADAR_CLOSE_PARTS }, () => ({}));
    for (const t of voteFiles) { const part = JSON.parse(t.ahora); Object.assign(votes, part.v); part.r.forEach((m, k) => Object.assign(parts[k], m)); }
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
for (const mode of ["antes", "close", "close-radar", "close-radar-sig"]) {
  const ms = [];
  let bytes = 0;
  for (let i = 0; i < runs; i++) {
    const r = spawnSync(process.execPath, ["--single-threaded", "--no-warnings", "--import", LOADER, SELF, "--child", mode], { encoding: "utf8" });
    const j = JSON.parse(r.stdout.trim().split("\n").pop());
    ms.push(j.ms); bytes = j.bytes;
  }
  ms.sort((a, b) => a - b);
  console.log(`${mode.padEnd(15)} mediana ${ms[runs >> 1].toFixed(2)} ms  (min ${ms[0].toFixed(2)} · max ${ms[runs - 1].toFixed(2)})  · ${Math.round(bytes / 1024)} KB a D1`);
}
