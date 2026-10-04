import { series, addDays } from './lib.mjs';
// Señales entre semanas a partir de la serie diaria (por fecha, no por fila)
export function weekly(id, D) {
  const m = series.get(id); if (!m) return null;
  const v = x => m.get(x)?.[1] ?? null, vis = x => m.get(x)?.[5] ?? null;
  const mean = (a, b, min = 4) => { let s = 0, c = 0; for (let x = a; x <= b; x = addDays(x, 1)) { const y = v(x); if (y) { s += y; c++; } } return c >= min ? s / c : null; };
  const m7 = mean(addDays(D, -6), D), p7 = mean(addDays(D, -13), addDays(D, -7)), pp7 = mean(addDays(D, -20), addDays(D, -14));
  const r = (a, b) => (a != null && b) ? (a / b - 1) * 100 : null;
  const w1 = r(m7, p7), w2 = r(p7, pp7);
  const sdw = r(v(D), v(addDays(D, -7)));
  // visitas: ganadas en 7 días / visitas actuales, por día (busca la fila con visitas más cercana)
  const visAt = (x, back = 2) => { for (let k = 0; k <= back; k++) { const y = vis(addDays(x, -k)); if (y) return [y, k]; } return null; };
  const V0 = visAt(D), V7 = visAt(addDays(D, -7)), V14 = visAt(addDays(D, -14));
  let vg7 = null, vacc = null;
  if (V0 && V7) { const days = 7 - V0[1] + V7[1]; vg7 = (V0[0] - V7[0]) / days * 100 / V0[0]; }
  if (V0 && V7 && V14) { const a = V0[0] - V7[0], b = V7[0] - V14[0]; if (b > 0) vacc = (a / b - 1) * 100; }
  return { m7, p7, w1, w2, sdw, vg7: vg7 != null && vg7 >= 0 ? vg7 : null, vacc, sustained: w1 != null && w2 != null && w1 > 0 && w2 > 0 };
}
