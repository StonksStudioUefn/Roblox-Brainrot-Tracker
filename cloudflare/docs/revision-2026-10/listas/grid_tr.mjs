import fs from 'node:fs';
import { metrics2 } from './variant.mjs';
import { nextWeek, addDays, dow } from './lib.mjs';
import { universe } from './evalx.mjs';
const B = JSON.parse(fs.readFileSync('baseline.json'));
const clip = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const LOG_SIZE = Math.log10(1e6 / 300);
const days = []; for (let D = '2026-08-22'; D <= '2026-09-24'; D = addDays(D, 1)) days.push(D);
const PRE = {}; for (const D of days) PRE[D] = { X: Object.entries(B[D].info).map(([id, i]) => metrics2(id, D, i)).filter(x => x.typical >= 300),
  big: new Set(universe(D, false).filter(id => (nextWeek(id, D) ?? -1) >= 0.3)) };
const size = x => clip(Math.log10(Math.max(x.typical || 1, 1) / 300) / LOG_SIZE);
const base = ({ status, t, spike }) => (status === 'hot' || status === 'up') && (t === null || t > 0) && !(spike && (t || 0) < 5);
const filters = {
  actual: base,
  'actual+sdw>0': x => base(x) && (x.sdw == null || x.sdw > 0),
  'actual+sdw>0+w1>0': x => base(x) && (x.sdw == null || x.sdw > 0) && (x.w1 == null || x.w1 > 0),
  'semana(sdw≥10,w1≥0,t>0)': x => !(x.spike && (x.t || 0) < 5) && (x.hasWeek ? x.sdw >= 10 && x.w1 >= 0 && (x.t == null || x.t > 0) : base(x) && (x.g24adj ?? 0) >= 15),
};
const scores = {
  actual: x => x.mom,
  'actual, g24→sdw': x => { let s = 35 * clip((x.t || 0) / 20) + 25 * clip((x.sdw ?? x.g24adj ?? 0) / 50) + 20 * clip((x.g7 || 0) / 100) + 20 * size(x); if (x.spike && (x.t || 0) < 5) s *= .7; return s; },
  'actual, g24→sdw, g7→w1': x => { let s = 35 * clip((x.t || 0) / 20) + 25 * clip((x.sdw ?? x.g24adj ?? 0) / 50) + 20 * clip((x.w1 ?? x.g7 ?? 0) / 50) + 20 * size(x); if (x.spike && (x.t || 0) < 5) s *= .7; return s; },
  'G mediana': x => 35 * clip((x.G ?? 0) / 60) + 25 * clip((x.sdw ?? 0) / 50) + 20 * clip((x.t || 0) / 20) + 20 * size(x),
};
function run(filter, score, from, to, N = 12) {
  let n = 0, up = 0, unk = 0, big = 0, hit = 0, prevSet = null, churn = 0, cd = 0;
  for (const D of days) { if (D < from || D > to) continue;
    const L = PRE[D].X.filter(filter).map(x => [x.id, score(x)]).sort((a, b) => b[1] - a[1]).slice(0, N).map(r => r[0]);
    for (const id of L) { const y = nextWeek(id, D); if (y == null) { unk++; continue; } n++; if (y > 0) up++; }
    big += PRE[D].big.size; for (const id of PRE[D].big) if (L.includes(id)) hit++;
    if (prevSet) { churn += L.filter(i => !prevSet.has(i)).length; cd++; } prevSet = new Set(L);
  }
  return `prec ${(up / n * 100).toFixed(0)}% (sin dato ${unk}) recall ${(hit / big * 100).toFixed(0)}% nuevos/día ${(churn / cd).toFixed(1)}`;
}
for (const [fn, f] of Object.entries(filters)) for (const [sn, s] of Object.entries(scores))
  console.log(fn.padEnd(26), sn.padEnd(26), '| ago22–sep07', run(f, s, '2026-08-22', '2026-09-07'), '| sep08–sep24', run(f, s, '2026-09-08', '2026-09-24'));

console.log('\n— con lista estable (se queda si sigue en el top 18) y salidas del lunes —');
function run2(filter, score, from, to, hyst, N = 12) {
  let n = 0, up = 0, unk = 0, big = 0, hit = 0, churn = 0, cd = 0, wkIn = 0, wkOut = 0; const L = {};
  let prev = [];
  for (const D of days) {
    const ranked = PRE[D].X.filter(filter).map(x => [x.id, score(x)]).sort((a, b) => b[1] - a[1]).map(r => r[0]);
    let list = ranked.slice(0, N);
    if (hyst) { const keep = prev.filter(i => ranked.indexOf(i) >= 0 && ranked.indexOf(i) < 18); list = [...new Set([...keep, ...ranked])].slice(0, N); }
    L[D] = list; prev = list;
  }
  for (const D of days) { if (D < from || D > to) continue; const Ls = L[D];
    for (const id of Ls) { const y = nextWeek(id, D); if (y == null) { unk++; continue; } n++; if (y > 0) up++; }
    big += PRE[D].big.size; for (const id of PRE[D].big) if (Ls.includes(id)) hit++;
    if (L[addDays(D, -1)]) { churn += Ls.filter(i => !L[addDays(D, -1)].includes(i)).length; cd++; }
    if (dow(D) === 6 && L[addDays(D, 2)] && L[addDays(D, -1)]) { const u = new Set([...L[D], ...L[addDays(D, 1)]].filter(i => !L[addDays(D, -1)].includes(i))); wkIn += u.size; for (const i of u) if (!L[addDays(D, 2)].includes(i)) wkOut++; }
  }
  return `prec ${(up / n * 100).toFixed(0)}% (sin dato ${unk}) recall ${(hit / big * 100).toFixed(0)}% nuevos/día ${(churn / cd).toFixed(1)} finde entran ${wkIn} salen lunes ${wkOut}`;
}
const F = { actual: filters.actual, 'sdw>0,w1>0': filters['actual+sdw>0+w1>0'] };
for (const [fn, f] of Object.entries(F)) for (const sn of ['actual', 'actual, g24→sdw, g7→w1', 'G mediana']) for (const h of [false, true])
  console.log(fn.padEnd(12), sn.padEnd(24), h ? 'estable' : 'diaria ', '|', run2(f, scores[sn], '2026-08-22', '2026-09-24', h));
