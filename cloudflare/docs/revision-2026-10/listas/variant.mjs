// Propuesta: puntuaciones con comparaciones entre semanas, sobre las métricas del baseline
import fs from 'node:fs';
import { series, addDays, dow } from './lib.mjs';
import { weekly } from './weekly.mjs';
const B = JSON.parse(fs.readFileSync('baseline.json'));
const clip = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const LOG_SIZE = Math.log10(1e6 / 300), LOG30 = Math.log10(30);
const median = a => { a = a.filter(x => x != null).sort((p, q) => p - q); const n = a.length; return n ? (n % 2 ? a[n >> 1] : (a[n / 2 - 1] + a[n / 2]) / 2) : null; };

// Factor de mercado: mediana del cambio d/d de todos los juegos seguidos ese día
const MKT = {};
export function market(D) {
  if (MKT[D] != null) return MKT[D];
  const ch = [];
  for (const m of series.values()) { const a = m.get(D), b = m.get(addDays(D, -1)); if (a && b && a[1] >= 300 && b[1] >= 300) ch.push(a[1] / b[1] - 1); }
  return MKT[D] = (median(ch) ?? 0) * 100;
}

export function metrics2(id, D, i) {
  const [em, mom, t, g24, g7, vg, status, typical, age, visits, spike] = i;
  const w = weekly(id, D);
  const mk = market(D);
  const g24adj = g24 == null ? null : ((1 + g24 / 100) / (1 + mk / 100) - 1) * 100;
  // Crecimiento semanal robusto: mediana de (mismo día de la semana anterior, 7 d vs 7 d, tendencia × 7)
  const G = median([w.sdw, w.w1, t != null ? ((1 + t / 100) ** 7 - 1) * 100 : null]);
  const hasWeek = w.sdw != null && w.w1 != null;
  return { id, em, mom, t, g24, g24adj, g7, vg, status, typical, age, visits, spike, ...w, G, hasWeek };
}

export function emerging2(x, { minScore = 45 } = {}) {
  if ((x.typical || 0) < 300 || x.visits == null || x.visits > 30e6) return null;
  let growing, G;
  if (x.hasWeek) { growing = x.sdw > 0 && (x.w1 > 0 || x.sdw > 25); G = x.G; }
  else { growing = (x.t != null && x.t > 0) || (x.g24adj != null && x.g24adj > 0) || (x.g7 != null && x.g7 > 0);
         G = Math.max(((1 + (x.t || 0) / 100) ** 7 - 1) * 100, (x.g24adj || 0) * 1.5, (x.g7 || 0)) * 0.6; }   // sin semana: a 60 %
  if (!growing || x.status === 'down' || x.status === 'down2') return null;
  const vg = x.vg7 ?? x.vg ?? 0;
  const sVisits = 30 * clip(vg / 12);
  const sGrowth = 20 * clip(G / 100);
  const sSust = x.sustained && x.sdw > 0 ? 5 : 0;
  const sYoung = x.age != null ? 20 * clip(1 - x.age / 120) : 0;
  const sSize = 15 * clip(Math.log10(x.typical / 300) / LOG30);
  let s = Math.round(sVisits + sGrowth + sSust + sYoung + sSize);
  if (x.spike && (x.t || 0) < 5) s = Math.round(s * 0.8);
  return s >= minScore ? s : null;
}

export function rising2(x) {
  if (x.spike && (x.t || 0) < 5) return false;
  if (x.hasWeek) return x.sdw >= 10 && x.w1 >= 0 && (x.t == null || x.t > 0);
  return (x.g24adj != null && x.g24adj >= 15) && (x.t == null || x.t > 0);
}
export function momentum2(x) {
  const size = clip(Math.log10(Math.max(x.typical || 1, 1) / 300) / LOG_SIZE);
  const G = x.hasWeek ? x.G : (x.g24adj || 0) * 0.6;
  return Math.round(35 * clip(G / 60) + 20 * clip((x.sdw ?? 0) / 60) + 15 * clip((x.w2 ?? 0) / 30) + 10 * clip((x.t || 0) / 20) + 20 * size);
}

export function lists2(D) {
  const info = B[D].info;
  const X = Object.entries(info).map(([id, i]) => metrics2(id, D, i));
  const em = X.map(x => [x.id, emerging2(x)]).filter(r => r[1] != null).sort((a, b) => b[1] - a[1]).slice(0, 24);
  const tr = X.filter(x => (x.typical || 0) >= 300 && rising2(x)).map(x => [x.id, momentum2(x)]).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const al = em.filter(r => r[1] >= 70);
  return { em: em.map(r => r[0]), tr: tr.map(r => r[0]), al: al.map(r => r[0]), scores: Object.fromEntries(em), X };
}
