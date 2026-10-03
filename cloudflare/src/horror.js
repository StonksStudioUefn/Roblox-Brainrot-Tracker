/**
 * horror.js — Clasificación de horror y limpieza de títulos.
 *
 * Port fiel de analytics.py (`clean_title`, `_kw_regex`, `horror_score`,
 * `is_horror`, `_has_strong`). Módulo ES sin dependencias salvo config.js:
 * lo usan el Workflow (meta diario, con la descripción) y el navegador.
 *
 * Diferencias de Python `re` / `str` que se cuidan aquí:
 *  · Las regex con caracteres fuera del BMP llevan flag `u`, y las longitudes
 *    (`{1,30}`, `len(t) <= 12`, `len(title)`) se cuentan en code points.
 *  · `\s` y `str.strip()` de Python no son los de JS (Python incluye
 *    \x1c-\x1f y \x85; JS incluye ﻿): se usa la clase exacta de Python.
 *  · `str.strip(chars)` se reimplementa (JS no tiene equivalente).
 *
 * Rendimiento: cada palabra clave se busca primero con `includes` (búsqueda
 * nativa muy rápida) y solo si aparece se aplica la regex con el
 * lookbehind `(?<![a-z0-9])`. El resultado es idéntico: si la palabra no es
 * subcadena, la regex no puede coincidir.
 */

import { HORROR } from "./config.js";

// ─── Títulos ──────────────────────────────────────────────────────────────────
// Mismos rangos que EMOJI_RE de analytics.py
const EMOJI_SRC =
  "[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{1F1E6}-\\u{1F1FF}" +
  "\\u{2190}-\\u{21FF}\\u{2B00}-\\u{2BFF}\\u{3000}-\\u{303F}" +
  "\\u{FE0F}\\u{200D}\\u{20E3}\\u{2300}-\\u{23FF}]";
const EMOJI_RE_G = new RegExp(EMOJI_SRC, "gu");
const TAG_RE_G = /[\[\(【]([^\]\)】]{1,30})[\]\)】]/gu;
// Espacios de Python (str.isspace / `\s` de re con patrones str)
const PY_WS = "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_WS_RUN_G = new RegExp(`[${PY_WS}]+`, "g");
const PY_WS_SET = new Set(
  [9, 10, 11, 12, 13, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680,
    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
    0x2028, 0x2029, 0x202f, 0x205f, 0x3000].map(c => String.fromCharCode(c)),
);

/** `str.strip(chars)` de Python; sin `chars`, quita los espacios de Python. */
export function pyStrip(s, chars) {
  const set = chars === undefined ? PY_WS_SET : new Set(chars);
  let a = 0, b = s.length;
  // Todos los caracteres a quitar están en el BMP: basta comparar unidades UTF-16
  while (a < b && set.has(s[a])) a++;
  while (b > a && set.has(s[b - 1])) b--;
  return s.slice(a, b);
}

/** `str.rstrip()` de Python (espacios). */
export function pyRstrip(s) {
  let b = s.length;
  while (b > 0 && PY_WS_SET.has(s[b - 1])) b--;
  return s.slice(0, b);
}

/** Longitud en code points (= `len()` de Python). */
export function pyLen(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** '[⚙️UPD 6] Anime Dice 🎲' → ['Anime Dice', ['UPD 6']]. */
// Sin '[', '(' ni caracteres no ASCII no puede haber etiquetas ni emojis
const NEEDS_FULL_TITLE = /[\[\(\u0080-\uffff]/;

export function cleanTitle(name) {
  name = name || "";
  if (!NEEDS_FULL_TITLE.test(name)) {
    const title = pyStrip(name.replace(PY_WS_RUN_G, " "), " -|:·•!");
    return [title || pyStrip(name) || name, []];
  }
  const tags = [];
  for (const m of name.matchAll(TAG_RE_G)) {
    const t = pyStrip(m[1].replace(EMOJI_RE_G, ""), " -|:!");
    if (t) tags.push(pyLen(t) <= 12 ? t.toUpperCase() : t);
  }
  let title = name.replace(TAG_RE_G, " ");
  title = title.replace(EMOJI_RE_G, " ");
  title = pyStrip(title.replace(PY_WS_RUN_G, " "), " -|:·•!");
  if (!title) title = pyStrip(name.replace(EMOJI_RE_G, "")) || name;
  return [title, tags.slice(0, 3)];
}

// ─── Clasificación de horror ──────────────────────────────────────────────────
function escapeRe(w) {
  return w.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
}

/** Igual que `_kw_regex`: inicio de palabra obligatorio, el final puede seguir. */
function kwList(words) {
  return words.map(w => ({ w, rx: new RegExp("(?<![a-z0-9])" + escapeRe(w)) }));
}

const H = {};
for (const k of ["name_strong", "name_weak", "name_negative", "desc_strong", "desc_weak"]) {
  H[k] = kwList(HORROR[k]);
}
const TAGS = HORROR.tags;
const FORCE_IN = new Set(HORROR.force_include.map(Number));
const FORCE_OUT = new Set(HORROR.force_exclude.map(Number));
const own = (obj, k) => k != null && Object.prototype.hasOwnProperty.call(obj, k);

// Referencia: lo mismo que analytics.py, palabra a palabra con su regex.
// Se usa si alguna palabra clave no es ASCII (el escáner rápido no vale) y en
// las pruebas de paridad.
const refMatcher = {
  first(key, text) {
    for (const kw of H[key]) if (text.includes(kw.w) && kw.rx.test(text)) return kw.w;
    return null;
  },
  all(key, text) {
    const out = [];
    for (const kw of H[key]) if (text.includes(kw.w) && kw.rx.test(text)) out.push(kw.w);
    return out;
  },
};

// ─── Escáner rápido (resultado idéntico a las regex) ─────────────────────────
// Recorre el texto ORIGINAL una sola vez, pasando a minúsculas al vuelo, y en
// cada inicio de palabra (carácter anterior fuera de [a-z0-9] tras `.lower()`)
// prueba solo las palabras clave que empiezan por esa letra. Equivale a
// `(?<![a-z0-9])palabra` sobre `texto.lower()` porque los únicos caracteres no
// ASCII cuya minúscula contiene ASCII son U+212A (K de Kelvin → "k") y U+0130
// (İ → "i" + U+0307), tanto en Python como en JS; se tratan aparte.
const KELVIN = 0x212a, I_DOT = 0x130;

// Tablas ASCII: minúscula y "es [a-z0-9] tras .lower()"
const LOWER = new Uint8Array(128), ALNUM = new Uint8Array(128);
for (let c = 0; c < 128; c++) {
  LOWER[c] = c >= 65 && c <= 90 ? c + 32 : c;
  const l = LOWER[c];
  ALNUM[c] = (l >= 97 && l <= 122) || (l >= 48 && l <= 57) ? 1 : 0;
}

function makeScanner(keys) {
  const lists = keys.map(k => HORROR[k]);
  if (!lists.flat().every(w => w && /^[\x00-\x7f]+$/.test(w))) return null;
  // Palabras en un array plano; cubos por primera letra con índices al array
  const words = [], offsets = [];
  for (const list of lists) {
    offsets.push(words.length);
    words.push(...list);
  }
  const byFirst = Array.from({ length: 128 }, () => []);
  words.forEach((w, i) => byFirst[w.charCodeAt(0)].push(i));
  const start = new Int32Array(129), ids = new Int32Array(words.length);
  let k = 0;
  for (let c = 0; c < 128; c++) {
    start[c] = k;
    for (const i of byFirst[c]) ids[k++] = i;
  }
  start[128] = k;
  return { keys, lists, words, offsets, start, ids, marks: new Uint8Array(words.length) };
}

function matchAt(text, i, w) {
  const n = w.length;
  // Con İ el texto en minúsculas es más largo, pero İ solo puede ser el último
  // carácter de una coincidencia: basta con exigir n caracteres del original
  if (i + n > text.length) return false;
  for (let j = 1; j < n; j++) {   // el primero ya coincide (cubo)
    const c = text.charCodeAt(i + j);
    if (c < 128) {
      if (LOWER[c] !== w.charCodeAt(j)) return false;
    } else if (c === KELVIN) {
      if (w.charCodeAt(j) !== 107) return false;
    } else if (c === I_DOT) {
      return j === n - 1 && w.charCodeAt(j) === 105;
    } else return false;
  }
  return true;
}

function scan(sc, text) {
  const { start, ids, words, marks } = sc;
  marks.fill(0);
  let prevAlnum = 0;
  for (let i = 0, n = text.length; i < n; i++) {
    const c = text.charCodeAt(i);
    let lc;
    if (c < 128) lc = LOWER[c];
    else if (c === KELVIN) lc = 107;
    else if (c === I_DOT) {
      // "i" + U+0307: solo vale como palabra de una letra "i"
      if (prevAlnum === 0) {
        for (let k = start[105]; k < start[106]; k++) if (words[ids[k]].length === 1) marks[ids[k]] = 1;
      }
      prevAlnum = 0;
      continue;
    } else {
      prevAlnum = 0;
      continue;
    }
    if (prevAlnum === 0) {
      for (let k = start[lc], e = start[lc + 1]; k < e; k++) {
        const id = ids[k];
        if (marks[id] === 0 && matchAt(text, i, words[id])) marks[id] = 1;
      }
    }
    prevAlnum = c < 128 ? ALNUM[c] : 1;   // Kelvin → "k"
  }
}

function scanMatcher(sc, text) {
  scan(sc, text);
  const { keys, lists, offsets, marks } = sc;
  return {
    first(key) {
      const li = keys.indexOf(key), o = offsets[li], list = lists[li];
      for (let i = 0; i < list.length; i++) if (marks[o + i]) return list[i];
      return null;
    },
    all(key) {
      const li = keys.indexOf(key), o = offsets[li], list = lists[li], out = [];
      for (let i = 0; i < list.length; i++) if (marks[o + i]) out.push(list[i]);
      return out;
    },
  };
}

const NAME_SCAN = makeScanner(["name_strong", "name_weak", "name_negative"]);
const DESC_SCAN = makeScanner(["desc_strong", "desc_weak"]);

/** Port de `horror_score` + `is_horror` (+ `_has_strong`), en una sola pasada. */
export function classifyHorror(game, { reference = false } = {}) {
  const g = game || {};
  const uid = Number(g.universe_id ?? g.id);
  if (FORCE_IN.has(uid)) return { horror: 99 >= HORROR.threshold, score: 99, reasons: ["incluido a mano"] };
  if (FORCE_OUT.has(uid)) return { horror: false, score: -99, reasons: ["excluido a mano"] };

  const pts = HORROR.points;
  const [title, tags] = cleanTitle(g.name || "");
  const fast = !reference && NAME_SCAN && DESC_SCAN;
  const nm = fast ? scanMatcher(NAME_SCAN, title) : refMatcher;
  const name = fast ? null : title.toLowerCase();
  let score = 0;
  const reasons = [];

  const tag = tags.find(t => TAGS.includes(t.toLowerCase())) ?? null;
  const hit = nm.first("name_strong", name);
  if (hit || tag) {
    score += pts.name_strong;
    reasons.push(`nombre: ${hit || tag.toLowerCase()}`);
  }
  let w = nm.first("name_weak", name);
  if (w) {
    score += pts.name_weak;
    reasons.push(`nombre: ${w}`);
  }
  w = nm.first("name_negative", name);
  if (w) {
    score += pts.name_negative;
    reasons.push(`resta: ${w}`);
  }

  const legacy = own(HORROR.legacy_genres, g.genre) ? HORROR.legacy_genres[g.genre] : null;
  if (legacy) {
    score += legacy;
    reasons.push(`género del creador: ${g.genre}`);
  }
  const genre = `${g.genre_l1 || ""}/${g.genre_l2 || ""}`;
  if (own(HORROR.genres, genre)) {
    score += HORROR.genres[genre];
    reasons.push(`género: ${genre.replace(/\/+$/, "")}`);
  }

  // La descripción, después del nombre (los dos escáneres reutilizan sus marcas)
  const desc = fast ? null : (g.description || "").toLowerCase();
  const dm = fast ? scanMatcher(DESC_SCAN, g.description || "") : refMatcher;
  const ds = dm.all("desc_strong", desc);
  if (ds.length) {
    score += Math.min(ds.length * pts.desc_strong, pts.desc_strong_cap);
    reasons.push("descripción: " + ds.slice(0, 3).join(", "));
  }
  const dw = dm.all("desc_weak", desc);
  if (dw.length) {
    score += Math.min(dw.length * pts.desc_weak, pts.desc_weak_cap);
    if (!ds.length) reasons.push("descripción: " + dw.slice(0, 2).join(", "));
  }

  // _has_strong: nombre fuerte, etiqueta, descripción fuerte o género antiguo
  const strong = Boolean(hit || tag || ds.length || legacy);
  return { horror: score >= HORROR.threshold && strong, score, reasons };
}
