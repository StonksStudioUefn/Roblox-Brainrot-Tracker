// Pasa flagEvents (el de verdad) por los datos reales y cuenta.
import { loadSeries, name, dow, DOW, dn, median } from './load.mjs';
const { flagEvents } = await import('/home/user/Roblox-Brainrot-Tracker/cloudflare/src/metrics.js');

const END = process.argv[2] || '2026-10-01';
const FROM = '2026-08-01';
const by = loadSeries();
let tot = 0, fl = 0, gaps = 0, rows = 0, zeros = 0;
const dTot = new Array(7).fill(0), dFl = new Array(7).fill(0);
const ex = [];
let gamesWith = 0, gamesN = 0;
for (const [id, s0] of by) {
  const s = s0.filter(r => r.date <= END);
  if (s.length < 3) continue;
  const v = s.map(r => r.median), d = s.map(r => r.date);
  for (let i = 1; i < d.length; i++) { rows++; if (dn(d[i]) - dn(d[i - 1]) > 1) gaps++; }
  zeros += v.filter(x => x === 0).length;
  const f = flagEvents(v, d);
  let any = false, cnt = 0;
  for (let i = 0; i < s.length; i++) {
    if (d[i] < FROM) continue;
    cnt++;
    tot++; dTot[dow(d[i])]++;
    if (f[i]) { fl++; dFl[dow(d[i])]++; any = true; ex.push({ id, name: name(id), date: d[i], dow: DOW[dow(d[i])], v: v[i], ctx: v.slice(Math.max(0, i - 4), i + 4).map((x, k) => (Math.max(0, i - 4) + k === i ? '[' + x + ']' : x)).join(' ') }); }
  }
  if (cnt) { gamesN++; if (any) gamesWith++; }
}
console.log(`fin=${END} juego-días ${FROM}..${END}: ${tot}, marcados ${fl} (${(100 * fl / tot).toFixed(2)} %), juegos ${gamesN}, con algún evento ${gamesWith}`);
console.log('por día de semana (marcados/total, %):', DOW.map((n, k) => `${n} ${dFl[k]}/${dTot[k]} (${(100 * dFl[k] / dTot[k]).toFixed(2)})`).join('  '));
console.log(`sáb+dom: ${dFl[6] + dFl[0]} de ${fl} (${(100 * (dFl[6] + dFl[0]) / fl).toFixed(0)} %)`);
console.log(`huecos (filas tras un día sin dato): ${gaps}/${rows} (${(100 * gaps / rows).toFixed(1)} %), ceros: ${zeros}`);
ex.sort((a, b) => a.date < b.date ? -1 : 1);
for (const e of ex) console.log(e.date, e.dow, e.name, '|', e.ctx);
