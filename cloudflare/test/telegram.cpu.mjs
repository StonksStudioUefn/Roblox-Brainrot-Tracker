/**
 * telegram.cpu.mjs — CPU de un paso de Telegram en un proceso NUEVO (JIT frío,
 * como una invocación del Workflow) y, después, en caliente.
 *
 *   node cloudflare/test/telegram.cpu.mjs <export.json> <now ISO> [--json] [--future]
 *
 * --future: alarga la serie diaria de cada juego a 21 días (valores sintéticos
 * alrededor del primero, con algún pico), como estará el export dentro de tres
 * semanas; hoy casi todos los juegos tienen 2–3 días y el cálculo es más barato.
 *
 * Fases: JSON.parse del export completo · telegramCandidates (prefiltro +
 * cabeceras) · JSON del export reducido (lo que pasaría entre dos pasos) ·
 * buildDashboard de los candidatos · runTelegram completo con el reducido
 * (diario + semanal forzados, sin credenciales, sin red).
 */
import { readFileSync } from "node:fs";

const [file, now] = process.argv.slice(2);
let text = readFileSync(file, "utf8");
if (process.argv.includes("--future")) text = JSON.stringify(future(JSON.parse(text)));

function future(ex) {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (const g of ex.games) {
    const d = g.d;
    if (!d.length) continue;
    const first = d[0];
    let day = Date.parse(first[0] + "T00:00:00Z");
    while (d.length < 21) {
      day -= 864e5;
      const spike = rnd() < 0.05 ? 2.5 : 1;
      const v = Math.max(1, Math.round(first[1] * (0.8 + 0.4 * rnd()) * spike));
      d.unshift([new Date(day).toISOString().slice(0, 10), v, Math.round(v * 0.8), Math.round(v * 1.2), 8,
        first[5] ? Math.round(first[5] * (1 - 0.01 * d.length)) : null]);
    }
  }
  return ex;
}
globalThis.fetch = () => { throw new Error("red prohibida"); };

const cpu = fn => {
  const t0 = process.cpuUsage();
  const r = fn();
  const t = process.cpuUsage(t0);
  return [r, (t.user + t.system) / 1000];
};
const cpuAsync = async fn => {
  const t0 = process.cpuUsage();
  const r = await fn();
  const t = process.cpuUsage(t0);
  return [r, (t.user + t.system) / 1000];
};

// Los módulos se cargan antes de medir (en el Worker ya están cargados)
const { telegramCandidates, runTelegram, telegramScanText, telegramReduce } = await import("../src/telegram.js");
const { buildDashboard } = await import("../src/metrics.js");

const PARTS = Number((process.argv.find(a => a.startsWith("--parts=")) || "--parts=4").slice(8));
const out = { cold: {}, warm: {} };
async function round(dst) {
  const [full, tParse] = cpu(() => JSON.parse(text));
  const [reduced, tCand] = cpu(() => telegramCandidates(full, { now }));
  const [redText, tStr] = cpu(() => JSON.stringify(reduced));
  const [red2, tParse2] = cpu(() => JSON.parse(redText));
  const [, tBuild] = cpu(() => buildDashboard(red2, { now }));
  const [res, tRun] = await cpuAsync(() => runTelegram({
    env: {}, exportData: JSON.parse(redText), now, force: "daily",
    getState: async () => ({ alerted: {} }), setState: async () => {}, log: () => {},
  }));
  // Repartido en PARTS pasos + 1 (cada uno con el texto del export ya leído de R2)
  const scans = [], tScan = [];
  for (let k = 0; k < PARTS; k++) {
    const [rows, tk] = cpu(() => JSON.parse(JSON.stringify(telegramScanText(text, { now, part: k, parts: PARTS }))));
    scans.push(rows); tScan.push(+tk.toFixed(2));
  }
  const [, tRed] = cpu(() => JSON.stringify(telegramReduce(text, scans)));
  Object.assign(dst, {
    [`scan_steps_ms(${PARTS})`]: tScan, reduce_step_ms: +tRed.toFixed(2),
    games: full.games.length, candidates: reduced.games.length, reduced_bytes: redText.length,
    parse_full_ms: +tParse.toFixed(2), candidates_ms: +tCand.toFixed(2),
    stringify_reduced_ms: +tStr.toFixed(2), parse_reduced_ms: +tParse2.toFixed(2),
    build_reduced_ms: +tBuild.toFixed(2), run_telegram_reduced_ms: +tRun.toFixed(2), messages: res.messages,
  });
}
await round(out.cold);
for (let i = 0; i < 30; i++) await round(out.warm);
console.log(process.argv.includes("--json") ? JSON.stringify(out) : out);
