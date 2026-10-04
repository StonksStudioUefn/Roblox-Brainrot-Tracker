// Propuesta: semana contra semana sobre valores desestacionalizados por día de la semana.
import { dow, iso, mean, median } from './load.mjs';
import { flagEvents } from './src/metrics.js';

// Índice global por día de la semana, con datos anteriores a D (8 semanas):
// mediana de v / media móvil centrada de 7 días (sin eventos), normalizado a media 1.
export function rollingIndex(games, weeks = 8) {
  const byCenter = new Map();   // centro → [dow, ratio][]
  for (const g of games.values()) {
    const vals = g.days.map(d => g.rows.get(d).med);
    const fl = flagEvents(vals, g.days.map(iso)); const ev = new Set(g.days.filter((d, i) => fl[i]));
    for (const d of g.days) {
      const w = []; for (let k = -3; k <= 3; k++) { const r = g.rows.get(d + k); if (!r || ev.has(d + k)) break; w.push(r.med); }
      if (w.length < 7) continue;
      let a = byCenter.get(d); if (!a) byCenter.set(d, a = []);
      a.push(g.rows.get(d).med / mean(w));
    }
  }
  const cache = new Map();
  return D => {
    if (cache.has(D)) return cache.get(D);
    const per = Array.from({ length: 7 }, () => []);
    for (let c = D - 7 * weeks; c <= D - 4; c++) for (const r of byCenter.get(c) || []) per[dow(c)].push(r);
    let I = per.map(a => a.length >= 20 ? median(a) : 1);
    const s = mean(I); I = I.map(x => x / s);
    cache.set(D, I); return I;
  };
}

function theilSenX(xs, ys) {
  const sl = [];
  for (let a = 0; a < xs.length; a++) for (let b = a + 1; b < xs.length; b++) sl.push((ys[b] - ys[a]) / (xs[b] - xs[a]));
  return sl.length ? Math.exp(median(sl)) - 1 : null;
}

// Umbral de "se mueve" según el tamaño (ruido semana a semana medido en noise.mjs)
export const T = typ => typ < 1000 ? 0.25 : typ < 10000 ? 0.15 : 0.10;

// rows: [[díaNum, mediana]] ascendentes hasta D (días cerrados), I: índice lun..dom
export function proposal(rows, D, I, variant = 'base', _inner = false) {
  const days = rows.map(r => r[0]), vals = rows.map(r => r[1]);
  const fl = flagEvents(vals, days.map(iso));
  const clean = new Map(); rows.forEach(([d, v], i) => { if (!fl[i]) clean.set(d, v); });
  const ds = d => clean.has(d) ? clean.get(d) / I[dow(d)] : null;
  const win = (a, b) => { const x = []; for (let d = a; d <= b; d++) { const v = ds(d); if (v != null) x.push(v); } return x; };
  const W1 = win(D - 6, D), W0 = win(D - 13, D - 7), M0 = win(D - 34, D - 28);
  const MIN = 4;
  const wow = W1.length >= MIN && W0.length >= MIN ? mean(W1) / mean(W0) - 1 : null;
  const mom = W1.length >= MIN && M0.length >= MIN ? mean(W1) / mean(M0) - 1 : null;
  const same = clean.has(D) && clean.has(D - 7) ? clean.get(D) / clean.get(D - 7) - 1 : null;
  const raw1 = []; for (let d = D - 6; d <= D; d++) if (clean.has(d)) raw1.push(clean.get(d));
  const typ = raw1.length ? mean(raw1) : vals[vals.length - 1];
  // Tendencia: Theil–Sen sobre log(desestacionalizado) con la x del día real, 14 días
  const xs = [], ys = [];
  for (let d = D - 13; d <= D; d++) { const v = ds(d); if (v > 0) { xs.push(d - D); ys.push(Math.log(v)); } }
  const trend = xs.length >= 7 ? theilSenX(xs, ys) : null;
  // Juegos con menos de dos semanas: últimos 3 días desestacionalizados vs los 3 primeros (≥ 7 días de historia)
  let short = null;
  if (wow === null) {
    const all = win(D - 13, D);
    const span = days.filter(d => d >= D - 13 && clean.has(d));
    if (all.length >= 6 && D - span[0] >= 6) short = mean(all.slice(-3)) / mean(all.slice(0, 3)) - 1;
  }
  let g = wow, t = variant === 'uni' || variant === 'hyst' ? 0.15 : variant === 'uni20' ? 0.20 : T(typ);
  if (g === null && short !== null) { g = short; t *= 1.5; }   // con poca historia, más exigente
  let status;
  // Histéresis: con el WoW de ayer (misma serie, ventana un día antes) ya por encima del umbral, basta la mitad
  let tUp = t, tDown = t;
  if (variant === 'hyst' && !_inner && g !== null) {
    const y = proposal(rows.filter(r => r[0] <= D - 1), D - 1, I, 'uni', true);
    if (y.wow !== null && Math.log1p(y.wow) >= Math.log1p(t)) tUp = t / 2;
    if (y.wow !== null && Math.log1p(y.wow) <= -Math.log1p(t)) tDown = t / 2;
  }
  if (g === null) status = 'new';
  else {
    const lg = Math.log1p(g), lt = Math.log1p(t);
    const okUp = variant !== 'conf' || trend === null || trend >= 0;
    const okDown = variant !== 'conf' || trend === null || trend <= 0;
    if (lg >= Math.log1p(Math.max(0.5, 3 * t)) && okUp) status = 'hot';
    else if (lg >= Math.log1p(tUp) && okUp) status = 'up';
    else if (lg <= -Math.log1p(Math.max(0.5, 3 * t)) && okDown) status = 'down2';
    else if (lg <= -Math.log1p(tDown) && okDown) status = 'down';
    else status = 'flat';
  }
  return { status, wow, mom, same, typ, trend, short, n1: W1.length, n0: W0.length };
}
