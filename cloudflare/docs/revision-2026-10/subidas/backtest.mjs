// Backtest: estado actual (metrics.js tal cual) vs propuesta semanal.
// Cada juego, cada día D con fila: export simulado con las 24 últimas filas ≤ D, sin muestras
// (antes del 03/10 había ~1 muestra/día: growth_24h = último día vs último día limpio anterior).
import fs from 'node:fs';
import { load, dow, DOWN, iso, dn, median, q, mean, pc } from './load.mjs';
import { _gameMetrics, _status, flagEvents } from './src/metrics.js';
import { proposal, rollingIndex } from './proposal.mjs';

const VARIANT = process.argv[2] || 'base';
const games = load();
const out = []; const log = (...a) => { console.log(...a); out.push(a.join(' ')); };
const START = dn('2026-06-01'), END = dn('2026-09-24');   // D+7 ≤ 01/10 para la verificación
const idxAt = rollingIndex(games);                         // índice día-semana con datos anteriores a D

const res = [];   // { id, d, cur, g7, g24, trend, prop, wow, real }
for (const g of games.values()) {
  const all = g.days;
  const vals = all.map(d => g.rows.get(d).med);
  const flAll = flagEvents(vals, all.map(iso));  // solo para la verificación "real"
  const evAll = new Set(all.filter((d, i) => flAll[i]));
  for (let j = 0; j < all.length; j++) {
    const D = all[j];
    if (D < START || D > END) continue;
    const rows = all.slice(Math.max(0, j - 23), j + 1).map(d => { const r = g.rows.get(d); return [iso(d), r.med, r.min, r.max, r.n, null]; });
    const nowUs = (D * 864e5 + 86399e3) * 1000;
    const ctx = { nowUs, nowMin: nowUs / 60e6, today: D, todayIso: iso(D), scanStart: dn('2026-10-02') };
    const m = _gameMetrics({ id: g.id, d: rows, s: [] }, ctx);
    const cur = _status(m);
    // Propuesta: misma información + 35 filas (para 4 semanas)
    const rows35 = all.slice(Math.max(0, j - 34), j + 1).map(d => [d, g.rows.get(d).med]);
    const p = proposal(rows35, D, idxAt(D), VARIANT);
    // Verificación (con el futuro): semana D+1..D+7 frente a D-13..D-7, desestacionalizado, sin eventos
    const I = idxAt(D);
    const wk = (a, b) => { const x = []; for (let d = a; d <= b; d++) { const r = g.rows.get(d); if (r && !evAll.has(d)) x.push(r.med / I[dow(d)]); } return x.length >= 5 ? mean(x) : null; };
    const fut = wk(D + 1, D + 7), base = wk(D - 13, D - 7);
    res.push({ id: g.id, d: D, cur, g7: m.growth_7d, g24: m.growth_24h, trend: m.trend, prop: p.status, wow: p.wow, same: p.same, typ: p.typ, real: fut && base ? fut / base - 1 : null });
  }
}
const isUp = s => s === 'hot' || s === 'up', isDown = s => s === 'down' || s === 'down2';
log(`# Backtest ${iso(START)}–${iso(END)} · variante ${VARIANT} · ${res.length} juego-días · ${new Set(res.map(r => r.id)).size} juegos`);

for (const key of ['cur', 'prop']) {
  log(`\n## ${key === 'cur' ? 'ACTUAL (status de metrics.js)' : 'PROPUESTA'}`);
  const st = {}; for (const r of res) st[r[key]] = (st[r[key]] || 0) + 1;
  log('Reparto: ' + Object.entries(st).map(([k, v]) => `${k} ${(100 * v / res.length).toFixed(1)} %`).join(' · '));
  log('% subiendo (hot+up) por día: ' + DOWN.map((n, k) => { const a = res.filter(r => dow(r.d) === k); return `${n} ${(100 * a.filter(r => isUp(r[key])).length / a.length).toFixed(0)}`; }).join(' · '));
  log('% bajando (down+down2) por día: ' + DOWN.map((n, k) => { const a = res.filter(r => dow(r.d) === k); return `${n} ${(100 * a.filter(r => isDown(r[key])).length / a.length).toFixed(0)}`; }).join(' · '));
  // Cambios de estado (día D con D-1 en la tabla)
  const prev = new Map(res.map(r => [r.id + ':' + r.d, r]));
  const toUp = Array(7).fill(0), toDown = Array(7).fill(0), base = Array(7).fill(0);
  let changes = 0, pairs = 0, flipUp = 0, enterUp = 0, flipDown = 0, enterDown = 0;
  for (const r of res) {
    const p = prev.get(r.id + ':' + (r.d - 1)); if (!p) continue;
    pairs++; base[dow(r.d)]++;
    if (p[key] !== r[key]) changes++;
    if (!isUp(p[key]) && isUp(r[key])) {
      toUp[dow(r.d)]++; enterUp++;
      // ¿deja de subir en ≤ 3 días?
      for (let k = 1; k <= 3; k++) { const n = prev.get(r.id + ':' + (r.d + k)); if (n && !isUp(n[key])) { flipUp++; break; } }
    }
    if (!isDown(p[key]) && isDown(r[key])) {
      toDown[dow(r.d)]++; enterDown++;
      for (let k = 1; k <= 3; k++) { const n = prev.get(r.id + ':' + (r.d + k)); if (n && !isDown(n[key])) { flipDown++; break; } }
    }
  }
  log(`Cambios de estado: ${(100 * changes / pairs).toFixed(1)} % de los días (${(30 * changes / pairs).toFixed(1)} cambios por juego cada 30 días)`);
  log('Pasa a subiendo, por día (% de juego-días de ese día): ' + DOWN.map((n, k) => `${n} ${(100 * toUp[k] / base[k]).toFixed(1)}`).join(' · '));
  log('Pasa a bajando, por día: ' + DOWN.map((n, k) => `${n} ${(100 * toDown[k] / base[k]).toFixed(1)}`).join(' · '));
  const mid = k => [1, 2, 3].reduce((s, i) => s + toUp[i] / base[i], 0) / 3, midD = [1, 2, 3, 4].reduce((s, i) => s + toDown[i] / base[i], 0) / 4;
  const exUp = [5, 6].reduce((s, i) => s + Math.max(0, toUp[i] - mid() * base[i]), 0);
  const exDown = [0].reduce((s, i) => s + Math.max(0, toDown[i] - midD * base[i]), 0);
  log(`Exceso fin de semana → subiendo (sáb+dom sobre la media mar–jue): ${exUp.toFixed(0)} de ${toUp[5] + toUp[6]} (${(100 * exUp / (toUp[5] + toUp[6])).toFixed(0)} %) · exceso lunes → bajando (sobre mar–vie): ${exDown.toFixed(0)} de ${toDown[0]} (${(100 * exDown / toDown[0]).toFixed(0)} %)`);
  log(`Entradas en subiendo que se deshacen en ≤ 3 días: ${flipUp}/${enterUp} (${(100 * flipUp / enterUp).toFixed(0)} %) · en bajando: ${flipDown}/${enterDown} (${(100 * flipDown / enterDown).toFixed(0)} %)`);
  // Precisión frente a la semana siguiente
  const ups = res.filter(r => isUp(r[key]) && r.real !== null), downs = res.filter(r => isDown(r[key]) && r.real !== null);
  const flats = res.filter(r => r[key] === 'flat' && r.real !== null);
  log(`Verificación (semana D+1..D+7 vs D-13..D-7): subiendo con real ≥ +10 %: ${(100 * ups.filter(r => r.real >= .10).length / ups.length).toFixed(0)} %, con real ≤ 0: ${(100 * ups.filter(r => r.real <= 0).length / ups.length).toFixed(0)} % · bajando con real ≤ −10 %: ${(100 * downs.filter(r => r.real <= -.10).length / downs.length).toFixed(0)} %, con real ≥ 0: ${(100 * downs.filter(r => r.real >= 0).length / downs.length).toFixed(0)} %`);
  const realUp = res.filter(r => r.real !== null && r.real >= .25), realDown = res.filter(r => r.real !== null && r.real <= -.25);
  log(`Cobertura: de los juego-días con real ≥ +25 %, marcados subiendo ${(100 * realUp.filter(r => isUp(r[key])).length / realUp.length).toFixed(0)} %; con real ≤ −25 %, marcados bajando ${(100 * realDown.filter(r => isDown(r[key])).length / realDown.length).toFixed(0)} %`);
}

// Sesgo de growth_7d por día de la semana vs WoW
log('\n## growth_7d actual vs WoW propuesto: mediana por día de la semana de D');
log('día | growth_7d mediana | % > 0 | WoW mediana | % > 0 | 24h actual mediana | mismo día sem. pasada mediana');
for (let k = 0; k < 7; k++) {
  const a = res.filter(r => dow(r.d) === k);
  const g7 = a.map(r => r.g7).filter(x => x != null), w = a.map(r => r.wow).filter(x => x != null), g24 = a.map(r => r.g24).filter(x => x != null), sm = a.map(r => r.same).filter(x => x != null);
  log(`${DOWN[k]} | ${median(g7).toFixed(1)} % | ${(100 * g7.filter(x => x > 0).length / g7.length).toFixed(0)} % | ${(100 * median(w)).toFixed(1)} % | ${(100 * w.filter(x => x > 0).length / w.length).toFixed(0)} % | ${median(g24).toFixed(1)} % | ${(100 * median(sm)).toFixed(1)} %`);
}
const tr = Array.from({ length: 7 }, (_, k) => median(res.filter(r => dow(r.d) === k && r.trend != null).map(r => r.trend)));
log('Tendencia actual (Theil–Sen 8 días), mediana por día: ' + tr.map((x, k) => `${DOWN[k]} ${x.toFixed(1)}`).join(' · '));

fs.writeFileSync(`backtest-${VARIANT}.txt`, out.join('\n'));
fs.writeFileSync(`res-${VARIANT}.json`, JSON.stringify(res));
