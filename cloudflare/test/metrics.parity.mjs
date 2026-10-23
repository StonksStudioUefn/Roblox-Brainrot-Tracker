// node test/metrics.parity.mjs [--actualizar] — buildDashboard sobre data/ de 99d2ee9; sale con 1 si cambia.
// Desde e9b720d metrics.js ya no es el port de export_dashboard.py: se compara con su propia salida.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDashboard } from '../src/metrics.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const GOLDEN = path.join(HERE, 'metrics.golden.json');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-'));
const NOWS = ['2026-10-03T00:31:00Z', '2026-10-02T12:20:00Z', '2026-09-27T20:20:00Z', '2026-09-20T12:20:00Z'];
const SCENARIOS = { full: ['--daily-days', 'all', '--sample-hours', 'all', '--no-filter'], contract: [] };

const got = {};
for (const now of NOWS) {
  for (const [s, extra] of Object.entries(SCENARIOS)) {
    const file = path.join(OUT, `export_${s}_${now.replace(/:/g, '')}.json`);
    execFileSync('python3', [path.join(HERE, 'make_export.py'), '--now', now, '--out', file, ...extra], { cwd: ROOT, stdio: 'ignore' });
    const J = buildDashboard(JSON.parse(fs.readFileSync(file, 'utf8')), { now });
    got[`${s} ${now}`] = createHash('sha256').update(JSON.stringify(J)).digest('hex');
  }
}

if (process.argv.includes('--actualizar')) {
  fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n');
  console.log(`✓ ${GOLDEN} actualizado`);
} else {
  const want = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const bad = Object.keys(got).filter(k => got[k] !== want[k]);
  for (const k of bad) console.log(`✗ ${k}: el dashboard ha cambiado`);
  console.log(bad.length ? `✗ ${bad.length} de ${Object.keys(got).length} distintos` : `✓ ${Object.keys(got).length} dashboards idénticos`);
  process.exitCode = bad.length ? 1 : 0;
}
