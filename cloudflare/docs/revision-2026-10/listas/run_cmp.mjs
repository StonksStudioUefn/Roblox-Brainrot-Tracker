import fs from 'node:fs';
import { evaluate, weekendChurn, entriesByDow } from './evalx.mjs';
import { lists2, market } from './variant.mjs';
import { addDays, dow, DOW } from './lib.mjs';
const B = JSON.parse(fs.readFileSync('baseline.json'));
const V = {}; for (const D of Object.keys(B)) if (D >= '2026-08-15') { const l = lists2(D); V[D] = { em: l.em, tr: l.tr, al: l.al }; }
fs.writeFileSync('variant.json', JSON.stringify(V));
const mk = Array(7).fill(0).map(() => []); for (const D of Object.keys(V)) mk[dow(D)].push(market(D));
console.log('mercado d/d medio:', mk.map((a, i) => DOW[i] + ' ' + (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1)).join(' '));
for (const k of ['em', 'tr', 'al']) for (const [lab, L] of [['antes', B], ['después', V]]) {
  const o = { emOnly: k !== 'tr', from: '2026-08-22' };
  const r = evaluate(L, k, o); delete r.flagged;
  const we = evaluate(L, k, { ...o, weekdays: [6, 0] }); delete we.flagged;
  const c = weekendChurn(L, k, { from: '2026-08-22' }); delete c.ex;
  console.log(k, lab.padEnd(8), `por día ${r.perDay} | sigue>0 ${r.prec0}% | >+10% ${r.prec10}% | media sem.sig ${r.meanNext}% | recall(≥+30%) ${r.recall}% de ${r.bigGrowers}`
    + ` | finde: ${we.perDay}/día, sigue>0 ${we.prec0}% | entran finde ${c.enteredPerWeekend}, salen lunes ${c.pctOut}% | entradas/día ${entriesByDow(L, k, { from: '2026-08-22' })}`);
}
