/**
 * telegram.cpu.mjs — CPU del paso de Telegram, en procesos Node NUEVOS (JIT
 * frío, como un isolate recién arrancado) y en caliente.
 *
 *   node cloudflare/test/telegram.cpu.mjs <export.json> <now ISO> [--runs=5]
 *
 * Con el export completo dado se preparan dos exports REDUCIDOS (lo que será
 * data/telegram.json): el real (hoy casi todos los juegos tienen 2–3 días de
 * serie) y uno "en régimen" (serie alargada a 21 días con valores sintéticos y
 * algún pico, como estará en unas semanas). Para cada uno, en un proceso nuevo:
 *   paso telegram: JSON.parse del reducido + runTelegram (buildDashboard de los
 *     candidatos + mensajes), sin credenciales ni red. Tres casos: pasada sin
 *     nada que enviar (todo avisado: atajo sin buildDashboard), pasada con
 *     alertas posibles, y diario + semanal (dos runTelegram).
 * Y, aparte, el prefiltro de respaldo (telegramCandidates sobre el export
 * completo, con su JSON.parse), que es lo que costaría reducir en el Worker.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
const median = a => [...a].sort((x, y) => x - y)[a.length >> 1];

// ─── Hijo: una medida en frío y luego en caliente ─────────────────────────────
if (process.argv[2] === "--child") {
  const [mode, file, now] = process.argv.slice(3);
  globalThis.fetch = () => { throw new Error("red prohibida"); };
  const tg = await import("../src/telegram.js");   // módulos ya cargados, como en el Worker
  const text = readFileSync(file, "utf8");
  const quiet = { env: {}, now, setState: async () => {}, log: () => {} };
  const once = async () => {
    const c0 = cpu();
    const data = JSON.parse(text);
    const c1 = cpu();
    if (mode === "candidates") {
      tg.telegramCandidates(data, { now });
    } else if (mode === "quiet") {
      const alerted = Object.fromEntries(data.games.map(g => [String(g.id), "x"]));
      await tg.runTelegram({ ...quiet, exportData: data, getState: async () => ({ alerted, last_daily: now.slice(0, 10) }) });
    } else if (mode === "normal") {
      await tg.runTelegram({ ...quiet, exportData: data, getState: async () => ({ last_daily: now.slice(0, 10) }) });
    } else {
      await tg.runTelegram({ ...quiet, exportData: data, force: "daily", getState: async () => ({}) });
      await tg.runTelegram({ ...quiet, exportData: data, force: "weekly", getState: async () => ({ alerted: {} }) });
    }
    return [c1 - c0, cpu() - c1];
  };
  const cold = await once();
  const warm = [];
  for (let i = 0; i < 20; i++) warm.push((await once())[1]);
  console.log(JSON.stringify({ parse: cold[0], cold: cold[1], warm: median(warm) }));
  process.exit(0);
}

// ─── Padre ────────────────────────────────────────────────────────────────────
const [file, now] = process.argv.slice(2);
const runs = Number((process.argv.find(a => a.startsWith("--runs=")) || "--runs=5").slice(7));
const { telegramCandidates } = await import("../src/telegram.js");
const dir = mkdtempSync(join(tmpdir(), "tg-cpu-"));

function steady(ex) {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (const g of ex.games) {
    const d = g.d;
    if (!d.length) continue;
    const first = d[0];
    let day = Date.parse(first[0] + "T00:00:00Z");
    while (d.length < 21) {
      day -= 864e5;
      const v = Math.max(1, Math.round(first[1] * (0.8 + 0.4 * rnd()) * (rnd() < 0.05 ? 2.5 : 1)));
      d.unshift([new Date(day).toISOString().slice(0, 10), v, Math.round(v * 0.8), Math.round(v * 1.2), 8, null]);
    }
  }
  return ex;
}

const fullText = readFileSync(file, "utf8");
const sets = { real: JSON.parse(fullText), "en régimen": steady(JSON.parse(fullText)) };
for (const [name, ex] of Object.entries(sets)) {
  const fullPath = join(dir, `full-${name}.json`);
  writeFileSync(fullPath, JSON.stringify(ex));
  const red = telegramCandidates(ex, { now });
  const redPath = join(dir, `red-${name}.json`);
  writeFileSync(redPath, JSON.stringify(red));
  console.log(`\n${name}: ${ex.games.length} juegos → ${red.games.length} candidatos ` +
    `(${JSON.stringify(red).length.toLocaleString("es")} B)`);
  for (const [mode, path, label] of [
    ["quiet", redPath, "paso telegram, pasada sin nada que enviar (atajo)"],
    ["normal", redPath, "paso telegram, pasada con alertas posibles"],
    ["daily", redPath, "paso telegram, diario + semanal"],
    ["candidates", fullPath, "respaldo: export completo + telegramCandidates"],
  ]) {
    const rs = [];
    for (let i = 0; i < runs; i++) {
      const r = spawnSync(process.execPath, [SELF, "--child", mode, path, now], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(r.stderr);
      rs.push(JSON.parse(r.stdout));
    }
    const f = k => `${Math.min(...rs.map(r => r[k])).toFixed(1)}/${median(rs.map(r => r[k])).toFixed(1)}`;
    console.log(`  ${label.padEnd(48)} parse ${f("parse")} ms · frío ${f("cold")} ms · ` +
      `caliente ${median(rs.map(r => r.warm)).toFixed(2)} ms  (mín/mediana de ${runs})`);
  }
}
