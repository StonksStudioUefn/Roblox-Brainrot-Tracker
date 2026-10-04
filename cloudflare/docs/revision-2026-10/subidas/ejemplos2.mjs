import fs from 'node:fs';
import { load, dow, DOWN, iso, pc } from './load.mjs';
const res = JSON.parse(fs.readFileSync('res-hyst.json')); const G = load();
const by = new Map(); for (const r of res) by.set(r.id + ':' + r.d, r);
const isUp = s => s === 'hot' || s === 'up', isDown = s => s === 'down' || s === 'down2';
const L = []; const seen = new Set();
const cands = [];
for (const r of res) if (dow(r.d) === 0 && iso(r.d) >= '2026-09-01') {
  const sat = by.get(r.id + ':' + (r.d - 2)), sun = by.get(r.id + ':' + (r.d - 1)), fri = by.get(r.id + ':' + (r.d - 3));
  if (sat && sun && fri && (isUp(sat.cur) || isUp(sun.cur)) && !isUp(fri.cur) && isDown(r.cur) && !isUp(sun.prop) && !isDown(r.prop) || false) cands.push(r);
}
cands.sort((a, b) => b.typ - a.typ);
for (const r of cands) {
  if (seen.has(r.id) || seen.size >= 4) continue; seen.add(r.id);
  L.push(`\n### ${G.get(r.id).name.replace(/\s+/g, ' ')} — fin de semana del ${iso(r.d - 2)}`);
  L.push('día | jugadores | ACTUAL estado (24h · 7d · tend/día) | PROPUESTA estado (WoW · vs mismo día sem. pasada)');
  for (let d = r.d - 3; d <= r.d + 1; d++) { const x = by.get(r.id + ':' + d); if (x) L.push(`${DOWN[dow(d)]} ${iso(d).slice(5)} | ${G.get(r.id).rows.get(d).med} | ${x.cur} (${x.g24}% · ${x.g7}% · ${x.trend}%) | ${x.prop} (${pc(x.wow)} · ${pc(x.same)})`); }
}
L.unshift(`Fines de semana de septiembre con el patrón (actual: sube sáb/dom y baja el lunes; propuesta: ni sube el domingo ni baja el lunes): ${cands.length}`);
console.log(L.join('\n')); fs.writeFileSync('ejemplos2.txt', L.join('\n'));
