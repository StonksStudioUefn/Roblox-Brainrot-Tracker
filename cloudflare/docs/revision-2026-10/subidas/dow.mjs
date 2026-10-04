// Efecto día de la semana (datos de ~1 muestra/día, 15/05–01/10/2026)
import { load, dow, DOWN, iso, median, q, mean, pc } from './load.mjs';
import { flagEvents } from './src/metrics.js';
const games = load();
const out = [];
const log = (...a) => { console.log(...a); out.push(a.join(' ')); };

// Días de evento por juego (sobre toda su serie)
for (const g of games.values()) {
  const vals = g.days.map(d => g.rows.get(d).med);
  const fl = flagEvents(vals, g.days.map(iso));
  g.ev = new Set(g.days.filter((d, i) => fl[i]));
}

// 1) Semanas ISO completas (lun–dom, 7 días, sin evento): v / media de la semana
const sizeB = m => m < 1000 ? '<1k' : m < 10000 ? '1k-10k' : m < 100000 ? '10k-100k' : '≥100k';
const R = Array.from({ length: 7 }, () => []);
const RB = {};
let weeks = 0;
const gameIdx = new Map();
for (const g of games.values()) {
  const mondays = new Set(g.days.filter(d => dow(d) === 0));
  for (const m of mondays) {
    const vs = [];
    for (let k = 0; k < 7; k++) { const r = g.rows.get(m + k); if (!r || g.ev.has(m + k)) break; vs.push(r.med); }
    if (vs.length < 7) continue;
    const mu = mean(vs); weeks++;
    const b = sizeB(mu);
    RB[b] ??= Array.from({ length: 7 }, () => []);
    vs.forEach((v, k) => { R[k].push(v / mu); RB[b][k].push(v / mu); });
    let gi = gameIdx.get(g.id); if (!gi) gameIdx.set(g.id, gi = Array.from({ length: 7 }, () => []));
    vs.forEach((v, k) => gi[k].push(v / mu));
  }
}
log(`## Índice día de la semana: v / media de su semana (lun–dom), ${weeks} semanas-juego completas sin eventos`);
log('día | mediana | p10 | p25 | p75 | p90');
R.forEach((a, k) => log(`${DOWN[k]} | ${median(a).toFixed(3)} | ${q(a, .1).toFixed(3)} | ${q(a, .25).toFixed(3)} | ${q(a, .75).toFixed(3)} | ${q(a, .9).toFixed(3)}`));
log('\n### Por tamaño (mediana por día; n semanas)');
for (const b of ['<1k', '1k-10k', '10k-100k', '≥100k']) if (RB[b]) log(`${b} (${RB[b][0].length}): ` + RB[b].map((a, k) => `${DOWN[k]} ${median(a).toFixed(3)}`).join(' · '));

// Índice por juego: ¿varía entre juegos? (juegos con ≥ 6 semanas)
const amp = [];
for (const [id, gi] of gameIdx) if (gi[0].length >= 6) { const idx = gi.map(median); amp.push([id, idx[5] / idx[0], idx]); }
amp.sort((a, b) => a[1] - b[1]);
log(`\n### Índice por juego (≥ 6 semanas, ${amp.length} juegos): sábado/lunes de su índice`);
log(`p10 ${q(amp.map(x => x[1]), .1).toFixed(2)} · p25 ${q(amp.map(x => x[1]), .25).toFixed(2)} · mediana ${median(amp.map(x => x[1])).toFixed(2)} · p75 ${q(amp.map(x => x[1]), .75).toFixed(2)} · p90 ${q(amp.map(x => x[1]), .9).toFixed(2)}`);
for (const [id, r, idx] of [...amp.slice(0, 3), ...amp.slice(-4)]) log(`  ${games.get(id).name.slice(0, 40)}: sáb/lun ${r.toFixed(2)} [${idx.map(x => x.toFixed(2)).join(' ')}]`);

// 2) Pares de días consecutivos (sin eventos)
const pairs = { 'sáb/vie': [5, 4], 'dom/sáb': [6, 5], 'lun/dom': [0, 6], 'mar/lun': [1, 0], 'mié/mar': [2, 1], 'jue/mié': [3, 2], 'vie/jue': [4, 3] };
log('\n## Pares consecutivos (v día / v día anterior, sin eventos)');
log('par | n | mediana | p10 | p25 | p75 | p90 | % > +10 % | % < −7 %');
for (const [k, [a]] of Object.entries(pairs)) {
  const rs = [];
  for (const g of games.values()) for (const d of g.days) if (dow(d) === a && g.rows.has(d - 1) && !g.ev.has(d) && !g.ev.has(d - 1)) rs.push(g.rows.get(d).med / g.rows.get(d - 1).med);
  log(`${k} | ${rs.length} | ${median(rs).toFixed(3)} | ${q(rs, .1).toFixed(3)} | ${q(rs, .25).toFixed(3)} | ${q(rs, .75).toFixed(3)} | ${q(rs, .9).toFixed(3)} | ${(100 * rs.filter(x => x > 1.10).length / rs.length).toFixed(0)} % | ${(100 * rs.filter(x => x < 0.93).length / rs.length).toFixed(0)} %`);
}
// dom / lun siguiente
{
  const rs = [];
  for (const g of games.values()) for (const d of g.days) if (dow(d) === 6 && g.rows.has(d + 1) && !g.ev.has(d) && !g.ev.has(d + 1)) rs.push(g.rows.get(d).med / g.rows.get(d + 1).med);
  log(`dom/lun siguiente | ${rs.length} | ${median(rs).toFixed(3)} | p10 ${q(rs, .1).toFixed(3)} | p90 ${q(rs, .9).toFixed(3)}`);
}

// 3) Agregado: suma de jugadores de un panel fijo (juegos presentes todos los días 01/08–01/10)
const from = Math.min(...[...games.values()].flatMap(g => g.days.filter(d => iso(d) >= '2026-08-01')));
const to = Math.max(...[...games.values()].flatMap(g => g.days));
const panel = [...games.values()].filter(g => { for (let d = from; d <= to; d++) if (!g.rows.has(d)) return false; return true; });
const tot = []; for (let d = from; d <= to; d++) tot.push([d, panel.reduce((s, g) => s + g.rows.get(d).med, 0)]);
const agg = Array.from({ length: 7 }, () => []);
for (let i = 3; i < tot.length - 3; i++) { const c = mean(tot.slice(i - 3, i + 4).map(x => x[1])); agg[dow(tot[i][0])].push(tot[i][1] / c); }
log(`\n## Agregado: panel de ${panel.length} juegos presentes cada día ${iso(from)}–${iso(to)}; total / media móvil centrada de 7 días`);
log(agg.map((a, k) => `${DOWN[k]} ${median(a).toFixed(3)}`).join(' · '));
// también el nº de juegos ≥ 300 seguidos por día (lo que se ve en los CSV)
const cnt = Array.from({ length: 7 }, () => []);
const byDay = new Map(); for (const g of games.values()) for (const d of g.days) if (iso(d) >= '2026-08-01') byDay.set(d, (byDay.get(d) || 0) + 1);
for (const [d, c] of byDay) cnt[dow(d)].push(c);
log('Juegos en el CSV por día (mediana 01/08–01/10): ' + cnt.map((a, k) => `${DOWN[k]} ${median(a)}`).join(' · '));

// Índice global para reutilizar
const IDX = R.map(median); const s = mean(IDX);
fs.writeFileSync(new URL('./idx.json', import.meta.url), JSON.stringify({ global: IDX.map(x => x / s), bySize: Object.fromEntries(Object.entries(RB).map(([b, a]) => { const m = a.map(median), mm = mean(m); return [b, m.map(x => x / mm)]; })) }, null, 1));
fs.writeFileSync(new URL('./dow.txt', import.meta.url), out.join('\n'));
import fs from 'node:fs';
