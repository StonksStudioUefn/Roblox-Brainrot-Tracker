import { M, series, exportGame, nextWeek, addDays, dow, nameOf } from './lib.mjs';
import { weekly } from './weekly.mjs';
import { market } from './variant.mjs';
const clip = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const days = []; for (let D = '2026-08-14'; D <= '2026-09-29'; D = addDays(D, 1)) days.push(D);
const N = 10;
const R = {}, R2 = {};
for (const D of days) {
  const rows = [], rows2 = [];
  for (const id of series.keys()) {
    const g = exportGame(id, D, { days: 14, samples: false }); if (!g) continue;
    const r = M.radarScore(g, { now: addDays(D, 1) + 'T00:30:00Z' });   // la selección corre al cerrar el día, con filas < hoy
    if (!r || r[1] == null) continue;
    rows.push([id, r[1]]);
    // variante: el mismo candidato, con el crecimiento del día cambiado por el del mismo día de la semana anterior
    const w = weekly(id, D);
    let s = r[1];
    if (w.sdw != null) { s = s * (w.sdw > 0 ? 1 : 0.5); if (w.w1 != null && w.w1 > 0 && w.sdw > 0) s += 5; }
    else { const mk = market(D); if (mk > 5) s = s * 0.85; }     // sin semana anterior: en día de subida general, menos
    rows2.push([id, s]);
  }
  R[D] = rows.sort((a, b) => b[1] - a[1]).slice(0, N).map(r => r[0]);
  R2[D] = rows2.sort((a, b) => b[1] - a[1]).slice(0, N).map(r => r[0]);
}
for (const [lab, L] of [['radarScore actual', R], ['radar + semana', R2]]) {
  let n = 0, up = 0, unk = 0, wkIn = 0, wkOut = 0, ch = 0;
  for (const D of days) {
    if (D >= '2026-08-15' && D <= '2026-09-24') for (const id of L[D]) { const y = nextWeek(id, D); if (y == null) unk++; else { n++; if (y > 0) up++; } }
    if (D > days[0]) ch += L[D].filter(i => !L[addDays(D, -1)].includes(i)).length;
    if (dow(D) === 6 && L[addDays(D, 2)] && L[addDays(D, -1)]) { const u = new Set([...L[D], ...L[addDays(D, 1)]].filter(i => !L[addDays(D, -1)].includes(i))); wkIn += u.size; for (const i of u) if (!L[addDays(D, 2)].includes(i)) wkOut++; }
  }
  console.log(lab.padEnd(20), `top-${N} candidatos: sigue>0 ${Math.round(up / n * 100)}% (n ${n}, sin dato ${unk}) | nuevos/día ${(ch / (days.length - 1)).toFixed(1)} | finde entran ${wkIn}, salen lunes ${wkOut}`);
}
