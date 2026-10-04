import { loadSeries, name } from './load.mjs';
import { flagV2, marketIndex, ratios } from './propuesta.mjs';
const by = loadSeries(); const M = marketIndex(by, '2026-10-01');
for (const [id, s0] of by) {
  const nm = name(id);
  if (!/Emergency Response|he ate them|Pull Lucky Blocks|Tongue Escape|Steal A Verity/.test(nm)) continue;
  const s = s0.filter(r => r.date <= '2026-10-01' && r.date >= '2026-07-20');
  const v = s.map(r => r.median), d = s.map(r => r.date);
  console.log(nm, s.length, d[0], d.at(-1));
  console.log(' ', d.map((x, i) => x.slice(5) + ':' + v[i]).slice(-40).join(' '));
}
