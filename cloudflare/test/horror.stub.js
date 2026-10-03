/**
 * horror.stub.js — Sustituto de src/horror.js SOLO para las pruebas, mientras
 * el módulo real no exista. metrics.parity.mjs lo copia como horror.js junto a
 * metrics.js en un directorio temporal. Port de analytics.clean_title.
 */
const EMOJI = '\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{3000}-\u{303F}\u{FE0F}\u{200D}\u{20E3}\u{2300}-\u{23FF}';
const EMOJI_RE = new RegExp(`[${EMOJI}]`, 'gu');
const TAG_RE = /[\[\(【]([^\]\)】]{1,30})[\]\)】]/gu;

function strip(s, chars) {
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

export function cleanTitle(name) {
  name = name || '';
  const tags = [];
  for (const m of name.matchAll(TAG_RE)) {
    const t = strip(m[1].replace(EMOJI_RE, ''), ' -|:!');
    if (t) tags.push([...t].length <= 12 ? t.toUpperCase() : t);
  }
  let title = name.replace(TAG_RE, ' ').replace(EMOJI_RE, ' ');
  title = strip(title.replace(/\s+/gu, ' '), ' -|:·•!');
  if (!title) title = name.replace(EMOJI_RE, '').trim() || name;
  return [title, tags.slice(0, 3)];
}

export function classifyHorror() {
  throw new Error('stub: classifyHorror no está en el stub de pruebas');
}
