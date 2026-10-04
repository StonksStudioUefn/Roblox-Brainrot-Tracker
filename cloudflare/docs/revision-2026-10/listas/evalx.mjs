import { series, nextWeek, addDays, dow, DOW, nameOf, exportGame } from './lib.mjs';
// universo de un día: juegos con fila en D y ≥300 jugadores; para emergentes, ≤30M visitas
export function universe(D, emOnly) {
  const u = [];
  for (const [id, m] of series) {
    const r = m.get(D); if (!r || r[1] < 300) continue;
    if (emOnly) { const v = [...m.values()].filter(x => x[0] <= D && x[5]).pop(); if (v && v[5] > 30e6) continue; }
    u.push(id);
  }
  return u;
}
export function evaluate(lists, key, { from = '2026-08-15', to = '2026-09-24', big = 0.30, emOnly = false, weekdays = null } = {}) {
  let n = 0, up0 = 0, up10 = 0, sumG = 0, cand = 0, hit = 0, days = 0;
  const flagged = [];
  for (let D = from; D <= to; D = addDays(D, 1)) {
    if (weekdays && !weekdays.includes(dow(D))) continue;
    const L = new Set(lists[D][key]); days++;
    for (const id of L) { const g = nextWeek(id, D); if (g == null) continue; n++; sumG += g; if (g > 0) up0++; if (g > 0.10) up10++; flagged.push([D, id, g]); }
    for (const id of universe(D, emOnly)) { const g = nextWeek(id, D); if (g != null && g >= big) { cand++; if (L.has(id)) hit++; } }
  }
  return { days, perDay: +(n / days).toFixed(1), prec0: +(up0 / n * 100).toFixed(0), prec10: +(up10 / n * 100).toFixed(0),
    meanNext: +(sumG / n * 100).toFixed(1), bigGrowers: cand, recall: +(hit / cand * 100).toFixed(0), flagged };
}
// entra sábado o domingo (no estaba el viernes) y sale el lunes
export function weekendChurn(lists, key, { from = '2026-08-08', to = '2026-09-27' } = {}) {
  let entered = 0, outMon = 0, weekends = 0; const ex = [];
  for (let D = from; D <= to; D = addDays(D, 1)) {
    if (dow(D) !== 6) continue;
    const fri = new Set(lists[addDays(D, -1)]?.[key] || []), mon = new Set(lists[addDays(D, 2)]?.[key] || []);
    if (!lists[addDays(D, 2)]) continue; weekends++;
    const ent = new Set([...lists[D][key], ...lists[addDays(D, 1)][key]].filter(i => !fri.has(i)));
    entered += ent.size;
    for (const i of ent) if (!mon.has(i)) { outMon++; ex.push([D, i]); }
  }
  return { weekends, enteredPerWeekend: +(entered / weekends).toFixed(1), outMonday: outMon, pctOut: +(outMon / entered * 100).toFixed(0), ex };
}
// cuántos entran cada día (no estaban la víspera), por día de la semana
export function entriesByDow(lists, key, { from = '2026-08-08', to = '2026-10-01' } = {}) {
  const e = Array(7).fill(0), c = Array(7).fill(0);
  for (let D = addDays(from, 1); D <= to; D = addDays(D, 1)) {
    const prev = new Set(lists[addDays(D, -1)][key]);
    e[dow(D)] += lists[D][key].filter(i => !prev.has(i)).length; c[dow(D)]++;
  }
  return e.map((x, i) => `${DOW[i]} ${(x / c[i]).toFixed(1)}`).join(' ');
}
