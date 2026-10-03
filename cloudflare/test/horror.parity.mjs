/**
 * horror.parity.mjs — Paridad de src/horror.js con analytics.py (producción).
 *
 * Descarga detalles frescos (con descripción) de la Games API pública de Roblox
 * para los ids de data/games.json (50 por llamada) y compara, juego a juego,
 * `classifyHorror` con `analytics.is_horror` y `cleanTitle` con
 * `analytics.clean_title`. Además mide la CPU de clasificar 1.000 juegos.
 *
 * Uso (desde la raíz del repo):
 *   node cloudflare/test/horror.parity.mjs                 # usa la caché si existe
 *   node cloudflare/test/horror.parity.mjs --fresh         # vuelve a descargar
 *   node cloudflare/test/horror.parity.mjs --limit 1000
 *   node cloudflare/test/horror.parity.mjs --det fichero.json  # lista de detalles ya descargada
 * Variables: HORROR_CACHE (ruta de la caché; por defecto en el tmp del sistema), PYTHON.
 *
 * Sale con código 1 si hay alguna diferencia.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyHorror, cleanTitle } from "../src/horror.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const LIMIT = Number(opt("--limit", 2500));
const CACHE = process.env.HORROR_CACHE || join(tmpdir(), "roblox-horror-details.json");
const PYTHON = process.env.PYTHON || "python3";

// ─── Datos ────────────────────────────────────────────────────────────────────
async function download(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const r = await fetch(`https://games.roblox.com/v1/games?universeIds=${chunk.join(",")}`,
          { signal: AbortSignal.timeout(20000) });
        if (r.status === 429) throw new Error("429");
        const j = await r.json();
        out.push(...(j.data || []));
        break;
      } catch (e) {
        if (attempt === 3) console.error(`  lote ${i / 50}: ${e.message}`);
        await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
      }
    }
    process.stderr.write(`\r  descargados ${out.length}/${ids.length}`);
  }
  process.stderr.write("\n");
  return out;
}

async function loadDetails() {
  const det = opt("--det");
  if (det) {
    const j = JSON.parse(readFileSync(det, "utf8"));
    return Array.isArray(j) ? j : j.det;
  }
  if (!args.includes("--fresh") && existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, "utf8"));
  const ids = Object.keys(JSON.parse(readFileSync(join(ROOT, "data/games.json"), "utf8"))).slice(0, LIMIT);
  console.log(`Descargando ${ids.length} juegos de la Games API…`);
  const rows = await download(ids);
  writeFileSync(CACHE, JSON.stringify(rows));
  return rows;
}

// Casos sintéticos para las diferencias de Python/JS (Unicode, espacios, corchetes…)
const SYNTHETIC = [
  "[⚙️UPD 6] Anime Dice 🎲", "【HORROR】 Night 🌙", "(SCARY) [ANOMALY] the backrooms",
  "🎃[HALLOWEEN] Doors 👁️", "   ", "🔥🔥", "[🔥]", "[] ()", "[a very long tag that has more than thirty chars] X",
  "Escape the Facility　!!", "Run\x1cFrom\x1fIt", "﻿BOM Horror", "ＨＯＲＲＯＲ fullwidth",
  "İstanbul Ghost", "ΣΊΣΥΦΟΣ", "Straße [ß tag]", "SCP: Containment Breach", ".EXE Survival",
  "PIGGY ⃣ keycap", "Survive‍The‍Night", "x-horror", "dont horror9", "9horror", "Dread·•", "-|: Killer :|-",
  "[UPD] [NEW] [EVENT] [4th] Tower Simulator", "🐷 Piggy 🐷 [BOOK 2]", "Steal a Brainrot", "The Rake REMASTERED",
  "名称 [恐怖] 游戏", "Ghost Line", "Tab\tGhost\nNewline", "ghost\u0085next", "(((nested))) ghost",
  "[x)y] creepy", "(🎃) Spooky", "【】 empty", "Ⓗorror", "KKelvin killer",
];

function syntheticGames() {
  const descs = [
    "", "Don't get caught! A creepy entity lurks in the dark.", "Hide from the KILLER. Survive the night.",
    "superhorror unscary jump scare", "Sanity drains… insanity", "monsters, creatures and zombies chase you",
    "ＨＯＲＲＯＲ", "İ horror", "lights out murderer flashlight", "entities anomalies anomalous",
  ];
  const genres = [["All", "Survival", "1 vs All"], ["Horror", "Survival", ""], ["All", "Adventure", "Story"],
    ["All", "Survival", null], ["All", null, null], ["constructor", "__proto__", "x"]];
  return SYNTHETIC.map((name, i) => {
    const [genre, genre_l1, genre_l2] = genres[i % genres.length];
    return { id: -(i + 1), name, description: descs[i % descs.length], genre, genre_l1, genre_l2 };
  });
}

// ─── Comparación ──────────────────────────────────────────────────────────────
function python(games) {
  const out = execFileSync(PYTHON, [join(HERE, "horror_ref.py")], {
    input: JSON.stringify(games), cwd: ROOT, maxBuffer: 1 << 28,
  });
  return JSON.parse(out.toString("utf8"));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function compare(label, games) {
  const ref = python(games);
  let refDiff = 0, horrorDiff = 0, scoreDiff = 0, reasonDiff = 0, titleDiff = 0, tagDiff = 0, horrorCount = 0;
  const examples = [];
  games.forEach((g, i) => {
    const r = ref[i];
    const js = classifyHorror(g);
    const refJs = classifyHorror(g, { reference: true });
    const [title, tags] = cleanTitle(g.name);
    if (r.horror) horrorCount++;
    const d = [];
    if (!same(js, refJs)) { refDiff++; d.push("rápido≠regex"); }
    if (js.horror !== r.horror) { horrorDiff++; d.push("horror"); }
    if (js.score !== r.score) { scoreDiff++; d.push("score"); }
    if (!same(js.reasons, r.reasons)) { reasonDiff++; d.push("reasons"); }
    if (title !== r.title) { titleDiff++; d.push("title"); }
    if (!same(tags, r.tags)) { tagDiff++; d.push("tags"); }
    if (d.length && examples.length < 10) examples.push({ id: g.id, name: g.name, diff: d, py: r, js: { ...js, title, tags } });
  });
  const total = refDiff + horrorDiff + scoreDiff + reasonDiff + titleDiff + tagDiff;
  console.log(`${label}: ${games.length} juegos (${horrorCount} de horror según Python) · diferencias: ` +
    `horror ${horrorDiff}, score ${scoreDiff}, reasons ${reasonDiff}, title ${titleDiff}, tags ${tagDiff}; escáner rápido ≠ regex: ${refDiff}`);
  for (const e of examples) console.log("  ✗", JSON.stringify(e));
  return total;
}

function cpuBench(games) {
  const sample = [];
  while (sample.length < 1000) sample.push(...games);
  sample.length = 1000;
  const runs = [];
  for (let k = 0; k < 8; k++) {
    const t0 = process.cpuUsage();
    let n = 0;
    for (const g of sample) n += classifyHorror(g).score;
    const t = process.cpuUsage(t0);
    runs.push((t.user + t.system) / 1000);
  }
  const chars = sample.reduce((a, g) => a + (g.description || "").length + (g.name || "").length, 0);
  const warm = runs.slice(1).sort((a, b) => a - b);
  console.log(`CPU clasificar 1.000 juegos (≈${Math.round(chars / 1000)} caracteres de media): ` +
    `primera pasada ${runs[0].toFixed(2)} ms · en caliente mediana ${warm[Math.floor(warm.length / 2)].toFixed(2)} ms ` +
    `(mín ${warm[0].toFixed(2)}, máx ${warm.at(-1).toFixed(2)})`);
}

const details = await loadDetails();
const games = details
  .filter(d => d && d.id)
  .map(d => ({
    id: d.id, name: d.name, description: d.description || "",
    genre: d.genre, genre_l1: d.genre_l1, genre_l2: d.genre_l2,
  }));
const withDesc = games.filter(g => g.description).length;
console.log(`Detalles: ${games.length} juegos, ${withDesc} con descripción`);

let bad = 0;
bad += compare("Games API (fresco)", games);
// Mismos juegos con la descripción en mayúsculas y sin ella, para forzar más ramas
bad += compare("Sin descripción", games.map(g => ({ ...g, description: "" })));
bad += compare("Sintéticos", syntheticGames());
// clean_title con todos los nombres de data/games.json
const names = Object.entries(JSON.parse(readFileSync(join(ROOT, "data/games.json"), "utf8")))
  .map(([id, g]) => ({ id: Number(id), name: g.name || "", genre: g.genre, genre_l1: g.genre_l1, genre_l2: g.genre_l2 }));
bad += compare("Nombres de data/games.json", names);

cpuBench(games);
console.log(bad ? `✗ ${bad} diferencias` : "✓ 100 % idéntico");
process.exit(bad ? 1 : 0);
