import { series, games, nameOf } from './lib.mjs';
const want = process.argv.slice(2);
for (const [id, m] of series) { const n = nameOf(id); if (!want.some(w => n.toLowerCase().includes(w.toLowerCase()))) continue;
  console.log(id, n, games[id]?.created?.slice(0,10)); console.log('  ' + [...m.values()].filter(r => r[0] >= '2026-08-25' && r[0] <= '2026-10-01').map(r => r[0].slice(5) + ':' + r[1]).join(' ')); }
