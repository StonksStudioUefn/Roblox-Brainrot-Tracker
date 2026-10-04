import fs from 'node:fs';
import { weekendChurn } from './evalx.mjs';
import { nameOf, addDays, nextWeek } from './lib.mjs';
const B = JSON.parse(fs.readFileSync('baseline.json'));
for (const k of ['em', 'tr']) {
  const c = weekendChurn(B, k, { from: '2026-08-22' });
  let byG24 = 0;
  const lines = c.ex.map(([S, id]) => { const i = B[S].info[id] || B[addDays(S, 1)].info[id]; const D = B[S][k].includes(id) ? S : addDays(S, 1); const j = B[D].info[id];
    const drv = Math.max(j[2] || 0, (j[3] || 0) / 2, (j[4] || 0) / 5) === (j[3] || 0) / 2 && (j[3] || 0) > 0; if (drv) byG24++;
    return `${D} ${nameOf(id)} ${k === 'em' ? 'em ' + j[0] : 'mom ' + j[1]} t=${j[2]} g24=${j[3]} g7=${j[4]} sem.sig=${nextWeek(id, D) == null ? '-' : (nextWeek(id, D) * 100).toFixed(0) + '%'}`; });
  console.log(k, 'salen el lunes', c.ex.length, 'de', (c.enteredPerWeekend * c.weekends).toFixed(0), '; impulsados por g24/2 (emergentes):', byG24);
  console.log(lines.slice(0, 40).join('\n'));
}
