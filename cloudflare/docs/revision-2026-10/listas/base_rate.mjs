import fs from 'node:fs';
import { universe } from './evalx.mjs';
import { nextWeek, addDays, nameOf, dow, DOW } from './lib.mjs';
for (const emOnly of [false, true]) {
  let n=0,u0=0,u10=0,b=0;
  for (let D='2026-08-15'; D<='2026-09-24'; D=addDays(D,1)) for (const id of universe(D, emOnly)) { const g=nextWeek(id,D); if(g==null) continue; n++; if(g>0)u0++; if(g>.1)u10++; if(g>=.3)b++; }
  console.log(emOnly?'≤30M':'todos', 'n/día', (n/41).toFixed(0), 'base >0', (u0/n*100).toFixed(0), '>10%', (u10/n*100).toFixed(0), 'grandes/día', (b/41).toFixed(1));
}
const B = JSON.parse(fs.readFileSync('baseline.json'));
for (const D of ['2026-09-06','2026-09-08','2026-09-13','2026-09-14','2026-09-17','2026-09-20']) {
  console.log('\n==', D, DOW[dow(D)]);
  for (const k of ['em','tr']) for (const id of B[D][k]) { const i=B[D].info[id]; const g=nextWeek(id,D);
    console.log(k, nameOf(id).padEnd(34), 'em',i[0],'mom',i[1],'t',i[2],'g24',i[3],'g7',i[4],'vg',i[5],i[6],'typ',i[7],'age',i[8],'→ sem.sig', g==null?'-':(g*100).toFixed(0)+'%'); }
}
