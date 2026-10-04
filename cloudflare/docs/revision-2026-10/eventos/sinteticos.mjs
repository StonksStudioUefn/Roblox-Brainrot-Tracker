const { flagEvents } = await import('/home/user/Roblox-Brainrot-Tracker/cloudflare/src/metrics.js');
const dates = n => Array.from({length:n},(_,i)=>new Date(Date.UTC(2026,8,1+i)).toISOString().slice(0,10)); // 2026-09-01 = martes
const run = (t, v, d=dates(v.length)) => { const f=flagEvents(v,d); console.log(t.padEnd(38), v.map((x,i)=>f[i]?`[${x}]`:x).join(' ')); };
const B=1000;
run('pico 1 día (centro)', [B,B,B,B,B,4*B,B,B,B,B]);
run('pico 2 días', [B,B,B,B,B,4*B,4*B,B,B,B]);
run('pico 3 días', [B,B,B,B,B,4*B,4*B,4*B,B,B,B]);
run('pico en el penúltimo día', [B,B,B,B,B,B,B,4*B,B]);
run('pico 2 días al final', [B,B,B,B,B,B,B,4*B,4*B]);
run('pico en el 3er día', [B,B,4*B,B,B,B,B]);
run('pico en el 2º día', [B,4*B,B,B,B,B,B]);
run('escalón x3', [B,B,B,B,B,3*B,3*B,3*B,3*B,3*B]);
run('escalón x3 que se cae a x2', [B,B,B,B,B,3*B,2*B,2*B,2*B,2*B]);
run('crece 30%/día', Array.from({length:10},(_,i)=>Math.round(B*1.3**i)));
run('crece 60%/día', Array.from({length:10},(_,i)=>Math.round(B*1.6**i)));
run('vecinos a 0 (huecos guardados como 0)', [B,0,0,0,500,0,0,0,B]);
run('pico tras otro igual 7 días antes', [B,B,B,B,B,4*B,B,B,B,B,B,B,4*B,B,B,B]);
run('pico tras otro 14 días antes', [B,B,B,4*B,B,B,B,B,B,B,B,B,B,B,B,B,B,4*B,B,B]);
// juego en caída: hace 14 días 10k, hoy 2k con pico 5k
run('caída + pico (mismo día -14 alto)', [10000,9000,8000,7000,6000,5500,5000,4500,4000,3500,3000,2500,2200,2000,2000,5000,2000,2000]);
// huecos: fechas no consecutivas
run('huecos: meses entre vecinos', [3000,2800,9000,15000,10000,6000,4400], ['2026-05-27','2026-06-21','2026-09-18','2026-09-19','2026-09-20','2026-09-21','2026-09-22']);
