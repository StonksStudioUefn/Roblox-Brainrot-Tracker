import { loadSeries, name, dow, DOW, dn } from './load.mjs';
import { marketIndex } from './propuesta.mjs';
import { flagV3 } from './v3.mjs';
const { flagEvents } = await import('/home/user/Roblox-Brainrot-Tracker/cloudflare/src/metrics.js');
const END = '2026-10-01', FROM = '2026-08-01';
const by = loadSeries(), M = marketIndex(by, END);
const add = [], rem = []; let both = 0;
for (const [id, s0] of by) {
  const s = s0.filter(r => r.date <= END); if (s.length < 3) continue;
  const v = s.map(r => r.median), d = s.map(r => r.date);
  const a = flagEvents(v, d), b = flagV3(v, d, M, { agg: 'med', excl: true, mPow: 0.5 });
  for (let i = 0; i < s.length; i++) if (d[i] >= FROM && (a[i] || b[i])) {
    const ctx = v.slice(Math.max(0, i - 3), i + 4).map((x, k) => (Math.max(0, i - 3) + k === i ? `[${x}]` : x)).join(' ');
    const sw = [7, 14, 21].map(bk => { const t = new Date((dn(d[i]) - bk) * 864e5).toISOString().slice(0, 10); const j = d.indexOf(t); return j >= 0 ? v[j] : '-'; }).join('/');
    const line = `${d[i]} ${DOW[dow(d[i])]} ${name(id)} | ${ctx} | -7/-14/-21 ${sw}`;
    if (a[i] && b[i]) both++; else if (b[i]) add.push(line); else rem.push(line);
  }
}
console.log('en ambos', both, 'nuevos', add.length, 'quitados', rem.length);
console.log('NUEVOS'); add.sort().forEach(x => console.log(' ', x));
console.log('QUITADOS'); rem.sort().forEach(x => console.log(' ', x));
