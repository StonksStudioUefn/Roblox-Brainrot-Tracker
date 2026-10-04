import { loadSeries, dow, median } from './load.mjs';
const { flagEvents } = await import('/home/user/Roblox-Brainrot-Tracker/cloudflare/src/metrics.js');
const by = loadSeries(); let fire = 0, sus = 0, back = 0, we = 0;
for (const s0 of by.values()) {
  const s = s0.filter(r => r.date <= '2026-10-01'); const v = s.map(r => r.median), d = s.map(r => r.date);
  for (let i = 1; i < s.length - 3; i++) {
    if (d[i] < '2026-08-08') continue;
    const ev = flagEvents(v.slice(0, i + 1), d.slice(0, i + 1));
    const clean = []; for (let j = i - 1; j >= 0 && clean.length < 7; j--) if (!ev[j]) clean.push(v[j]);
    if (clean.length < 3) continue; const b = median(clean);
    if (v[i] < 1.8 * b) continue; fire++;
    const nx = median(v.slice(i + 1, i + 4));
    if (nx >= 1.6 * b) sus++; else if (nx < 1.25 * b) back++;
    if ([0,6].includes(dow(d[i]))) we++;
  }
}
console.log({ fire, sostenido: sus, vuelve: back, finde: we, pctSost: (100*sus/fire).toFixed(0), pctVuelve: (100*back/fire).toFixed(0) });
