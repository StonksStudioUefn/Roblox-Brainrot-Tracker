import { series, raw, dashboard, nextWeek, addDays, dow, DOW, nameOf, meanRange } from './lib.mjs';
// 1) efecto fin de semana: mediana del cambio día a día por día de la semana
const byDow = Array.from({length:7},()=>[]);
for (const [id,m] of series) for (const [dt,r] of m) {
  if (dt < '2026-06-01' || dt > '2026-10-01') continue;
  const p = m.get(addDays(dt,-1)); if (p && p[1]>=300 && r[1]>=300) byDow[dow(dt)].push(r[1]/p[1]-1);
}
const med = a => { a=a.slice().sort((x,y)=>x-y); return a[a.length>>1]; };
console.log('cambio d/d mediano por día:', byDow.map((a,i)=>`${DOW[i]} ${(med(a)*100).toFixed(1)}% (n=${a.length}, >+10%: ${(a.filter(x=>x>0.1).length/a.length*100).toFixed(0)}%)`).join(' | '));
// huecos en las series
let gaps=0, tot=0;
for (const [id,m] of series){ const ds=[...m.keys()].sort(); for(let i=1;i<ds.length;i++){tot++; if(addDays(ds[i-1],1)!==ds[i]) gaps++;}}
console.log('pares consecutivos con hueco', gaps, 'de', tot);
// hora de la muestra: dispersion por juego
let sp=[]; for (const [id,a] of raw){ const hs=a.filter(r=>r[0]<Date.parse('2026-10-02')/60000).map(r=>(r[0]%1440)/60); if(hs.length>10){ sp.push(Math.max(...hs)-Math.min(...hs)); } }
console.log('rango de hora de muestra por juego (h): mediana', med(sp).toFixed(1), 'max', Math.max(...sp).toFixed(1));
