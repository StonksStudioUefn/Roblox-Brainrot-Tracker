// Propuesta v3 (la que se recomienda). Ver informe.md.
import { loadSeries, name, dow, DOW, dn, median } from './load.mjs';
import { marketIndex } from './propuesta.mjs';
const { flagEvents } = await import('/home/user/Roblox-Brainrot-Tracker/cloudflare/src/metrics.js');
export const P3 = { W: 3, maxGap: 7, minRatio: 1.6, madK: 3.5, weeks: 3 };
const lowMedian = a => { const b = [...a].sort((x, y) => x - y); return b[(b.length - 1) >> 1]; };

export function flagV3(v, d, M = null, opt = {}) {
  const { W, maxGap, minRatio, madK, weeks } = { ...P3, ...opt };
  const excl = opt.excl ?? false, mPow = opt.mPow ?? 1;
  const sideMad = opt.sideMad ?? true, extend = opt.extend ?? true, agg = opt.agg ?? 'lowmed', useM = opt.useM ?? true;
  const n = v.length, t = d.map(dn), idx = new Map(t.map((x, i) => [x, i]));
  const flags = new Array(n).fill(false), base = new Array(n).fill(null), ref = new Array(n).fill(null);
  const refOf = i => {
    const rs = [];
    for (let k = 1; k <= weeks; k++) { const j = idx.get(t[i] - 7 * k); if (j != null && v[j] > 0 && !(excl && flags[j])) rs.push(v[j]); }
    return rs.length ? (agg === 'max' ? Math.max(...rs) : agg === 'med' ? median(rs) : lowMedian(rs)) : null;
  };
  for (let i = 0; i < n; i++) {
    ref[i] = refOf(i);
    const before = [], after = [];
    for (let j = i - 1; j >= Math.max(0, i - W); j--) if (t[i] - t[j] <= maxGap) before.push(v[j]);
    for (let j = i + 1; j <= Math.min(n - 1, i + W); j++) if (t[j] - t[i] <= maxGap) after.push(v[j]);
    if (before.length < 2 || !after.length || !(v[i] > 0)) continue;
    const mb = median(before), ma = median(after), b = Math.max(mb, ma);
    base[i] = b;
    if (!(v[i] > minRatio * b)) continue;
    let devs;
    if (sideMad) devs = before.map(x => Math.abs(x - mb)).concat(after.map(x => Math.abs(x - ma)));
    else { const nb = before.concat(after), m = median(nb); devs = nb.map(x => Math.abs(x - m)); }
    const mad = Math.max(median(devs) * 1.4826, 0.05 * b);
    if (!(v[i] - b > madK * mad)) continue;
    if (ref[i] != null) { if (v[i] < minRatio * ref[i]) continue; }
    else if (useM && M && M.has(d[i]) && v[i] < minRatio * b * Math.max(1, M.get(d[i])) ** mPow) continue;
    flags[i] = true;
  }
  if (extend) for (let pass = 0; pass < 3; pass++) for (let i = 0; i < n; i++) if (flags[i] && base[i]) {
    for (const j of [i - 1, i + 1]) {
      if (j < 0 || j >= n - 1 || flags[j] || Math.abs(t[j] - t[i]) !== 1) continue;
      if (v[j] >= minRatio * base[i] && (ref[j] == null || v[j] >= minRatio * ref[j])) { flags[j] = true; base[j] = base[i]; }
    }
  }
  return flags;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const END = '2026-10-01', FROM = '2026-08-01';
  const by = loadSeries(), M = marketIndex(by, END);
  const V = {
    actual: (v, d) => flagEvents(v, d),
    'solo semanas 7/14/21 mediana-baja': (v, d) => flagV3(v, d, null, { sideMad: false, extend: false, maxGap: 999, useM: false }),
    '+ huecos ≤7 días': (v, d) => flagV3(v, d, null, { sideMad: false, extend: false, useM: false }),
    '+ MAD por lado': (v, d) => flagV3(v, d, null, { extend: false, useM: false }),
    '+ M(fecha) si no hay semanas': (v, d) => flagV3(v, d, M, { extend: false }),
    'v3 completa (+ extensión)': (v, d) => flagV3(v, d, M),
    'v3 con max (como hoy) en vez de mediana-baja': (v, d) => flagV3(v, d, M, { agg: 'max' }),
    'v3 con mediana normal': (v, d) => flagV3(v, d, M, { agg: 'med' }),
    'v3 semanas=2': (v, d) => flagV3(v, d, M, { weeks: 2 }),
  };
  const res = {};
  for (const [k, fn] of Object.entries(V)) {
    let tot = 0, fl = 0, we = 0, games = 0; const list = [];
    for (const [id, s0] of by) {
      const s = s0.filter(r => r.date <= END); if (s.length < 3) continue;
      const v = s.map(r => r.median), d = s.map(r => r.date), f = fn(v, d);
      let any = false;
      for (let i = 0; i < s.length; i++) if (d[i] >= FROM) { tot++; if (f[i]) { fl++; any = true; if ([0, 6].includes(dow(d[i]))) we++; list.push(id + '|' + d[i]); } }
      if (any) games++;
    }
    res[k] = new Set(list);
    console.log(`${k.padEnd(46)} ${String(fl).padStart(3)} / ${tot} = ${(100 * fl / tot).toFixed(2)} %  sáb+dom ${we} (${(100 * we / fl).toFixed(0)} %)  juegos ${games}`);
  }
  const show = (title, set) => {
    console.log('\n' + title + ` (${set.length})`);
    for (const x of set.sort((a, b) => a.split('|')[1] < b.split('|')[1] ? -1 : 1)) {
      const [id, date] = x.split('|'); const s = by.get(id).filter(r => r.date <= END), i = s.findIndex(r => r.date === date);
      const ctx = s.slice(Math.max(0, i - 4), i + 4).map(r => (r.date === date ? `[${r.median}]` : r.median)).join(' ');
      const sw = [7, 14, 21].map(b => { const tt = new Date((dn(date) - b) * 864e5).toISOString().slice(0, 10); const y = s.find(r => r.date === tt); return y ? y.median : '-'; }).join('/');
      console.log(`${date} ${DOW[dow(date)]} ${name(id)} | ${ctx} | -7/-14/-21: ${sw}`);
    }
  };
  const A = res.actual, B = res['v3 completa (+ extensión)'];
  show('NUEVOS en v3', [...B].filter(x => !A.has(x)));
  show('QUITADOS en v3', [...A].filter(x => !B.has(x)));
}
