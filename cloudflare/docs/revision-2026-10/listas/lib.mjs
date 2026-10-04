// Carga de datos reales y utilidades del backtest (solo lectura del repo).
import fs from 'node:fs';
const REPO = '/home/user/Roblox-Brainrot-Tracker';
export const M = await import(REPO + '/cloudflare/src/metrics.js');
export const H = await import(REPO + '/cloudflare/src/horror.js');

export const games = JSON.parse(fs.readFileSync(REPO + '/data/games.json', 'utf8'));
export const series = new Map();   // id -> Map(date -> row [date, median, min, max, n, visits])
for (const m of ['05', '06', '07', '08', '09', '10']) {
  const txt = fs.readFileSync(`${REPO}/data/daily/2026-${m}.csv`, 'utf8').trim().split('\n');
  const head = txt[0].split(',');
  for (const line of txt.slice(1)) {
    const c = line.split(','); const r = Object.fromEntries(head.map((h, i) => [h, c[i]]));
    const id = r.universe_id;
    if (!series.has(id)) series.set(id, new Map());
    series.get(id).set(r.date, [r.date, +r.median, +r.min, +r.max, +r.n, r.visits ? +r.visits : null]);
  }
}
// muestras crudas (una por juego y día hasta el 02/10): id -> [[tsMin, playing, visits]]
export const raw = new Map();
for (const f of fs.readdirSync(REPO + '/data/raw')) {
  const t = fs.readFileSync(REPO + '/data/raw/' + f, 'utf8').trim().split('\n').slice(1);
  for (const line of t) {
    const [ts, id, p, v] = line.split(',');
    const tm = Date.parse(ts.length === 17 ? ts.replace('Z', ':00Z') : ts) / 60000;
    if (!raw.has(id)) raw.set(id, []);
    raw.get(id).push([tm, +p, v ? +v : null]);
  }
}
for (const a of raw.values()) a.sort((x, y) => x[0] - y[0]);

export const DAY = 864e5;
export const addDays = (s, k) => new Date(Date.parse(s + 'T00:00:00Z') + k * DAY).toISOString().slice(0, 10);
export const dow = s => new Date(s + 'T00:00:00Z').getUTCDay();   // 0 = domingo
export const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const firstDay = new Map([...series].map(([id, m]) => [id, [...m.keys()].sort()[0]]));

const horrorCache = new Map();
export function isHorror(id) {
  if (!horrorCache.has(id)) {
    const g = games[id] || {};
    horrorCache.set(id, H.classifyHorror({ ...g, id: +id }).horror);
  }
  return horrorCache.get(id);
}

/** Juego como en el export para el día D (fin del día D): últimas `days` filas ≤ D y muestras de 48 h. */
export function exportGame(id, D, { days = 24, samples = true } = {}) {
  const m = series.get(id); if (!m || !m.has(D)) return null;
  const dates = [...m.keys()].filter(x => x <= D).sort().slice(-days);
  const d = dates.map(x => m.get(x).slice());
  const g = games[id] || {};
  const endMin = Date.parse(D + 'T23:59:00Z') / 60000;
  const s = samples ? (raw.get(id) || []).filter(r => r[0] <= endMin && r[0] > endMin - 2880) : [];
  return {
    id: +id, name: g.name || id, created: g.created || null,
    first_seen: null, first_day: firstDay.get(id), horror: isHorror(id), sorts: {}, d, s,
  };
}

export function dashboard(D, opts = {}) {
  const gs = [];
  for (const id of series.keys()) { const g = exportGame(id, D, opts); if (g) gs.push(g); }
  return M.buildDashboard({ games: gs }, { now: D + 'T23:59:00Z' });
}

/** Media de jugadores en [a, b] (fechas incluidas) si hay al menos `min` días. */
export function meanRange(id, a, b, min = 3) {
  const m = series.get(id); if (!m) return null;
  let s = 0, c = 0;
  for (let x = a; x <= b; x = addDays(x, 1)) if (m.has(x)) { s += m.get(x)[1]; c++; }
  return c >= min ? s / c : null;
}
/** Crecimiento de la semana siguiente: media(D+1..D+7) / media(D-6..D) − 1. */
export function nextWeek(id, D) {
  const a = meanRange(id, addDays(D, -6), D), b = meanRange(id, addDays(D, 1), addDays(D, 7));
  return a && b ? b / a - 1 : null;
}
export const nameOf = id => (M.cleanTitle(games[id]?.name || String(id))[0] || String(id)).slice(0, 34);
