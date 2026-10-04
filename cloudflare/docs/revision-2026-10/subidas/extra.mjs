import fs from 'node:fs';
import { load, dow, DOWN, iso, dn, median, q, mean, pc } from './load.mjs';
const res = JSON.parse(fs.readFileSync('res-base.json'));
const games = load();
const idx = JSON.parse(fs.readFileSync('idx.json'));
const L = []; const log = (...a) => { console.log(...a); L.push(a.join(' ')); };
// 1) Sesgo teórico de growth_7d y de la tendencia en una serie plana con solo el efecto semana
for (const [name, I] of [['global', idx.global], ['septiembre', idx.sep]]) {
  const g7 = [], ts = [];
  for (let e = 0; e < 7; e++) {           // e = día de la semana del último día
    const v = k => I[((e - (k - 1)) % 7 + 7) % 7];   // k = 1 último día
    const r3 = mean([1, 2, 3].map(v)), w = mean([7, 8, 9, 10].map(v));
    g7.push(r3 / w - 1);
    const xs = [], ys = []; for (let k = 8; k >= 1; k--) { xs.push(8 - k); ys.push(Math.log(v(k))); }
    const sl = []; for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) sl.push((ys[b] - ys[a]) / (xs[b] - xs[a]));
    ts.push(Math.exp(median(sl)) - 1);
    if (e === 6 && name === 'septiembre') {}
  }
  log(`Serie plana con índice ${name}: growth_7d por día del último dato: ` + g7.map((x, k) => `${DOWN[k]} ${pc(x)}`).join(' · '));
  log(`   tendencia (Theil–Sen 8 d) %/día: ` + ts.map((x, k) => `${DOWN[k]} ${pc(x)}`).join(' · '));
  const g24 = I.map((x, k) => x / I[(k + 6) % 7] - 1);
  log(`   24 h (día vs día anterior): ` + g24.map((x, k) => `${DOWN[k]} ${pc(x)}`).join(' · '));
}
// 2) Sesgo empírico emparejado growth_7d − WoW
log('\nSesgo empírico emparejado (growth_7d − WoW, puntos %), mediana por día: ' + DOWN.map((n, k) => {
  const a = res.filter(r => dow(r.d) === k && r.g7 != null && r.wow != null).map(r => r.g7 - 100 * r.wow); return `${n} ${median(a).toFixed(1)}`; }).join(' · '));
// septiembre solo
log('   solo septiembre: ' + DOWN.map((n, k) => {
  const a = res.filter(r => dow(r.d) === k && iso(r.d) >= '2026-09-01' && r.g7 != null && r.wow != null).map(r => r.g7 - 100 * r.wow); return `${n} ${median(a).toFixed(1)}`; }).join(' · '));
log('   status actual "subiendo" en septiembre por día: ' + DOWN.map((n, k) => { const a = res.filter(r => dow(r.d) === k && iso(r.d) >= '2026-09-01'); return `${n} ${(100 * a.filter(r => r.cur === 'up' || r.cur === 'hot').length / a.length).toFixed(0)} %`; }).join(' · '));
log('   status actual "bajando" en septiembre por día: ' + DOWN.map((n, k) => { const a = res.filter(r => dow(r.d) === k && iso(r.d) >= '2026-09-01'); return `${n} ${(100 * a.filter(r => r.cur === 'down' || r.cur === 'down2').length / a.length).toFixed(0)} %`; }).join(' · '));
log('   propuesta "subiendo" en septiembre por día: ' + DOWN.map((n, k) => { const a = res.filter(r => dow(r.d) === k && iso(r.d) >= '2026-09-01'); return `${n} ${(100 * a.filter(r => r.prop === 'up' || r.prop === 'hot').length / a.length).toFixed(0)} %`; }).join(' · '));

// 3) Subconjunto comparable (la propuesta no da 'new')
const sub = res.filter(r => r.prop !== 'new');
const key2 = new Map(sub.map(r => [r.id + ':' + r.d, r]));
for (const k of ['cur', 'prop']) {
  let ch = 0, n = 0; for (const r of sub) { const p = key2.get(r.id + ':' + (r.d - 1)); if (!p) continue; n++; if (p[k] !== r[k]) ch++; }
  log(`Subconjunto sin 'new' (${sub.length}): cambios de estado ${k}: ${(100 * ch / n).toFixed(1)} % de los días`);
}
// 'new' de la propuesta: cuántos días de historia
const nw = res.filter(r => r.prop === 'new');
log(`Propuesta 'new': ${nw.length} juego-días; status actual en ellos: ` + Object.entries(nw.reduce((o, r) => (o[r.cur] = (o[r.cur] || 0) + 1, o), {})).map(([a, b]) => `${a} ${b}`).join(' · '));

// 4) Ruido semana a semana por tamaño: |WoW| en juegos con real (semana siguiente) cerca de 0
const sz = t => t < 1000 ? '<1k' : t < 10000 ? '1k-10k' : t < 100000 ? '10k-100k' : '≥100k';
const by = {}; for (const r of res) if (r.wow != null) (by[sz(r.typ)] ??= []).push(Math.abs(Math.log1p(r.wow)));
log('\n|ln(1+WoW)| por tamaño (p50 / p75 / p90): ' + Object.entries(by).map(([k, a]) => `${k} ${(100 * (Math.exp(median(a)) - 1)).toFixed(0)}/${(100 * (Math.exp(q(a, .75)) - 1)).toFixed(0)}/${(100 * (Math.exp(q(a, .9)) - 1)).toFixed(0)} % (n=${a.length})`).join(' · '));
const byd = {}; for (const r of res) if (r.g24 != null) (byd[sz(r.typ)] ??= []).push(Math.abs(Math.log1p(r.g24 / 100)));
log('|ln(1+24h)| por tamaño (p50 / p75 / p90): ' + Object.entries(byd).map(([k, a]) => `${k} ${(100 * (Math.exp(median(a)) - 1)).toFixed(0)}/${(100 * (Math.exp(q(a, .75)) - 1)).toFixed(0)}/${(100 * (Math.exp(q(a, .9)) - 1)).toFixed(0)} %`).join(' · '));

// 5) Informe semanal de los domingos: top 5 por growth_7d vs WoW
for (const day of ['2026-09-13', '2026-09-20']) {
  const a = res.filter(r => iso(r.d) === day && r.typ >= 300);
  const nm = id => games.get(id).name.replace(/\s+/g, ' ').slice(0, 34);
  const top = [...a].filter(r => r.g7 != null).sort((x, y) => y.g7 - x.g7).slice(0, 5);
  const topW = [...a].filter(r => r.wow != null).sort((x, y) => y.wow - x.wow).slice(0, 5);
  log(`\nDomingo ${day} — top 5 actual (growth_7d): ` + top.map(r => `${nm(r.id)} 7d ${r.g7}% (WoW ${pc(r.wow)}, real sig. ${pc(r.real)})`).join(' | '));
  log(`   top 5 WoW: ` + topW.map(r => `${nm(r.id)} WoW ${pc(r.wow)} (7d ${r.g7}%, real ${pc(r.real)})`).join(' | '));
  const st = a.filter(r => r.g7 != null && r.wow != null);
  log(`   juegos con 7d > 0: ${st.filter(r => r.g7 > 0).length}/${st.length}; con WoW > 0: ${st.filter(r => r.wow > 0).length}; signo distinto: ${st.filter(r => (r.g7 > 0) !== (r.wow > 0)).length}`);
}
fs.writeFileSync('extra.txt', L.join('\n'));
