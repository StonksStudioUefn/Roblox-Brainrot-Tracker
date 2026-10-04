import fs from 'node:fs';
import { nextWeek, addDays, dow } from './lib.mjs';
import { universe } from './evalx.mjs';
import { weekly } from './weekly.mjs';
const B = JSON.parse(fs.readFileSync('baseline.json'));
function spearman(xs, ys) {
  const rk = a => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = Array(a.length); idx.forEach(([, i], k) => r[i] = k); return r; };
  const rx = rk(xs), ry = rk(ys), n = xs.length, mx = (n - 1) / 2;
  let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - mx); dx += (rx[i] - mx) ** 2; dy += (ry[i] - mx) ** 2; }
  return num / Math.sqrt(dx * dy);
}
const rows = [];
for (let D = '2026-08-22'; D <= '2026-09-24'; D = addDays(D, 1)) for (const id of universe(D, false)) {
  const y = nextWeek(id, D); const i = B[D].info[id]; if (y == null || !i) continue;
  const w = weekly(id, D); rows.push({ D, we: [0, 6].includes(dow(D)), y, t: i[2], g24: i[3], g7: i[4], vg: i[5], mom: i[1], em: i[0], ...w });
}
const sig = ['t', 'g24', 'g7', 'mom', 'w1', 'w2', 'sdw', 'vg', 'vg7', 'vacc'];
for (const sub of [['todos', r => true], ['finde', r => r.we], ['laborable', r => !r.we]]) {
  const R = rows.filter(sub[1]);
  console.log(sub[0], 'n=' + R.length, sig.map(s => { const X = R.filter(r => r[s] != null); return `${s} ${spearman(X.map(r => r[s]), X.map(r => r.y)).toFixed(2)}(${X.length})`; }).join('  '));
}
// sostenido vs no
for (const [lab, f] of [['w1>0&w2>0', r => r.sustained], ['w1>0&w2<=0', r => r.w1 > 0 && r.w2 != null && r.w2 <= 0], ['w1>20', r => r.w1 > 20], ['w1>20&sdw>0', r => r.w1 > 20 && r.sdw > 0], ['w1>20&sdw<=0', r => r.w1 > 20 && r.sdw != null && r.sdw <= 0], ['g24>30', r => r.g24 > 30], ['g24>30 finde', r => r.g24 > 30 && r.we], ['g24>30 laborable', r => r.g24 > 30 && !r.we]]) {
  const X = rows.filter(f); const med = X.map(r => r.y).sort((a, b) => a - b)[X.length >> 1];
  console.log(lab.padEnd(18), 'n', X.length, 'siguen >0:', (X.filter(r => r.y > 0).length / X.length * 100).toFixed(0) + '%', 'mediana sem.sig', (med * 100).toFixed(1) + '%');
}
