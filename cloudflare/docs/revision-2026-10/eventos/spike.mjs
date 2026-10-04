// spike_now: simula "pico ahora" cada día con lo que se sabía ese día (serie hasta hoy).
// Régimen antiguo: 1 muestra de tarde/día ⇒ la mediana diaria ≈ valor de la tarde.
// Régimen horario: la mediana diaria de 24 h ≈ tarde / D (D = pico/mediana del día). La última muestra, en la tarde-noche.
import { loadSeries, dow, DOW, dn, median } from './load.mjs';
import { marketIndex } from './propuesta.mjs';
import { flagV3 } from './v3.mjs';
const { flagEvents } = await import('/home/user/Roblox-Brainrot-Tracker/cloudflare/src/metrics.js');
const END = '2026-10-01', FROM = '2026-08-08';
const by = loadSeries(), M = marketIndex(by, END);
const variants = {
  'actual, 1 muestra/día (D=1)': { D: 1 },
  'actual con horas, D=1.25': { D: 1.25 },
  'actual con horas, D=1.4': { D: 1.4 },
  'propuesta: mediana de máximos 7d + mismo día semana ×1.5': { D: 1, wd: 1.5 },
  'propuesta, pero ratio 1.6 + mismo día ×1.5': { D: 1, wd: 1.5, ratio: 1.6 },
};
const truthA = new Map(), truthB = new Map();
for (const [id, s0] of by) {
  const s = s0.filter(r => r.date <= END); if (s.length < 3) continue;
  const v = s.map(r => r.median), d = s.map(r => r.date);
  truthA.set(id, flagEvents(v, d)); truthB.set(id, flagV3(v, d, M, { agg: 'med', excl: true, mPow: 0.5 }));
}
for (const [k, o] of Object.entries(variants)) {
  let tot = 0, fire = 0, we = 0, hitA = 0, hitB = 0, evA = 0, evB = 0, recA = 0, recB = 0;
  const byd = new Array(7).fill(0), totd = new Array(7).fill(0);
  for (const [id, s0] of by) {
    const s = s0.filter(r => r.date <= END); if (s.length < 3) continue;
    const v = s.map(r => r.median), d = s.map(r => r.date), TA = truthA.get(id), TB = truthB.get(id);
    for (let i = 1; i < s.length; i++) {
      if (d[i] < FROM || i === s.length - 1) continue; // el último no tiene "verdad" con retrospectiva
      const ev = flagEvents(v.slice(0, i + 1), d.slice(0, i + 1)); // lo que se sabía ese día
      const clean = []; for (let j = i - 1; j >= 0 && clean.length < 7; j--) if (!ev[j]) clean.push({ j, x: v[j] });
      if (clean.length < 3) continue;
      const base = median(clean.map(c => c.x)) / o.D;          // mediana diaria (de 24 h si D>1)
      let fires = v[i] >= base * (o.ratio || 1.8);
      if (fires && o.wd) {
        const t = dn(d[i]); const rs = [];
        for (const c of clean) if ((t - dn(d[c.j])) % 7 === 0) rs.push(c.x);
        for (let k = 1; k <= 3 && !rs.length; k++) { const j = d.indexOf(new Date((t - 7 * k) * 864e5).toISOString().slice(0, 10)); if (j >= 0) rs.push(v[j]); }
        if (rs.length && v[i] < o.wd * median(rs)) fires = false;
      }
      tot++; totd[dow(d[i])]++;
      if (TA[i]) evA++; if (TB[i]) evB++;
      if (fires) { fire++; byd[dow(d[i])]++; if ([0, 6].includes(dow(d[i]))) we++; if (TA[i]) hitA++; if (TB[i]) hitB++; }
    }
  }
  console.log(`${k.padEnd(58)} salta ${(100 * fire / tot).toFixed(2)} % (${fire}/${tot})  sáb ${(100 * byd[6] / totd[6]).toFixed(1)} % dom ${(100 * byd[0] / totd[0]).toFixed(1)} % lab ${(100 * [1, 2, 3, 4, 5].reduce((a, j) => a + byd[j], 0) / [1, 2, 3, 4, 5].reduce((a, j) => a + totd[j], 0)).toFixed(1)} %  | precisión vs evento(actual) ${(100 * hitA / Math.max(fire, 1)).toFixed(0)} %, v3 ${(100 * hitB / Math.max(fire, 1)).toFixed(0)} % | cobertura actual ${(100 * hitA / evA).toFixed(0)} %, v3 ${(100 * hitB / evB).toFixed(0)} %`);
}
