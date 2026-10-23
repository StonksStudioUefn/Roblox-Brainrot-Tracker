// Port fiel de analytics.py: \s, strip() y len() de Python no son los de JS (clase, flag u).

import { HORROR } from "./config.js";

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

const STRIP_SETS = new Map();
export function pyStrip(s, chars) {
  let set = PY_WS_SET;
  if (chars !== undefined) {
    set = STRIP_SETS.get(chars);
    if (!set) STRIP_SETS.set(chars, (set = new Set(chars)));
  }
  let a = 0, b = s.length;
  // Todos los caracteres a quitar están en el BMP: basta comparar unidades UTF-16
  while (a < b && set.has(s[a])) a++;
  while (b > a && set.has(s[b - 1])) b--;
  return s.slice(a, b);
}

export function pyRstrip(s) {
  let b = s.length;
  while (b > 0 && PY_WS_SET.has(s[b - 1])) b--;
  return s.slice(0, b);
}

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

function escapeRe(w) {
  return w.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
}

/** Igual que `_kw_regex`: inicio de palabra obligatorio, el final puede seguir. */
function kwList(words) {
  return words.map(w => ({ w, rx: new RegExp("(?<![a-z0-9])" + escapeRe(w)) }));
}

// Se compilan solo si se usan: en frío cuenta cada ms de arranque.
let H_CACHE = null;
const refLists = () => {
  if (!H_CACHE) {
    H_CACHE = {};
    for (const k of ["name_strong", "name_weak", "name_negative", "desc_strong", "desc_weak"]) H_CACHE[k] = kwList(HORROR[k]);
  }
  return H_CACHE;
};
const TAGS = HORROR.tags;
const FORCE_IN = new Set(HORROR.force_include.map(Number));
const FORCE_OUT = new Set(HORROR.force_exclude.map(Number));
const own = (obj, k) => k != null && Object.prototype.hasOwnProperty.call(obj, k);

// Referencia palabra a palabra, como analytics.py: horror.parity.mjs la compara con el escáner.
const refMatcher = {
  first(key, text) {
    for (const kw of refLists()[key]) if (text.includes(kw.w) && kw.rx.test(text)) return kw.w;
    return null;
  },
  all(key, text) {
    const out = [];
    for (const kw of refLists()[key]) if (text.includes(kw.w) && kw.rx.test(text)) out.push(kw.w);
    return out;
  },
};

// Exacto: tras cada acierto sigue en p+1 y no pierde solapadas («being hunted» / «hunted by»).

function trieSource(words) {
  const root = {};
  for (const w of words) {
    let n = root;
    for (const ch of w) n = n[ch] ||= {};
    n[""] = true;
  }
  const emit = n => {
    const keys = Object.keys(n).filter(k => k !== "");
    if (!keys.length) return "";
    const alts = keys.map(k => escapeRe(k) + emit(n[k]));
    const body = alts.length === 1 ? alts[0] : `(?:${alts.join("|")})`;
    return n[""] ? `(?:${body})?` : body;
  };
  return emit(root);
}

function makeScanner(keys) {
  const lists = keys.map(k => HORROR[k]);
  const words = [], offsets = [];
  for (const list of lists) {
    offsets.push(words.length);
    words.push(...list);
  }
  const byFirst = new Map();
  words.forEach((w, i) => {
    const c = w.charCodeAt(0);
    if (!byFirst.has(c)) byFirst.set(c, []);
    byFirst.get(c).push(i);
  });
  const finder = new RegExp("(?<![a-z0-9])" + trieSource([...new Set(words)]), "g");
  return { keys, lists, words, offsets, byFirst, finder, marks: new Uint8Array(words.length) };
}

function scan(sc, text) {
  const { words, byFirst, finder, marks } = sc;
  marks.fill(0);
  finder.lastIndex = 0;
  let m;
  while ((m = finder.exec(text)) !== null) {
    const p = m.index;
    const ids = byFirst.get(text.charCodeAt(p));
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      if (marks[id] === 0 && text.startsWith(words[id], p)) marks[id] = 1;
    }
    finder.lastIndex = p + 1;
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

export function classifyHorror(game, { reference = false } = {}) {
  const g = game || {};
  const uid = Number(g.universe_id ?? g.id);
  if (FORCE_IN.has(uid)) return { horror: 99 >= HORROR.threshold, score: 99, reasons: ["incluido a mano"] };
  if (FORCE_OUT.has(uid)) return { horror: false, score: -99, reasons: ["excluido a mano"] };

  const pts = HORROR.points;
  const [title, tags] = cleanTitle(g.name || "");
  const fast = !reference;
  const name = title.toLowerCase();
  const nm = fast ? scanMatcher(NAME_SCAN, name) : refMatcher;
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

  const desc = (g.description || "").toLowerCase();
  const dm = fast ? scanMatcher(DESC_SCAN, desc) : refMatcher;
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

  const strong = Boolean(hit || tag || ds.length || legacy);
  return { horror: score >= HORROR.threshold && strong, score, reasons };
}
