// Índice con media móvil centrada de 7 días (quita la tendencia del juego), por mes y tamaño
import { load, dow, DOWN, iso, median, q, mean } from './load.mjs';
import { flagEvents } from './src/metrics.js';
import fs from 'node:fs';
const games = load();
const by = {}; const add = (k, d, r) => { by[k] ??= Array.from({ length: 7 }, () => []); by[k][d].push(r); };
for (const g of games.values()) {
  const vals = g.days.map(d => g.rows.get(d).med);
  const fl = flagEvents(vals, g.days.map(iso)); const ev = new Set(g.days.filter((d, i) => fl[i]));
  for (const d of g.days) {
    const w = []; for (let k = -3; k <= 3; k++) { const r = g.rows.get(d + k); if (!r || ev.has(d + k)) break; w.push(r.med); }
    if (w.length < 7) continue;
    const r = g.rows.get(d).med / mean(w), m = iso(d).slice(0, 7);
    const sz = mean(w) < 1000 ? '<1k' : mean(w) < 10000 ? '1k-10k' : mean(w) < 100000 ? '10k-100k' : '≥100k';
    add('todo', dow(d), r); add(m, dow(d), r); add(sz, dow(d), r);
  }
}
const lines = ['## v / media móvil centrada de 7 días (por juego, sin eventos): mediana por día [p10–p90 en "todo"]'];
for (const [k, a] of Object.entries(by).sort()) lines.push(`${k.padEnd(9)} (n=${a[0].length}): ` + a.map((x, i) => `${DOWN[i]} ${median(x).toFixed(3)}`).join(' · '));
lines.push('p10/p90 todo: ' + by.todo.map((x, i) => `${DOWN[i]} ${q(x, .1).toFixed(2)}–${q(x, .9).toFixed(2)}`).join(' · '));
const I = by.todo.map(median), s = mean(I);
lines.push('Índice global normalizado (media 1): ' + I.map((x, i) => `${DOWN[i]} ${(x / s).toFixed(3)}`).join(' · '));
const sep = ['2026-09'].map(k => by[k].map(median)).flat(); const ss = mean(sep);
lines.push('Índice septiembre normalizado: ' + sep.map((x, i) => `${DOWN[i]} ${(x / ss).toFixed(3)}`).join(' · '));
fs.writeFileSync('idx.json', JSON.stringify({ global: I.map(x => x / s), sep: sep.map(x => x / ss), bySize: Object.fromEntries(['<1k', '1k-10k', '10k-100k', '≥100k'].map(k => { const m = by[k].map(median), mm = mean(m); return [k, m.map(x => x / mm)]; })) }));
console.log(lines.join('\n')); fs.writeFileSync('dow2.txt', lines.join('\n'));
