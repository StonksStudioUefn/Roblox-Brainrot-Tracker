// Mide la CPU del filtro de Rolimons (texto vs JSON.parse) con process.cpuUsage.
// Uso: node test/bench_rolimons.mjs [fichero]   (sin fichero lo descarga)
import { readFileSync } from "node:fs";
import { filterRolimons, filterRolimonsParse } from "../src/sources.js";

const file = process.argv[2];
const text = file ? readFileSync(file, "utf8")
  : await (await fetch("https://api.rolimons.com/games/v1/gamelist")).text();

function cpu(fn, reps = 50) {
  for (let i = 0; i < 5; i++) fn();           // calentamiento (JIT)
  const t = process.cpuUsage();
  for (let i = 0; i < reps; i++) fn();
  const d = process.cpuUsage(t);
  return (d.user + d.system) / 1000 / reps;
}
function cold(fn) { const t = process.cpuUsage(); const r = fn(); const d = process.cpuUsage(t); return [(d.user + d.system) / 1000, r]; }

const [c1, a] = cold(() => filterRolimons(text, 300));
const [c2, b] = cold(() => filterRolimonsParse(text, 300));
const same = a.length === b.length && a.every((x, i) => x[0] === b[i][0] && x[1] === b[i][1] && x[2] === b[i][2]);
console.log(`bytes=${text.length} filtrados=${a.length} iguales=${same}`);
console.log(`primera llamada (sin JIT): escaneo ${c1.toFixed(2)} ms · JSON.parse ${c2.toFixed(2)} ms`);
console.log(`media en caliente: escaneo ${cpu(() => filterRolimons(text, 300)).toFixed(2)} ms · JSON.parse ${cpu(() => filterRolimonsParse(text, 300)).toFixed(2)} ms`);
