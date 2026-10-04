// Por fecha: mediana entre juegos de v / mediana(±3 días del mismo juego). Detecta días "raros" de todo el catálogo
// (muestreo a otra hora, caída de la API, evento de Roblox) y el efecto del día de la semana.
import { loadSeries, dow, DOW, median } from './load.mjs';
const by = loadSeries();
const per = new Map();
const wd = Array.from({ length: 7 }, () => []);
for (const s0 of by.values()) {
  const s = s0.filter(r => r.date <= '2026-10-01');
  for (let i = 3; i < s.length - 3; i++) {
    const nb = s.slice(i - 3, i).concat(s.slice(i + 1, i + 4)).map(r => r.median);
    const r = s[i].median / median(nb);
    if (!per.has(s[i].date)) per.set(s[i].date, []);
    per.get(s[i].date).push(r);
  }
  // índice por día de semana: v / mediana de su semana (lun-dom, 7 filas consecutivas por fecha)
  for (let i = 0; i + 6 < s.length; i++) {
    if (dow(s[i].date) !== 1) continue;
    const w = s.slice(i, i + 7);
    const d0 = new Date(s[i].date + 'T00:00Z').getTime();
    if (new Date(w[6].date + 'T00:00Z').getTime() - d0 !== 6 * 864e5) continue;
    const m = median(w.map(r => r.median));
    w.forEach(r => wd[dow(r.date)].push(r.median / m));
  }
}
const rows = [...per].sort().filter(([d]) => d >= '2026-08-01');
for (const [d, a] of rows) {
  const m = median(a), hi = a.filter(x => x >= 1.6).length;
  if (m > 1.12 || m < 0.9 || hi / a.length > 0.05) console.log(d, DOW[dow(d)], 'mediana', m.toFixed(2), '≥1.6x:', hi, '/', a.length);
}
console.log('índice día de semana (v / mediana de su semana), mediana y p90 entre juego-semanas:');
for (const k of [1, 2, 3, 4, 5, 6, 0]) { const a = wd[k].sort((x, y) => x - y); console.log(DOW[k], median(a).toFixed(2), 'p90', a[Math.floor(a.length * 0.9)].toFixed(2), 'n', a.length); }
