import fs from 'node:fs';
const R = '/home/user/Roblox-Brainrot-Tracker/data';
export const games = JSON.parse(fs.readFileSync(R + '/games.json', 'utf8'));
export function loadSeries() {
  const by = new Map();
  for (const f of fs.readdirSync(R + '/daily').sort()) {
    const lines = fs.readFileSync(R + '/daily/' + f, 'utf8').trim().split('\n');
    const h = lines[0].split(',');
    const ix = Object.fromEntries(h.map((k, i) => [k, i]));
    for (const l of lines.slice(1)) {
      const c = l.split(',');
      const id = c[ix.universe_id];
      if (!by.has(id)) by.set(id, []);
      by.get(id).push({ date: c[ix.date], n: +c[ix.n], median: +c[ix.median], min: +c[ix.min], max: +c[ix.max] });
    }
  }
  for (const a of by.values()) a.sort((x, y) => x.date < y.date ? -1 : 1);
  return by;
}
export const name = id => (games[id]?.name || id).slice(0, 45);
export const dow = s => new Date(s + 'T00:00:00Z').getUTCDay(); // 0 dom, 6 sáb
export const DOW = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const dn = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;
export const median = a => { const b = [...a].sort((x, y) => x - y); const h = b.length >> 1; return b.length ? (b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2) : null; };
