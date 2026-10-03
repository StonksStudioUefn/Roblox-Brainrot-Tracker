/**
 * metrics.bench.mjs — CPU de buildDashboard() con 150 y 1.000 juegos.
 *
 *   node cloudflare/test/metrics.bench.mjs [export.json]
 *
 * Cada medida corre en un proceso NUEVO (como un isolate frío del Worker):
 * JSON.parse del export + la primera llamada (fría, sin JIT) + la mediana de
 * 20 llamadas en caliente. CPU con process.cpuUsage() (usuario + sistema).
 *
 * Conjuntos:
 *   real    juegos del export dado (por defecto, make_export.py de data/ ahora:
 *           la mayoría tienen solo 2-3 días de serie todavía);
 *   steady  sintético "en régimen": 21 días de serie y 16 muestras (cada 3 h)
 *           por juego, con algún pico, que es lo que habrá en unas semanas.
 * Para 150 se usa el prefiltro de Telegram del contrato (emergentes posibles +
 * top 60 por crecimiento 24 h + top 60 por típico).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../src');

// ─── Modo hijo: mide un fichero ───────────────────────────────────────────────
if (process.argv[2] === '--child') {
  const [file, metricsUrl, now] = process.argv.slice(3);
  const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
  const { buildDashboard } = await import(metricsUrl);
  const text = fs.readFileSync(file, 'utf8');
  let c0 = cpu();
  const E = JSON.parse(text);
  const parse = cpu() - c0;
  c0 = cpu();
  const t0 = performance.now();
  const J = buildDashboard(E, { now });
  const cold = cpu() - c0, coldWall = performance.now() - t0;
  const warm = [];
  for (let i = 0; i < 20; i++) { const a = performance.now(); buildDashboard(E, { now }); warm.push(performance.now() - a); }
  warm.sort((a, b) => a - b);
  process.stdout.write(JSON.stringify({ games: E.games.length, kb: Math.round(text.length / 1024), parse, cold, coldWall, warm: warm[10], out: Object.keys(J.games).length }));
  process.exit(0);
}

// ─── Datos ────────────────────────────────────────────────────────────────────
function rng(seed) { return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648); }

function steadyExport(n, nowMs) {
  const r = rng(42), games = [];
  const nowMin = Math.floor(nowMs / 60000), today = Math.floor(nowMs / 864e5);
  for (let k = 0; k < n; k++) {
    let base = Math.round(300 * Math.exp(r() * 8)), visits = Math.round(base * 2000 * (1 + r() * 50));
    const drift = (r() - 0.45) * 0.1, d = [];
    for (let i = 20; i >= 0; i--) {
      base = Math.max(50, Math.round(base * (1 + drift + (r() - 0.5) * 0.08)));
      const spike = r() < 0.06 ? 2.5 : 1;
      const med = Math.round(base * spike);
      visits += med * 20;
      d.push([new Date((today - i) * 864e5).toISOString().slice(0, 10), med, Math.round(med * 0.7), Math.round(med * 1.4), i ? 8 : 2, visits]);
    }
    const s = [];
    for (let j = 15; j >= 0; j--) s.push([nowMin - 3 - j * 180, Math.round(base * (0.7 + r() * 0.6)), visits - j * base * 8]);
    games.push({
      id: 1e9 + k, place_id: 2e9 + k, name: `[UPD ${k % 9}] Juego ${k} 🎲`, creator: 'x', creator_verified: true,
      created: new Date(nowMs - r() * 400 * 864e5).toISOString(), updated: new Date(nowMs - r() * 30 * 864e5).toISOString(),
      genre: 'All', genre_l1: 'Simulation', genre_l2: 'Tycoon', max_players: 10, first_seen: '2026-08-01T10:00Z',
      horror: r() < 0.2, horror_score: 0, horror_reasons: [], sorts: r() < 0.1 ? { 'up-and-coming': 5 } : {},
      favorites: 1000, up: 900, down: 100, peak: base * 3, peak_date: d[3][0], days_tracked: 60, first_day: '2026-08-01', d, s,
    });
  }
  return { generated_at: new Date(nowMs).toISOString().slice(0, 19) + 'Z', last_sample: new Date((nowMin - 3) * 60000).toISOString().slice(0, 16) + 'Z', samples_24h: 8, games };
}

/**
 * Prefiltro de Telegram (contrato), aproximado con el propio export:
 * emergentes posibles (visitas < 30M y típico ≥ 300, o en up-and-coming) +
 * top 60 por crecimiento de 24 h + top 60 por típico; como mucho `max`.
 */
function telegramSubset(E, max = 150) {
  const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
  const rows = E.games.map(g => {
    const s = g.s || [], t1 = s.length ? s[s.length - 1][0] : 0;
    const typ = med(s.filter(x => x[0] > t1 - 1440).map(x => x[1]));
    const prev = med(s.filter(x => x[0] <= t1 - 1440).map(x => x[1]));
    const visits = (g.d || []).reduce((v, r) => r[5] || v, null);
    return { g, typ, growth: prev ? typ / prev : 0, visits };
  });
  const top = k => [...rows].sort((a, b) => b[k] - a[k]).slice(0, 60).map(x => x.g);
  const em = rows.filter(x => (x.visits != null && x.visits < 30e6 && x.typ >= 300) || x.g.sorts?.['up-and-coming'])
    .sort((a, b) => b.growth - a.growth).map(x => x.g);
  const out = [...new Set([...top('growth'), ...top('typ'), ...em])].slice(0, max);
  return { ...E, games: out };
}

async function main() {
  const metricsUrl = fs.existsSync(path.join(SRC, 'horror.js')) ? pathToFileURL(path.join(SRC, 'metrics.js')).href : null;
  if (!metricsUrl) throw new Error('falta src/horror.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
  let file = process.argv[2];
  if (!file) {
    file = path.join(dir, 'export.json');
    execFileSync('python3', [path.join(HERE, 'make_export.py'), '--out', file], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
  const E = JSON.parse(fs.readFileSync(file, 'utf8'));
  const now = E.generated_at;
  const st = steadyExport(1000, Date.parse(now));
  const sets = [
    ['real 1000', { ...E, games: E.games.slice(0, 1000) }],
    ['real 150 (Telegram)', telegramSubset(E)],
    ['steady 1000', st],
    ['steady 150 (Telegram)', telegramSubset(st)],
    ['steady 2000', steadyExport(2000, Date.parse(now))],
  ];

  console.log('conjunto                 juegos   KB   JSON.parse  1ª llamada (CPU / pared)  caliente (mediana)');
  for (const [name, data] of sets) {
    const f = path.join(dir, name.replace(/\W+/g, '_') + '.json');
    fs.writeFileSync(f, JSON.stringify(data));
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', f, metricsUrl, now], { encoding: 'utf8' });
      if (r.status) throw new Error(r.stderr);
      runs.push(JSON.parse(r.stdout));
    }
    const med = k => runs.map(x => x[k]).sort((a, b) => a - b)[2];
    console.log(`${name.padEnd(24)} ${String(runs[0].games).padStart(6)} ${String(runs[0].kb).padStart(5)}   ${med('parse').toFixed(1).padStart(6)} ms   ${med('cold').toFixed(1).padStart(7)} ms / ${med('coldWall').toFixed(1).padStart(5)} ms     ${med('warm').toFixed(2).padStart(6)} ms`);
  }
  console.log('(mediana de 5 procesos nuevos; "1ª llamada" = isolate frío, que es lo que paga el Worker)');
}

main();
