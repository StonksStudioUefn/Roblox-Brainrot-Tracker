import fs from 'node:fs';
import { load, dow, DOWN, iso, pc } from './load.mjs';
const res = JSON.parse(fs.readFileSync('res-hyst.json')); const G = load();
const by = new Map(); for (const r of res) by.set(r.id + ':' + r.d, r);
const isUp = s => s === 'hot' || s === 'up', isDown = s => s === 'down' || s === 'down2';
// juegos con más ciclos "sube el fin de semana y baja el lunes" en el estado actual, con WoW plano
const cnt = new Map();
for (const r of res) if (dow(r.d) === 0) {
  const sun = by.get(r.id + ':' + (r.d - 1)), fri = by.get(r.id + ':' + (r.d - 3));
  if (sun && fri && isUp(sun.cur) && !isUp(fri.cur) && isDown(r.cur) && r.prop === sun.prop) cnt.set(r.id, (cnt.get(r.id) || 0) + 1);
}
const L = [];
const top = [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 6);
L.push('Ciclos "sube sáb/dom → baja lun" (estado actual) con la propuesta sin cambiar: total ' + [...cnt.values()].reduce((a, b) => a + b, 0) + ' en ' + cnt.size + ' juegos');
for (const [id, c] of top) L.push(`  ${G.get(id).name.replace(/\s+/g, ' ').slice(0, 40)}: ${c} veces`);
for (const [id] of top.slice(0, 3)) {
  const g = G.get(id);
  L.push(`\n### ${g.name.replace(/\s+/g, ' ')} (${id})`);
  L.push('fecha | jugadores | actual (24h / 7d / tend) | propuesta (WoW / mismo día sem. pasada)');
  const rs = res.filter(r => r.id === id && iso(r.d) >= '2026-09-17' && iso(r.d) <= '2026-09-24');
  for (const r of rs) L.push(`${DOWN[dow(r.d)]} ${iso(r.d).slice(5)} | ${G.get(id).rows.get(r.d).med} | ${r.cur} (${r.g24}% / ${r.g7}% / ${r.trend}%) | ${r.prop} (${pc(r.wow)} / ${pc(r.same)})`);
}
console.log(L.join('\n')); fs.writeFileSync('ejemplos.txt', L.join('\n'));
