import { M, series, exportGame, nextWeek, addDays, dow } from './lib.mjs';
import { weekly } from './weekly.mjs';
import { market } from './variant.mjs';
const clip = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const LOG30 = Math.log10(30);
const days = []; for (let D = '2026-08-14'; D <= '2026-09-29'; D = addDays(D, 1)) days.push(D);
const PRE = {};
for (const D of days) {
  const gs = []; for (const id of series.keys()) { const g = exportGame(id, D, { days: 14, samples: false }); if (g) gs.push(g); }
  const dash = M.buildDashboard({ games: gs }, { now: addDays(D, 1) + 'T00:30:00Z' });
  const mk = market(D);
  PRE[D] = Object.values(dash.games).map(g => { const w = weekly(String(g.id), D);
    return { ...g, id: String(g.id), ...w, g24adj: g.growth_24h == null ? null : ((1 + g.growth_24h / 100) / (1 + mk / 100) - 1) * 100 }; });
}
const VAR = {
  actual: { g: x => Math.max(x.trend || 0, (x.growth_24h || 0) / 2, (x.growth_7d || 0) / 5), grow: x => x.trend > 0 || x.growth_24h > 0 || x.growth_7d > 0 },
  'mismo día sem. ant.': { g: x => Math.max(x.trend || 0, (x.sdw ?? x.g24adj ?? 0) / 4, (x.growth_7d || 0) / 5),
    grow: x => x.sdw != null ? x.sdw > 0 && (x.trend > 0 || x.growth_7d > 0 || x.w1 > 0) : (x.trend > 0 || x.g24adj > 0 || x.growth_7d > 0) },
  'mismo día + visitas 7 d': { g: x => Math.max(x.trend || 0, (x.sdw ?? x.g24adj ?? 0) / 4, (x.growth_7d || 0) / 5), vg: x => x.vg7 ?? x.visits_growth,
    grow: x => x.sdw != null ? x.sdw > 0 && (x.trend > 0 || x.growth_7d > 0 || x.w1 > 0) : (x.trend > 0 || x.g24adj > 0 || x.growth_7d > 0) },
};
function cand(x, v) {   // emergingCore(strict = false) sin likes ni listas de Roblox (no hay datos de septiembre)
  if ((x.typical || 0) < 300 || (x.visits != null && x.visits > 30e6)) return null;
  const weak = !v.grow(x) || x.status === 'down' || x.status === 'down2';
  let s = 30 * clip(((v.vg ? v.vg(x) : x.visits_growth) || 0) / 12) + 25 * clip(v.g(x) / 20) + (x.age_days != null ? 20 * clip(1 - x.age_days / 120) : 0) + 15 * clip(Math.log10(x.typical / 300) / LOG30);
  s = Math.round(s); if (x.spike_now && (x.trend || 0) < 5) s = Math.round(s * 0.8);
  return weak ? s / 2 : s;
}
for (const N of [5, 10]) for (const [lab, v] of Object.entries(VAR)) {
  const L = {}; for (const D of days) L[D] = PRE[D].map(x => [x.id, cand(x, v)]).filter(r => r[1] != null).sort((a, b) => b[1] - a[1]).slice(0, N).map(r => r[0]);
  let n = 0, up = 0, unk = 0, wkIn = 0, wkOut = 0, ch = 0;
  for (const D of days) {
    if (D >= '2026-08-15' && D <= '2026-09-24') for (const id of L[D]) { const y = nextWeek(id, D); if (y == null) unk++; else { n++; if (y > 0) up++; } }
    if (D > days[0]) ch += L[D].filter(i => !L[addDays(D, -1)].includes(i)).length;
    if (dow(D) === 6 && L[addDays(D, 2)] && L[addDays(D, -1)]) { const u = new Set([...L[D], ...L[addDays(D, 1)]].filter(i => !L[addDays(D, -1)].includes(i))); wkIn += u.size; for (const i of u) if (!L[addDays(D, 2)].includes(i)) wkOut++; }
  }
  console.log(`top-${N}`, lab.padEnd(22), `sigue>0 ${Math.round(up / n * 100)}% (n ${n}, sin dato ${unk}) | nuevos/día ${(ch / (days.length - 1)).toFixed(1)} | finde entran ${wkIn}, salen lunes ${wkOut}`);
}
