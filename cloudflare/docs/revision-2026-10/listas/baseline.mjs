import fs from 'node:fs';
import { series, dashboard, nextWeek, addDays, dow, DOW, nameOf } from './lib.mjs';
const out = {};
for (let D = '2026-08-08'; D <= '2026-10-01'; D = addDays(D, 1)) {
  const dash = dashboard(D);
  const c = dash.categories.general, h = dash.categories.horror;
  out[D] = { em: c.emerging.map(String), tr: c.trending.map(String), hem: h.emerging.map(String), htr: h.trending.map(String),
    al: c.emerging.filter(i => dash.games[i].emerging >= 70).map(String),
    info: Object.fromEntries(Object.entries(dash.games).map(([k, g]) => [k, [g.emerging, g.momentum, g.trend, g.growth_24h, g.growth_7d, g.visits_growth, g.status, g.typical, g.age_days, g.visits, g.spike_now, g.horror, g.fresh]])) };
}
fs.writeFileSync('baseline.json', JSON.stringify(out));
for (const D of Object.keys(out)) console.log(D, DOW[dow(D)], 'em', out[D].em.length, 'tr', out[D].tr.length, 'alert', out[D].al.length);
