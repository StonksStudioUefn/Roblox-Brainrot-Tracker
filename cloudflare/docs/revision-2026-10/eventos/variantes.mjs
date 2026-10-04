import { loadSeries, name, dow, DOW } from './load.mjs';
import { marketIndex } from './propuesta.mjs';
import { flagV3 } from './v3.mjs';
const { flagEvents } = await import('/home/user/Roblox-Brainrot-Tracker/cloudflare/src/metrics.js');
const END = '2026-10-01', FROM = '2026-08-01';
const by = loadSeries(), M = marketIndex(by, END);
const KEY = [['Lumber Tycoon 2','2026-09-26'],['Inside Brainrot Heads','2026-09-05'],['Emergency Response','2026-09-27'],['Steal a Chicken','2026-09-12'],['Wings for Brainrots','2026-09-18'],['Grow a Garden','2026-09-19'],['he ate them','2026-09-19'],['Scary Sushi','2026-09-26'],["Night Shift at Paulie",'2026-09-13'],['Steal A Verity','2026-09-26'],['Mega Ramp','2026-09-26'],['Fisch','2026-08-29'],['Grow a Chicken Fighter','2026-08-29']];
const V = {
  actual: (v, d) => flagEvents(v, d),
  'A med': (v, d) => flagV3(v, d, null, { agg: 'med', useM: false }),
  'B med+excl': (v, d) => flagV3(v, d, null, { agg: 'med', useM: false, excl: true }),
  'C med+excl+M': (v, d) => flagV3(v, d, M, { agg: 'med', excl: true }),
  'D med+excl+√M': (v, d) => flagV3(v, d, M, { agg: 'med', excl: true, mPow: 0.5 }),
  'E med+√M': (v, d) => flagV3(v, d, M, { agg: 'med', mPow: 0.5 }),
};
const keyIds = KEY.map(([nm, dt]) => [[...by.keys()].find(id => name(id).includes(nm)), dt, nm]);
for (const [k, fn] of Object.entries(V)) {
  let tot = 0, fl = 0, we = 0; const perWe = {};
  const flagsById = new Map();
  for (const [id, s0] of by) {
    const s = s0.filter(r => r.date <= END); if (s.length < 3) continue;
    const v = s.map(r => r.median), d = s.map(r => r.date), f = fn(v, d);
    flagsById.set(id, new Set(d.filter((x, i) => f[i])));
    for (let i = 0; i < s.length; i++) if (d[i] >= FROM) { tot++; if (f[i]) { fl++; if ([0, 6].includes(dow(d[i]))) { we++; perWe[d[i].slice(5)] = (perWe[d[i].slice(5)] || 0) + 1; } } }
  }
  const ks = keyIds.map(([id, dt, nm]) => (flagsById.get(id)?.has(dt) ? 'X' : '.')).join('');
  console.log(`${k.padEnd(16)} ${String(fl).padStart(3)} = ${(100 * fl / tot).toFixed(2)} %  finde ${we} (${(100 * we / fl).toFixed(0)} %)  claves ${ks}  findes: ${Object.entries(perWe).sort().map(([a, b]) => a + ':' + b).join(' ')}`);
}
console.log('claves:', keyIds.map(([, dt, nm]) => nm + ' ' + dt.slice(5)).join(' | '));
