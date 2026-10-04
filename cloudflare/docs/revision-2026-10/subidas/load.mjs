// Carga los CSV diarios → Map(id → { name, rows: Map(dayNum → median), days: sorted dayNums })
import fs from 'node:fs';
const R = '/home/user/Roblox-Brainrot-Tracker/data';
export const DAY = 864e5;
export const dn = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY;
export const iso = d => new Date(d * DAY).toISOString().slice(0, 10);
export const dow = d => (new Date(d * DAY).getUTCDay() + 6) % 7; // 0 = lunes … 6 = domingo
export const DOWN = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

export function load({ until = '2026-10-01' } = {}) {
  const meta = JSON.parse(fs.readFileSync(`${R}/games.json`, 'utf8'));
  const games = new Map();
  const lim = dn(until);
  for (const f of fs.readdirSync(`${R}/daily`).sort()) {
    const lines = fs.readFileSync(`${R}/daily/${f}`, 'utf8').trim().split('\n');
    for (const l of lines.slice(1)) {
      const c = l.split(',');
      const d = dn(c[0]);
      if (d > lim) continue;
      const id = c[1], med = +c[3];
      if (!(med > 0)) continue;
      let g = games.get(id);
      if (!g) { g = { id, name: meta[id]?.name || id, rows: new Map() }; games.set(id, g); }
      g.rows.set(d, { med, n: +c[2], min: +c[5], max: +c[6], visits: c[7] ? +c[7] : null });
    }
  }
  for (const g of games.values()) g.days = [...g.rows.keys()].sort((a, b) => a - b);
  return games;
}

export const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
export const q = (a, p) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
export const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
export const pc = x => x == null ? '—' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
