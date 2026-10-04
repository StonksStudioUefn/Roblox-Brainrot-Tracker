import { loadSeries, dow, DOW, median } from './load.mjs';
const by = loadSeries();
for (const [a,b] of [['2026-06-01','2026-08-23'],['2026-08-24','2026-10-01']]) {
const wd = Array.from({ length: 7 }, () => []);
for (const s0 of by.values()) {
  const s = s0.filter(r => r.date >= a && r.date <= b);
  for (let i = 0; i + 6 < s.length; i++) {
    if (dow(s[i].date) !== 1) continue;
    const w = s.slice(i, i + 7);
    if ((Date.parse(w[6].date) - Date.parse(s[i].date)) !== 6 * 864e5) continue;
    const m = median(w.map(r => r.median));
    w.forEach(r => wd[dow(r.date)].push(r.median / m));
  }
}
console.log(a,b, [1,2,3,4,5,6,0].map(k=>{const x=wd[k].sort((p,q)=>p-q);return `${DOW[k]} ${median(x).toFixed(2)} (p90 ${x[Math.floor(x.length*.9)].toFixed(2)})`}).join('  '), 'semanas', wd[1].length);
}
