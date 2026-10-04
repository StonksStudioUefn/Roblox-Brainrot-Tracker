// Propuesta de flagCore v2 y comparación con el actual sobre los datos reales.
//   · ventanas por FECHA (±3 días de calendario), no por posición;
//   · MAD "por lado" (cada lado respecto a su mediana): una tendencia o un escalón no la inflan;
//   · día de la semana: esperado = base × S, con
//       S = max(1, M(fecha), mediana_k=1..3 r(fecha − 7k))
//     r(x) = v(x) / base(x) del propio juego (cuánto se sale ese día de su entorno) y
//     M(fecha) = mediana de r(fecha) en todo el catálogo (el "día de mercado": fines de semana, vuelta al cole…);
//     sustituye al "max de hace 7 y 14 días" (un evento de hace 1-2 semanas ya no tapa el de hoy);
//   · eventos de varios días: se marcan también los días pegados a uno marcado que siguen ≥ min_ratio × su base.
import { loadSeries, name, dow, DOW, dn, median } from './load.mjs';
const { flagEvents } = await import('/home/user/Roblox-Brainrot-Tracker/cloudflare/src/metrics.js');

const P = { W: 3, minRatio: 1.6, madK: 3.5, weeks: 3 };

function localBase(v, dnum, i, W) {
  const before = [], after = [];
  for (let j = i - 1; j >= 0 && dnum[i] - dnum[j] <= W; j--) before.push(v[j]);
  for (let j = i + 1; j < v.length && dnum[j] - dnum[i] <= W; j++) after.push(v[j]);
  return { before, after };
}

export function ratios(v, d, W = P.W) {
  const dnum = d.map(dn), out = new Array(v.length).fill(null);
  for (let i = 0; i < v.length; i++) {
    const { before, after } = localBase(v, dnum, i, W);
    if (before.length + after.length < 2) continue;
    const base = Math.max(before.length ? median(before) : 0, after.length ? median(after) : 0);
    if (base > 0) out[i] = v[i] / base;
  }
  return out;
}

/** M(fecha) = mediana de r entre juegos con ≥ 30 juegos ese día. */
export function marketIndex(by, END) {
  const per = new Map();
  for (const s0 of by.values()) {
    const s = s0.filter(r => r.date <= END);
    const v = s.map(r => r.median), d = s.map(r => r.date), r = ratios(v, d);
    r.forEach((x, i) => { if (x != null) { if (!per.has(d[i])) per.set(d[i], []); per.get(d[i]).push(x); } });
  }
  const M = new Map();
  for (const [k, a] of per) if (a.length >= 30) M.set(k, median(a));
  return M;
}

export function flagV2(v, d, M = null, opt = {}) {
  const { W, minRatio, madK, weeks } = { ...P, ...opt };
  const useWd = opt.useWd ?? true, useM = opt.useM ?? true, extend = opt.extend ?? true, byDate = opt.byDate ?? true, sideMad = opt.sideMad ?? true;
  const n = v.length, dnum = d.map(dn), flags = new Array(n).fill(false), bases = new Array(n).fill(null);
  const idx = new Map(dnum.map((x, i) => [x, i]));
  const r = ratios(v, d, W);
  for (let i = 0; i < n; i++) {
    let before, after;
    if (byDate) ({ before, after } = localBase(v, dnum, i, W));
    else { before = v.slice(Math.max(0, i - W), i); after = v.slice(i + 1, i + 1 + W); }
    if (before.length < 2 || after.length === 0) continue;
    const mb = median(before), ma = median(after), base = Math.max(mb, ma);
    bases[i] = base;
    let S = 1;
    if (useM && M && M.has(d[i])) S = Math.max(S, M.get(d[i]));
    if (useWd) {
      const rs = [];
      for (let k = 1; k <= weeks; k++) { const j = idx.get(dnum[i] - 7 * k); if (j != null && r[j] != null) rs.push(r[j]); }
      if (rs.length) S = Math.max(S, median(rs));
    }
    const exp = base * S;
    if (!(v[i] > exp * minRatio)) continue;
    const devs = sideMad ? before.map(x => Math.abs(x - mb)).concat(after.map(x => Math.abs(x - ma)))
      : (() => { const nb = before.concat(after), m = median(nb); return nb.map(x => Math.abs(x - m)); })();
    const mad = Math.max(median(devs) * 1.4826, 0.05 * base) * S;
    if (!((v[i] - exp) > madK * mad)) continue;
    flags[i] = true;
  }
  if (extend) {
    // días pegados (por fecha) a un evento que siguen altos respecto a la base del evento
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < n; i++) if (flags[i] && bases[i]) {
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= n - 1 || flags[j] || Math.abs(dnum[j] - dnum[i]) !== 1) continue;
        if (v[j] >= minRatio * bases[i]) { flags[j] = true; bases[j] = bases[i]; }
      }
    }
  }
  return flags;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const END = '2026-10-01', FROM = '2026-08-01';
  const by = loadSeries();
  const M = marketIndex(by, END);
  const variants = {
    actual: (v, d) => flagEvents(v, d),
    'v2 sin día-semana (solo fechas+MAD+ext)': (v, d) => flagV2(v, d, M, { useWd: false, useM: false }),
    'v2 solo propio juego (sin M)': (v, d) => flagV2(v, d, M, { useM: false }),
    'v2 solo M (sin propio)': (v, d) => flagV2(v, d, M, { useWd: false }),
    'v2 completo': (v, d) => flagV2(v, d, M),
    'v2 completo sin extensión': (v, d) => flagV2(v, d, M, { extend: false }),
  };
  const res = {};
  for (const [k, fn] of Object.entries(variants)) {
    let tot = 0, fl = 0, we = 0, games = 0; const list = [];
    const dTot = new Array(7).fill(0), dFl = new Array(7).fill(0);
    for (const [id, s0] of by) {
      const s = s0.filter(r => r.date <= END); if (s.length < 3) continue;
      const v = s.map(r => r.median), d = s.map(r => r.date), f = fn(v, d);
      let any = false;
      for (let i = 0; i < s.length; i++) if (d[i] >= FROM) {
        tot++; dTot[dow(d[i])]++;
        if (f[i]) { fl++; dFl[dow(d[i])]++; any = true; if ([0, 6].includes(dow(d[i]))) we++; list.push(id + '|' + d[i]); }
      }
      if (any) games++;
    }
    res[k] = new Set(list);
    console.log(`${k.padEnd(42)} marcados ${String(fl).padStart(3)} / ${tot} = ${(100 * fl / tot).toFixed(2)} %  sáb+dom ${we} (${(100 * we / fl).toFixed(0)} %)  juegos ${games}  | ` + [1, 2, 3, 4, 5, 6, 0].map(j => `${DOW[j]} ${(100 * dFl[j] / dTot[j]).toFixed(1)}`).join(' '));
  }
  console.log('\nM(fecha) fines de semana:', [...M].filter(([k]) => k >= FROM && [0, 6].includes(dow(k))).map(([k, x]) => k.slice(5) + ' ' + x.toFixed(2)).join(', '));
  const show = (title, set) => {
    console.log('\n' + title + ` (${set.length})`);
    const rows = set.map(x => { const [id, date] = x.split('|'); return { id, date }; }).sort((a, b) => a.date < b.date ? -1 : 1);
    for (const { id, date } of rows) {
      const s = by.get(id).filter(r => r.date <= END), i = s.findIndex(r => r.date === date);
      const ctx = s.slice(Math.max(0, i - 4), i + 4).map((r, k) => (r.date === date ? `[${r.median}]` : r.median)).join(' ');
      const sw = [7, 14, 21].map(b => { const t = new Date((dn(date) - b) * 864e5).toISOString().slice(0, 10); const x = s.find(r => r.date === t); return x ? x.median : '-'; }).join('/');
      console.log(`${date} ${DOW[dow(date)]} M=${(M.get(date) || 0).toFixed(2)} ${name(id)} | ${ctx} | -7/-14/-21: ${sw}`);
    }
  };
  const A = res.actual, B = res['v2 completo'];
  show('NUEVOS en v2 completo (no marcados hoy)', [...B].filter(x => !A.has(x)));
  show('QUITADOS en v2 completo (marcados hoy)', [...A].filter(x => !B.has(x)));
}
