// flagCore instrumentado: por qué se marca o no cada día. Comprueba que coincide con flagEvents.
import { loadSeries, name, dow, DOW, dn, median } from './load.mjs';
const { flagEvents } = await import('/home/user/Roblox-Brainrot-Tracker/cloudflare/src/metrics.js');
const W = 3, MINR = 1.6, K = 3.5;
export function why(v, d) {
  const n = v.length, out = [];
  const idx = new Map(d.map((x, i) => [x, i]));
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - W), hi = Math.min(n, i + 1 + W);
    const before = v.slice(lo, i), after = v.slice(i + 1, hi);
    const r = { i, flag: false };
    if (before.length < 2 || !after.length) { r.why = i === n - 1 ? 'ultimo' : (before.length < 2 ? 'inicio' : 'borde'); out.push(r); continue; }
    const base = Math.max(median(before), median(after));
    r.base = base; r.ratio = v[i] / base; r.mb = median(before); r.ma = median(after);
    const neigh = before.concat(after), m = median(neigh);
    const mad = Math.max(median(neigh.map(x => Math.abs(x - m))) * 1.4826, m * 0.05);
    if (!(v[i] > base * MINR)) { r.why = 'ratio'; out.push(r); continue; }
    if (!((v[i] - base) > K * mad)) { r.why = 'mad'; out.push(r); continue; }
    const same = [7, 14].map(b => { const t = new Date((dn(d[i]) - b) * 864e5).toISOString().slice(0, 10); return idx.has(t) ? v[idx.get(t)] : null; }).filter(x => x);
    r.same = same;
    if (same.length && v[i] < Math.max(...same) * MINR) { r.why = 'semana'; out.push(r); continue; }
    r.flag = true; r.why = 'evento'; out.push(r);
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const by = loadSeries();
  const END = '2026-10-01', FROM = '2026-08-01';
  let mism = 0;
  const cnt = {}, big = [];
  for (const [id, s0] of by) {
    const s = s0.filter(r => r.date <= END); if (s.length < 3) continue;
    const v = s.map(r => r.median), d = s.map(r => r.date);
    const f = flagEvents(v, d), w = why(v, d);
    for (let i = 0; i < s.length; i++) {
      if (f[i] !== w[i].flag) mism++;
      if (d[i] < FROM) continue;
      // "pico claro": ≥ 2× la base y ≥ 2× la mediana de los 7 días de antes Y de después (por fechas)
      const r = w[i];
      if (r.ratio >= 2 || (r.why === 'ultimo' || r.why === 'inicio')) {
        const lo = v.slice(Math.max(0, i - 3), i), hi = v.slice(i + 1, i + 4);
        const rr = v[i] / Math.max(median(lo) || 0, median(hi) || 0);
        if (r.ratio >= 2) { cnt[r.why] = (cnt[r.why] || 0) + 1; if (!r.flag) big.push({ name: name(id), date: d[i], dow: DOW[dow(d[i])], why: r.why, v: v[i], base: r.base, same: r.same, ctx: v.slice(Math.max(0, i - 4), i + 4).map((x, k) => (Math.max(0, i - 4) + k === i ? '[' + x + ']' : x)).join(' '), gapDays: d.slice(Math.max(0, i - 3), i + 4).map(x => x.slice(5)).join(',') }); }
      }
    }
  }
  console.log('discrepancias con flagEvents:', mism);
  console.log('días con v ≥ 2× base (Aug-Oct1) por resultado:', cnt);
  big.sort((a, b) => b.v / b.base - a.v / a.base);
  for (const b of big) console.log(b.date, b.dow, b.why, b.name, '| x' + (b.v / b.base).toFixed(2), 'mismo día:', JSON.stringify(b.same), '|', b.ctx, '|', b.gapDays);
}
