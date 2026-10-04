import fs from 'node:fs';
import { nextWeek, addDays, nameOf } from './lib.mjs';
const B = JSON.parse(fs.readFileSync('baseline.json'));
let big = 0, capped = 0; const ex = new Map();
for (let D = '2026-08-15'; D <= '2026-09-24'; D = addDays(D, 1)) for (const [id, i] of Object.entries(B[D].info)) {
  const y = nextWeek(id, D); if (y == null || y < 0.3 || i[7] < 300) continue; if (i[8] == null || i[8] > 90) continue;
  big++; if (i[9] > 30e6) { capped++; if (!ex.has(id)) ex.set(id, `${nameOf(id)} (${i[8]} días, ${(i[9] / 1e6).toFixed(0)}M visitas, +${Math.round(y * 100)}%)`); }
}
console.log('crecen ≥30% la semana siguiente y tienen ≤90 días:', big, '; fuera por >30M visitas:', capped); console.log([...ex.values()].slice(0, 8).join('\n'));
