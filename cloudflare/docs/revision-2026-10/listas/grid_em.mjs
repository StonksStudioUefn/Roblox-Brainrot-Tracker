import fs from 'node:fs';
import { metrics2 } from './variant.mjs';
import { nextWeek, addDays, dow } from './lib.mjs';
import { universe } from './evalx.mjs';
const B = JSON.parse(fs.readFileSync('baseline.json'));
const clip = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const LOG30 = Math.log10(30);
const days = []; for (let D = '2026-08-14'; D <= '2026-09-29'; D = addDays(D, 1)) days.push(D);
const PRE = {}; for (const D of days) PRE[D] = { X: Object.entries(B[D].info).map(([id, i]) => metrics2(id, D, i)),
  big: new Set(D <= '2026-09-24' ? universe(D, true).filter(id => (nextWeek(id, D) ?? -1) >= 0.3) : []) };
const tW = t => t == null ? null : ((1 + t / 100) ** 7 - 1) * 100;
// growth en la escala de hoy (20 = puntos completos)
const V = {
  'actual': { g: x => Math.max(x.t || 0, (x.g24 || 0) / 2, (x.g7 || 0) / 5), grow: x => (x.t > 0) || (x.g24 > 0) || (x.g7 > 0), vg: x => x.vg },
  'g24 ajustado al mercado': { g: x => Math.max(x.t || 0, (x.g24adj || 0) / 2, (x.g7 || 0) / 5), grow: x => (x.t > 0) || (x.g24adj > 0) || (x.g7 > 0), vg: x => x.vg },
  'g24→mismo día sem. ant.': { g: x => Math.max(x.t || 0, (x.sdw ?? x.g24adj ?? 0) / 4, (x.g7 || 0) / 5), grow: x => x.sdw != null ? x.sdw > 0 && ((x.t > 0) || (x.g7 > 0) || x.w1 > 0) : ((x.t > 0) || (x.g24adj > 0) || (x.g7 > 0)), vg: x => x.vg },
  'idem + visitas 7 d': { g: x => Math.max(x.t || 0, (x.sdw ?? x.g24adj ?? 0) / 4, (x.g7 || 0) / 5), grow: x => x.sdw != null ? x.sdw > 0 && ((x.t > 0) || (x.g7 > 0) || x.w1 > 0) : ((x.t > 0) || (x.g24adj > 0) || (x.g7 > 0)), vg: x => x.vg7 ?? x.vg },
  'mediana semanal': { g: x => x.hasWeek ? (x.G ?? 0) / 5 : Math.max(x.t || 0, (x.g24adj || 0) / 2, (x.g7 || 0) / 5) * 0.6, grow: x => x.hasWeek ? x.sdw > 0 && (x.w1 > 0 || x.sdw > 25) : ((x.t > 0) || (x.g24adj > 0) || (x.g7 > 0)), vg: x => x.vg7 ?? x.vg },
};
function score(x, v, sustBonus) {
  if ((x.typical || 0) < 300 || x.visits == null || x.visits > 30e6) return null;
  if (!v.grow(x) || x.status === 'down' || x.status === 'down2') return null;
  const vg = v.vg(x) || 0;
  let s = 30 * clip(vg / 12) + 25 * clip(v.g(x) / 20) + (x.age != null ? 20 * clip(1 - x.age / 120) : 0) + 15 * clip(Math.log10(x.typical / 300) / LOG30);
  if (sustBonus && x.sustained && x.sdw > 0) s += sustBonus;
  s = Math.min(100, Math.round(s));
  if (x.spike && (x.t || 0) < 5) s = Math.round(s * 0.8);
  return s;
}
function run(v, from, to, { thr = 45, sust = 0 } = {}) {
  let n = 0, up = 0, unk = 0, big = 0, hit = 0, an = 0, aup = 0, aunk = 0, wkIn = 0, wkOut = 0;
  const L = {}; for (const D of days) L[D] = new Set(PRE[D].X.map(x => [x.id, score(x, v, sust)]).filter(r => r[1] != null && r[1] >= thr).map(r => r[0]));
  const A = {}; for (const D of days) A[D] = new Set(PRE[D].X.map(x => [x.id, score(x, v, sust)]).filter(r => r[1] != null && r[1] >= 70).map(r => r[0]));
  for (const D of days) { if (D < from || D > to) continue;
    if (D <= '2026-09-24') {
      for (const id of L[D]) { const y = nextWeek(id, D); if (y == null) { unk++; continue; } n++; if (y > 0) up++; }
      for (const id of A[D]) { const y = nextWeek(id, D); if (y == null) { aunk++; continue; } an++; if (y > 0) aup++; }
      big += PRE[D].big.size; for (const id of PRE[D].big) if (L[D].has(id)) hit++;
    }
    if (dow(D) === 6 && L[addDays(D, 2)]) { const ent = [...L[D], ...L[addDays(D, 1)]].filter(i => !L[addDays(D, -1)].has(i)); const u = new Set(ent); wkIn += u.size; for (const i of u) if (!L[addDays(D, 2)].has(i)) wkOut++; }
  }
  return `${(n / 1).toString().padStart(3)} marcas, sigue>0 ${(up / n * 100).toFixed(0)}% (sin dato ${unk}) recall ${(hit / big * 100).toFixed(0)}% de ${big} | alerta≥70: ${an} sigue>0 ${(aup / an * 100).toFixed(0)}% | finde entra ${wkIn} sale lunes ${wkOut}`;
}
if (!process.env.FULL) for (const [k, v] of Object.entries(V)) for (const sust of [0, 5]) console.log((k + (sust ? ' +5 sost.' : '')).padEnd(34), '| ago15–sep05', run(v, '2026-08-15', '2026-09-05', { sust }), '\n'.padEnd(36), '| sep06–sep27', run(v, '2026-09-06', '2026-09-27', { sust }));

// ── Alertas de Telegram: la PRIMERA vez que cada juego pasa de 70 (una alerta por juego)
function firstAlerts(v, rule) {
  const seen = new Set(), out = [];
  let prev = new Set();
  for (const D of days) {
    const S = new Map(PRE[D].X.map(x => [x.id, [score(x, v, 0), x]]).filter(r => r[1][0] != null));
    const now = new Set([...S].filter(([, [s]]) => s >= 70).map(r => r[0]));
    for (const id of now) { if (seen.has(id)) continue; const x = S.get(id)[1];
      if (rule === '2 días' && !prev.has(id)) continue;
      if (rule === 'confirmada' && !(x.hasWeek ? x.sdw > 0 && x.w1 > 0 : prev.has(id))) continue;
      seen.add(id); if (D >= '2026-08-16' && D <= '2026-09-24') out.push([D, id, nextWeek(id, D)]); }
    prev = now;
  }
  const k = out.filter(r => r[2] != null);
  return { n: out.length, sinDato: out.length - k.length, sigue: Math.round(k.filter(r => r[2] > 0).length / k.length * 100), finde: out.filter(r => [0, 6].includes(dow(r[0]))).length,
    findeSigue: Math.round(k.filter(r => [0, 6].includes(dow(r[0])) && r[2] > 0).length / k.filter(r => [0, 6].includes(dow(r[0]))).length * 100), mediana: Math.round(k.map(r => r[2]).sort((a, b) => a - b)[k.length >> 1] * 100), out };
}
import { nameOf } from './lib.mjs';
for (const [lab, v, rule] of [['actual', V.actual, ''], ['actual, 2 días seguidos', V.actual, '2 días'], ['actual, confirmada por semana', V.actual, 'confirmada'], ['mediana semanal', V['mediana semanal'], ''], ['mediana semanal, confirmada', V['mediana semanal'], 'confirmada']]) {
  const r = firstAlerts(v, rule); const o = r.out; delete r.out; console.log('alertas', lab.padEnd(30), JSON.stringify(r));
  if (lab.startsWith('actual')) console.log(o.map(x => `   ${x[0]} ${nameOf(x[1])} → ${x[2] == null ? '-' : Math.round(x[2] * 100) + '%'}`).join('\n'));
}
if (process.env.FULL) for (const k of ['actual', 'idem + visitas 7 d', 'mediana semanal']) console.log('TOTAL', k.padEnd(22), run(V[k], '2026-08-15', '2026-09-27'));
