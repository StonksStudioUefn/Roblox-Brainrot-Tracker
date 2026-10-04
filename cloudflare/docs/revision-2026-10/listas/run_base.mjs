import fs from 'node:fs';
import { evaluate, weekendChurn, entriesByDow } from './evalx.mjs';
import { nameOf, DOW, dow } from './lib.mjs';
const B = JSON.parse(fs.readFileSync('baseline.json'));
for (const k of ['em', 'tr', 'al']) {
  const r = evaluate(B, k, { emOnly: k !== 'tr' }); const f = r.flagged; delete r.flagged;
  console.log(k, JSON.stringify(r));
  const we = evaluate(B, k, { emOnly: k !== 'tr', weekdays: [6, 0] }); delete we.flagged;
  const wd = evaluate(B, k, { emOnly: k !== 'tr', weekdays: [1, 2, 3, 4, 5] }); delete wd.flagged;
  console.log('  finde', JSON.stringify(we)); console.log('  laborable', JSON.stringify(wd));
  const c = weekendChurn(B, k); const ex = c.ex; delete c.ex; console.log('  churn', JSON.stringify(c));
  console.log('  entradas/día', entriesByDow(B, k));
}
