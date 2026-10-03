/**
 * metrics.parity.mjs — Compara buildDashboard() (src/metrics.js) con la
 * referencia en Python (export_dashboard.build()) sobre los mismos datos
 * locales (data/) y el mismo `now`.
 *
 *   node cloudflare/test/metrics.parity.mjs [--out DIR] [--now ISO,ISO…] [--sorts FILE] [--quick]
 *
 * Para cada `now` se generan varios export.json con make_export.py y se
 * comparan con la salida de Python (py_dashboard.py):
 *   full     serie diaria entera, 8 días de muestras, sin filtro → debe ser IDÉNTICO
 *            (mide el port en sí);
 *   d21      solo la ventana de 21 días (últimas 21 filas de cada juego);
 *   d21cal   solo la ventana de 21 días de calendario;
 *   s48      solo las 48 h de muestras;
 *   filter   solo el filtro de juegos del contrato;
 *   contract las tres cosas a la vez (lo que verá el dashboard), con filas;
 *   contractcal  lo mismo con días de calendario;
 *   d24      contrato pero con 24 días (para ver si compensa ampliar la ventana).
 * Con --sorts, además, el efecto de las listas de Roblox en los emergentes.
 *
 * Sale con código 1 si `full` no es idéntico.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../src');
const ROOT = path.resolve(HERE, '../..');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', fs.mkdtempSync(path.join(os.tmpdir(), 'parity-')));
const SORTS = arg('--sorts', null);
const QUICK = process.argv.includes('--quick');
fs.mkdirSync(OUT, { recursive: true });

/** Importa metrics.js; si src/horror.js aún no existe, usa el stub de test/. */
export async function loadMetrics() {
  if (fs.existsSync(path.join(SRC, 'horror.js'))) return import(pathToFileURL(path.join(SRC, 'metrics.js')).href);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-'));
  for (const f of fs.readdirSync(SRC)) if (f.endsWith('.js')) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.copyFileSync(path.join(HERE, 'horror.stub.js'), path.join(dir, 'horror.js'));
  console.log('(src/horror.js no existe: se usa test/horror.stub.js)');
  return import(pathToFileURL(path.join(dir, 'metrics.js')).href);
}

const py = (script, args) => execFileSync('python3', [path.join(HERE, script), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

// Último ts de muestra en data/raw → "now" por defecto (3 min después)
function defaultNow() {
  const dir = path.join(ROOT, 'data/raw');
  const last = fs.readdirSync(dir).filter(f => f.endsWith('.csv')).sort().pop();
  const ts = fs.readFileSync(path.join(dir, last), 'utf8').trim().split('\n').slice(1).map(l => l.split(',')[0]).sort().pop();
  return new Date(Date.parse(ts.replace('Z', ':00Z')) + 3 * 60000).toISOString().slice(0, 19) + 'Z';
}

const SCENARIOS = {
  full: ['--daily-days', 'all', '--sample-hours', 'all', '--no-filter'],
  d21: ['--sample-hours', 'all', '--no-filter'],
  d21cal: ['--sample-hours', 'all', '--no-filter', '--daily-mode', 'calendar'],
  s48: ['--daily-days', 'all', '--no-filter'],
  filter: ['--daily-days', 'all', '--sample-hours', 'all'],
  contract: [],
  contractcal: ['--daily-mode', 'calendar'],
  d24: ['--daily-days', '24'],
};

// ─── Comparación ──────────────────────────────────────────────────────────────
function same(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => same(a[k], b[k]));
  }
  return false;
}

function listDiff(p, j) {
  if (same(p, j)) return null;
  const sp = new Set(p), sj = new Set(j);
  const onlyPy = p.filter(x => !sj.has(x)), onlyJs = j.filter(x => !sp.has(x));
  let firstOrder = -1;
  const cp = p.filter(x => sj.has(x)), cj = j.filter(x => sp.has(x));
  for (let i = 0; i < cp.length; i++) if (cp[i] !== cj[i]) { firstOrder = i; break; }
  return { py: p.length, js: j.length, onlyPy, onlyJs, firstOrder };
}

function compare(P, J) {
  const res = { top: [], cats: {}, fields: {}, onlyPy: [], onlyJs: [], common: 0, games: {} };
  for (const k of ['updated_at', 'last_sample', 'samples_24h', 'track_min_players', 'emerging_max_visits']) {
    if (!same(P[k], J[k])) res.top.push(`${k}: py=${P[k]} js=${J[k]}`);
  }
  for (const [k, c] of Object.entries(P.categories)) {
    const jc = J.categories[k];
    res.cats[k] = {
      ids: listDiff(c.ids, jc.ids), emerging: listDiff(c.emerging, jc.emerging),
      trending: listDiff(c.trending, jc.trending),
      stats: Object.keys(c.stats).filter(s => c.stats[s] !== jc.stats[s]).map(s => `${s} ${c.stats[s]}→${jc.stats[s]}`),
      keysOrder: same(Object.keys(c), Object.keys(jc)),
    };
  }
  const pk = Object.keys(P.games), jk = Object.keys(J.games);
  res.keyOrder = same(pk, jk);
  for (const id of pk) {
    const pg = P.games[id], jg = J.games[id];
    if (!jg) { res.onlyPy.push(+id); continue; }
    res.common++;
    const fk = Object.keys(pg);
    if (!same(fk, Object.keys(jg).filter(k => k !== 'roblox_sorts'))) res.fieldOrder = (res.fieldOrder || 0) + 1;
    for (const f of fk) {
      if (!same(pg[f], jg[f])) {
        (res.fields[f] ||= []).push(+id);
        (res.games[id] ||= []).push(f);
      }
    }
  }
  for (const id of jk) if (!P.games[id]) res.onlyJs.push(+id);
  return res;
}

const pctOf = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';

function report(name, r, P, J) {
  const lines = [];
  const nDiff = Object.keys(r.games).length;
  lines.push(`  [${name}] juegos comunes ${r.common} · con alguna diferencia ${nDiff} (${pctOf(nDiff, r.common)}) · solo py ${r.onlyPy.length} · solo js ${r.onlyJs.length}`);
  if (r.top.length) lines.push('    cabecera: ' + r.top.join('; '));
  if (!r.keyOrder) lines.push('    orden de `games` distinto');
  if (r.fieldOrder) lines.push(`    orden de campos distinto en ${r.fieldOrder} juegos`);
  for (const [k, c] of Object.entries(r.cats)) {
    const parts = [];
    for (const l of ['ids', 'emerging', 'trending']) {
      const d = c[l];
      if (!d) { parts.push(`${l} =`); continue; }
      parts.push(`${l} ≠ (py ${d.py}/js ${d.js}; −${d.onlyPy.length} +${d.onlyJs.length}${d.firstOrder >= 0 ? `; orden distinto desde #${d.firstOrder}` : ''})`);
    }
    if (c.stats.length) parts.push('stats: ' + c.stats.join(', '));
    lines.push(`    ${k}: ${parts.join(' · ')}`);
  }
  const fields = Object.entries(r.fields).sort((a, b) => b[1].length - a[1].length);
  if (fields.length) lines.push('    campos: ' + fields.map(([f, ids]) => `${f} ${ids.length} (${pctOf(ids.length, r.common)})`).join(', '));
  return lines.join('\n');
}

/** Ejemplos legibles de las diferencias (para explicarlas). */
function examples(r, P, J, E, fields, max = 4) {
  const out = [];
  const ex = new Map((E?.games || []).map(g => [String(g.id), g]));
  for (const f of fields) {
    for (const id of (r.fields[f] || []).slice(0, max)) {
      const pg = P.games[id], jg = J.games[id], eg = ex.get(String(id));
      out.push(`      ${f} #${id} "${(pg.title || '').slice(0, 28)}": py=${JSON.stringify(pg[f])} js=${JSON.stringify(jg[f])}` +
        (eg ? ` (d=${eg.d.length} días, historia ${eg.days_tracked})` : ''));
    }
  }
  return out.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { buildDashboard } = await loadMetrics();
  const nows = (arg('--now', null) || [defaultNow(), '2026-10-02T12:20:00Z', '2026-09-27T20:20:00Z', '2026-09-20T12:20:00Z'].join(',')).split(',');
  const scen = QUICK ? ['full', 'contract'] : Object.keys(SCENARIOS);
  let fullOk = true;
  const summary = [];

  for (const now of nows) {
    const tag = now.replace(/[:]/g, '');
    const pyFile = path.join(OUT, `py_${tag}.json`);
    py('py_dashboard.py', ['--now', now, '--out', pyFile]);
    const P = readJson(pyFile);
    console.log(`\n═══ now = ${now} · Python: general ${P.categories.general.ids.length} ids / ${P.categories.general.emerging.length} emergentes / ${P.categories.general.trending.length} tendencia · horror ${P.categories.horror.ids.length}`);
    for (const s of scen) {
      const exFile = path.join(OUT, `export_${s}_${tag}.json`);
      py('make_export.py', ['--now', now, '--out', exFile, ...SCENARIOS[s]]);
      const E = readJson(exFile);
      const J = buildDashboard(E, { now });
      fs.writeFileSync(path.join(OUT, `js_${s}_${tag}.json`), JSON.stringify(J));
      const r = compare(P, J);
      console.log(report(s, r, P, J) + `   (export ${E.games.length} juegos, ${(fs.statSync(exFile).size / 1024).toFixed(0)} KB)`);
      const nd = Object.keys(r.games).length;
      if (s === 'full' && (nd || r.onlyPy.length || r.onlyJs.length || r.top.length || !r.keyOrder || r.fieldOrder ||
        Object.values(r.cats).some(c => c.ids || c.emerging || c.trending || c.stats.length))) {
        fullOk = false;
        console.log(examples(r, P, J, E, Object.keys(r.fields), 5));
      }
      if (s !== 'full') {
        const important = ['status', 'emerging', 'trend', 'growth_24h', 'growth_7d', 'typical', 'spike_now', 'momentum', 'avg_7d'];
        const ex = examples(r, P, J, E, important.filter(f => r.fields[f]), 3);
        if (ex) console.log(ex);
      }
      // Métricas clave sobre los juegos comunes
      const st = (r.fields.status || []).length, em = (r.fields.emerging || []).length;
      const tr = Object.keys(P.categories).reduce((a, k) => {
        const d = r.cats[k].trending; return a + (d ? d.onlyPy.length + d.onlyJs.length : 0);
      }, 0);
      summary.push({ now, s, common: r.common, status: st, emerging: em, trendingMembers: tr,
        idsDiff: Object.values(r.cats).reduce((a, c) => a + (c.ids ? c.ids.onlyPy.length + c.ids.onlyJs.length : 0), 0),
        emergingListDiff: Object.values(r.cats).reduce((a, c) => a + (c.emerging ? c.emerging.onlyPy.length + c.emerging.onlyJs.length : 0), 0),
        withDiff: Object.keys(r.games).length });
    }
  }

  console.log('\n═══ Resumen (juegos comunes; % sobre comunes)');
  console.log('now                    escenario  comunes  status≠      emergente≠   ±tendencia  ±ids  ±emergentes  algún campo≠');
  for (const x of summary) {
    console.log(`${x.now.padEnd(22)} ${x.s.padEnd(9)} ${String(x.common).padStart(7)}  ${`${x.status} (${pctOf(x.status, x.common)})`.padEnd(12)} ${`${x.emerging} (${pctOf(x.emerging, x.common)})`.padEnd(12)} ${String(x.trendingMembers).padStart(10)}  ${String(x.idsDiff).padStart(4)}  ${String(x.emergingListDiff).padStart(11)}  ${x.withDiff} (${pctOf(x.withDiff, x.common)})`);
  }

  // Efecto de las listas de Roblox (solo JS: Python no las tiene)
  if (SORTS) {
    const now = nows[0];
    const a = path.join(OUT, 'export_contract_sorts.json');
    py('make_export.py', ['--now', now, '--out', a, '--sorts', SORTS]);
    const E = readJson(a);
    const Eno = { ...E, games: E.games.map(g => ({ ...g, sorts: {} })) };
    const J1 = buildDashboard(E, { now }), J0 = buildDashboard(Eno, { now });
    const inSorts = E.games.filter(g => Object.keys(g.sorts).length).length;
    console.log(`\n═══ Listas de Roblox (${path.basename(SORTS)}): ${inSorts} juegos del export están en alguna lista`);
    for (const k of Object.keys(J1.categories)) {
      const e0 = J0.categories[k].emerging, e1 = J1.categories[k].emerging;
      const added = e1.filter(x => !e0.includes(x)), removed = e0.filter(x => !e1.includes(x));
      console.log(`  ${k}: emergentes ${e0.length} → ${e1.length} · entran ${added.length} · salen ${removed.length}`);
      for (const id of added) {
        const g = J1.games[id];
        console.log(`    + ${g.title} ★${g.emerging} ${JSON.stringify(g.roblox_sorts)} — ${g.emerging_reasons.join(' | ')}`);
      }
    }
  }

  console.log(`\nFicheros en ${OUT}`);
  console.log(fullOk ? '✓ full: idéntico a Python' : '✗ full: hay diferencias con Python');
  process.exitCode = fullOk ? 0 : 1;
}

main();
