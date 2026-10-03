/**
 * telegram.js — Avisos por Telegram (port de notifier.py).
 *
 * Lo llama el Workflow en cada muestreo. Decide solo qué toca enviar y guarda
 * lo enviado en el estado (D1 `state`, clave "telegram"):
 *   · alerta en cuanto aparece un emergente fuerte (una vez por juego, como
 *     mucho TELEGRAM.max_alerts_per_run por pasada), con su miniatura;
 *   · resumen diario desde TELEGRAM.report_hour_utc: un mensaje por categoría,
 *     con la miniatura del juego más destacado;
 *   · resumen semanal los lunes (misma hora).
 * Los textos son EXACTAMENTE los de notifier.py (ver test/telegram.test.mjs).
 *
 * CPU (10 ms por paso en el plan gratis). En frío, buildDashboard de 150
 * juegos ya cuesta ~10 ms y parsear el export completo otros 6–12, así que
 * `runTelegram` trabaja con un export REDUCIDO (~60–80 juegos):
 *   · lo normal: `data/telegram.json`, que el backend genera en SQL en el paso
 *     export (mismo formato que el export + `totals` con las cifras de
 *     cabecera de cada categoría). Se usa tal cual: buildDashboard solo con
 *     esos juegos y la cabecera de `totals` (si no trae suben/bajan, la línea
 *     se queda en "N juegos": contarlos sobre los candidatos saldría mal);
 *   · respaldo y pruebas: `telegramCandidates(export)` (o, repartido en varios
 *     pasos, `telegramScanText` + `telegramReduce`) reduce el export completo
 *     con las mismas fórmulas que metrics.js, y da cabeceras EXACTAS (suben y
 *     bajan incluidas). Si a runTelegram le llega el export completo, lo usa.
 *
 * Peticiones externas: como mucho 3 por mensaje (miniatura, sendPhoto y, si
 * la foto falla, sendMessage). Con 5 alertas + 2 diarios + 2 semanales son 27;
 * el tope duro es TELEGRAM_MAX_FETCH (50, el límite por invocación).
 *
 * Sin TELEGRAM_TOKEN o TELEGRAM_CHAT_ID no se envía nada: el mensaje sale por
 * console.log y cuenta como enviado (igual que notifier.py), para no repetir.
 */

import { CATEGORIES, EMERGING, EVENTS, SCAN_START, TELEGRAM } from "./config.js";
import { buildDashboard as metricsBuildDashboard, flagEvents, ROBLOX_SORT_POINTS } from "./metrics.js";
import { pyLen, pyRstrip } from "./horror.js";

export const TELEGRAM_MAX_FETCH = 50;
export const CAPTION_LIMIT = 1024;     // límite de Telegram para el texto de una foto
export const STATE_KEY = "telegram";
const THUMBS_API = "https://thumbnails.roblox.com/v1/games/multiget/thumbnails";
const DAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const DAY_MS = 864e5;
const DASHBOARD_URL = TELEGRAM.dashboard_url;

// ─── Formato (como notifier.py) ───────────────────────────────────────────────
/** html.escape(str(s or ""), quote=False) */
export function h(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * f"{x:.{d}f}" de Python: redondea el valor binario exacto y, en el empate
 * exacto, al par (toFixed de JS va al mayor). Solo hay empate si x·2^(d+1) es
 * un entero impar.
 */
export function pyFixed(x, d) {
  if (Object.is(x, -0)) return "-" + (0).toFixed(d);
  const q = x * 2 ** (d + 1);
  if (Number.isInteger(q) && q % 2 !== 0 && Math.abs(q) < 2 ** 52) {
    const y = x * 10 ** d, f = Math.floor(y);
    const n = f % 2 === 0 ? f : f + 1;
    const s = (n / 10 ** d).toFixed(d);
    return x < 0 && !s.startsWith("-") ? "-" + s : s;   // -0.5 → "-0"
  }
  return x.toFixed(d);
}

export function num(n) {
  if (n === null || n === undefined) return "—";
  for (const [div, suf] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
    if (n >= div) {
      const v = n / div;
      return (v >= 100 ? pyFixed(v, 0) : pyFixed(v, 1)) + suf;
    }
  }
  return String(Math.trunc(n));
}

/** f"{p:+.0f}%" */
export function pct(p) {
  if (p === null || p === undefined) return "—";
  const s = pyFixed(p, 0);
  return (s.startsWith("-") ? s : "+" + s) + "%";
}

/** Recorta por code points, como Python. */
export function short(title) {
  title = title || "?";
  if (pyLen(title) <= TELEGRAM.title_chars) return title;
  return pyRstrip(Array.from(title).slice(0, TELEGRAM.title_chars - 1).join("")) + "…";
}

/** str() de Python para ids (None si falta). */
const pyStr = v => (v === null || v === undefined ? "None" : v === true ? "True" : v === false ? "False" : String(v));

const gameLink = g =>
  `<a href="https://www.roblox.com/games/${pyStr(g.place_id)}">${h(short(g.title))}</a>`;

const cardLink = (key, g, text) => `<a href="${DASHBOARD_URL}#cat=${key}&amp;game=${pyStr(g.id)}">${text}</a>`;

/** La tendencia diaria; si es casi plana o no existe, el cambio de 24 h. */
export function growth(g, arrow = false) {
  const t = g.trend ?? null, g24 = g.growth_24h ?? null;
  let value, unit;
  if (t !== null && (Math.abs(t) >= 2 || g24 === null)) [value, unit] = [t, "/día"];
  else if (g24 !== null) [value, unit] = [g24, " 24h"];
  else return "⏳ midiendo";
  const icon = arrow ? (value >= 0 ? "📈 " : "📉 ") : "";
  return `${icon}${pct(value)}${unit}`;
}

/** Dos líneas: '🥇 Nombre' y '      └ 👥 39K · +33%/día · …'. */
function entry(i, g, extra = [], medals = true) {
  const mark = medals ? ({ 1: "🥇", 2: "🥈", 3: "🥉" }[i] ?? `${i}.`) : `${i}.`;
  const stats = [`👥 ${num(g.typical)}`, growth(g), ...extra].join(" · ");
  const flag = g.spike_now ? " 🎉" : "";
  return `${mark} ${gameLink(g)}${flag}\n      └ ${stats}`;
}

/** "vie 03/10" (UTC) */
export function todayLabel(now) {
  const d = toDate(now);
  const dd = String(d.getUTCDate()).padStart(2, "0"), mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${DAYS[(d.getUTCDay() + 6) % 7]} ${dd}/${mm}`;
}

// ─── Mensajes ─────────────────────────────────────────────────────────────────
/** → [texto, id del juego para la miniatura | null] */
export function dailyReport(key, cat, games, now) {
  const s = cat.stats, n = TELEGRAM.list_size;
  const emerging = cat.emerging.slice(0, n).map(u => games[String(u)]);
  const shown = new Set(emerging.map(g => g.id));
  const trending = cat.trending.map(u => games[String(u)]).filter(g => !shown.has(g.id)).slice(0, n);

  const lines = [
    `${cat.icon} <b>${h(cat.label.toUpperCase())}</b> · ${todayLabel(now)}`,
    // Sin cifras fiables de suben/bajan (export reducido sin ellas) se omiten:
    // mejor nada que un número contado solo sobre los candidatos
    s.rising == null || s.falling == null
      ? `<i>${s.games} juegos</i>`
      : `<i>${s.games} juegos · 📈 ${s.rising} suben · 📉 ${s.falling} bajan</i>`,
  ];
  if (emerging.length) {
    lines.push("", "🌱 <b>Emergentes</b>");
    emerging.forEach((g, i) => lines.push(entry(i + 1, g, [`⭐${g.emerging}`])));
  }
  if (trending.length) {
    lines.push("", "🔥 <b>En tendencia</b>");
    trending.forEach((g, i) => lines.push(entry(i + 1, g, [], false)));
  }
  if (!emerging.length && !trending.length) lines.push("", "Hoy no hay nada despegando. 😴");
  lines.push("", `📊 <a href="${DASHBOARD_URL}#cat=${key}">Abrir dashboard</a>`);

  const top = emerging[0] || trending[0] || null;
  return [lines.join("\n"), top?.id ?? null];
}

export function weeklyReport(key, cat, games, now) {
  const listed = cat.ids.map(u => games[String(u)]).filter(g => g.growth_7d !== null && g.growth_7d !== undefined);
  // sorted() de Python es estable, como Array.prototype.sort
  const up = [...listed].sort((a, b) => b.growth_7d - a.growth_7d).slice(0, TELEGRAM.list_size);
  const down = listed.filter(g => g.growth_7d < 0).sort((a, b) => a.growth_7d - b.growth_7d).slice(0, 3);
  const lines = [
    `📅 ${cat.icon} <b>${h(cat.label.toUpperCase())} · LA SEMANA</b>`,
    `<i>hasta el ${todayLabel(now)}</i>`,
    "", "🚀 <b>Lo que más ha crecido</b>",
    ...up.map((g, i) => entry(i + 1, g, [`7d ${pct(g.growth_7d)}`])),
  ];
  if (down.length) {
    lines.push("", "🧊 <b>Lo que más ha caído</b>",
      ...down.map((g, i) => entry(i + 1, g, [`7d ${pct(g.growth_7d)}`], false)));
  }
  lines.push("", `📊 <a href="${DASHBOARD_URL}#cat=${key}">Abrir dashboard</a>`);
  return [lines.join("\n"), up[0]?.id ?? null];
}

export function alertMessage(key, cat, g) {
  const creator = h(g.creator || "—") + (g.creator_verified ? " ✔" : "");
  const genre = h(g.subgenre || g.genre || "");
  const lines = [
    `🌱 <b>NUEVO EMERGENTE</b> · ${cat.icon} ${h(cat.label)}`,
    "",
    `<b>${h(g.title)}</b>`,
    `<i>${creator}${genre ? " · " + genre : ""}</i>`,
    "",
    `👥 <b>${num(g.typical)}</b> jugadores`,
    growth(g, true) + (growth(g).endsWith("/día") && g.growth_24h != null ? ` · ${pct(g.growth_24h)} en 24h` : ""),
    `👁 ${num(g.visits)} visitas` + (g.visits_day ? ` · +${num(g.visits_day)}/día` : ""),
  ];
  const extra = [];
  if (g.like_ratio != null) extra.push(`👍 ${pyFixed(g.like_ratio, 0)}%`);
  if (g.age_days != null) extra.push(`🗓 creado hace ${g.age_days} días`);
  if (extra.length) lines.push(extra.join(" · "));
  lines.push(
    "",
    `⭐ <b>${g.emerging}/100</b> — <i>${h((g.emerging_reasons || []).join(", "))}</i>`,
    "",
    `▶️ <a href="https://www.roblox.com/games/${pyStr(g.place_id)}">Jugar</a>   ·   📊 ${cardLink(key, g, "Ver ficha")}`,
  );
  return [lines.join("\n"), g.id ?? null];
}

/** Longitud que cuenta notifier.py: sin etiquetas, con entidades resueltas, en code points. */
export function visibleLen(message) {
  const text = message.replace(/<[^>]+>/g, "")
    .replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (m, dec, hex, name) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[name];
    });
  return pyLen(text);
}

// ─── Fechas ───────────────────────────────────────────────────────────────────
function toDate(now) {
  if (now instanceof Date) return now;
  if (now === null || now === undefined) return new Date();
  return new Date(typeof now === "number" ? now : String(now));
}

const isoDay = d => d.toISOString().slice(0, 10);

/** strftime("%G-W%V") */
export function isoWeek(now) {
  const d = toDate(now);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (t.getUTCDay() + 6) % 7;            // lunes = 0
  t.setUTCDate(t.getUTCDate() - dow + 3);         // el jueves de esa semana
  const year = t.getUTCFullYear();
  const week = 1 + Math.floor((t - Date.UTC(year, 0, 1)) / DAY_MS / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// ─── Prefiltro de candidatos y cifras de cabecera ────────────────────────────
// Mismas fórmulas que metrics.js (que a su vez es el port de analytics.py),
// pero solo lo que hace falta para decidir quién puede salir en un mensaje y
// para contar suben/bajan. Si metrics.js cambia una fórmula, aquí solo afecta
// a qué juegos se pasan a buildDashboard (hay margen) y a la cabecera; el
// contenido de los mensajes sale siempre de buildDashboard.

// Márgenes: se pasan más juegos de los que caben en los mensajes, por si el
// cálculo reducido y el completo difieren en algún borde.
const PICK = {
  emerging_margin: 10,     // puntos por debajo de EMERGING.min_score que aún se pasan
  emerging_top: 30,        // los N mejores emergentes (estimados) de cada categoría
  trending_top: 18,        // en tendencia: TRENDING_MAX (12) + margen, por categoría
  weekly_up: 8,            // semanal: se muestran 5 y 3
  weekly_down: 6,
};

/** round(x) de Python (empate al par). */
function pyRound0(x) {
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
/** round(x, nd) de Python (mismo criterio que metrics.js). */
function pyRound(x, nd) {
  const p = 10 ** nd, y = x * p;
  const f = Math.floor(y), d = y - f;
  if (Math.abs(d - 0.5) > 1e-6 && Math.abs(y) < 1e9) return (d < 0.5 ? f : f + 1) / p;
  const q = x * 2 ** (nd + 1);
  if (Number.isInteger(q) && q % 2 !== 0) return (f % 2 === 0 ? f : f + 1) / p;
  return Number(x.toFixed(nd));
}
const pctNum = (nw, old) => (nw === null || !old ? null : pyRound((nw - old) * 100 / old, 1));
const clip = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

let BUF = new Float64Array(64);
function median(n) {           // mediana de BUF[0..n)
  const b = BUF;
  for (let i = 1; i < n; i++) {
    const v = b[i];
    let j = i - 1;
    while (j >= 0 && b[j] > v) { b[j + 1] = b[j]; j--; }
    b[j + 1] = v;
  }
  const k = n >> 1;
  return n % 2 ? b[k] : (b[k - 1] + b[k]) / 2;
}
function buf(n) {
  if (BUF.length < n) BUF = new Float64Array(Math.max(n, BUF.length * 2));
  return BUF;
}

const ISO_RE = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d)(?:[.,](\d{1,3}))?\d*)?)?/;
function isoMs(s) {
  const m = s ? ISO_RE.exec(s) : null;
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0),
    m[7] ? +(m[7] + "00").slice(0, 3) : 0);
  return Number.isNaN(ms) ? null : ms;
}
const dayNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS;

function status(g24, t) {
  if (g24 === null && t === null) return "new";
  const g = g24 || 0;
  if ((t !== null && t >= 15) || (g >= 30 && (t === null || t >= 0))) return "hot";
  if ((t !== null && t >= 5) || (g >= 10 && (t === null || t >= -1))) return "up";
  if ((t !== null && t <= -8) || (g <= -20 && (t === null || t <= 0))) return "down2";
  if ((t !== null && t <= -3) || (g <= -7 && (t === null || t <= 1))) return "down";
  return "flat";
}

const LOG_SIZE = Math.log10(1_000_000 / 300), LOG30 = Math.log10(30);

// Búferes reutilizados: en frío (isolate recién creado) la basura y las
// llamadas pesan mucho más que en caliente.
const VALS = new Float64Array(64), CLEAN = new Float64Array(64), EV = new Uint8Array(64);
const SM = new Float64Array(8);
let LOGX = new Float64Array(8), LOGY = new Float64Array(8);
const TAIL = 11;   // días del final cuyos eventos importan (g7 mira 10, la tendencia 8)

/** Mediana de arr[lo..hi) (n ≤ 8) sin tocar arr. */
function smallMedian(arr, lo, hi) {
  const n = hi - lo;
  for (let i = 0; i < n; i++) {
    const v = arr[lo + i];
    let j = i - 1;
    while (j >= 0 && SM[j] > v) { SM[j + 1] = SM[j]; j--; }
    SM[j + 1] = v;
  }
  const k = n >> 1;
  return n % 2 ? SM[k] : (SM[k - 1] + SM[k]) / 2;
}

/** analytics.flag_events para el día i (VALS[0..n), fechas en d[off + i][0]). */
function isEvent(i, n, d, off) {
  const w = EVENTS.window_days >> 1;
  const lo = Math.max(0, i - w), hi = Math.min(n, i + 1 + w);
  if (i - lo < 2 || hi - i - 1 === 0) return false;
  const base = Math.max(smallMedian(VALS, lo, i), smallMedian(VALS, i + 1, hi));
  const v = VALS[i];
  if (!(v > base * EVENTS.min_ratio)) return false;
  const nb = new Float64Array(8);
  let k = 0;
  for (let j = lo; j < hi; j++) if (j !== i) nb[k++] = VALS[j];
  const m = smallMedian(nb, 0, k);
  for (let j = 0; j < k; j++) nb[j] = Math.abs(nb[j] - m);
  const mad = Math.max(smallMedian(nb, 0, k) * 1.4826, m * 0.05);
  if (!((v - base) > EVENTS.mad_k * mad)) return false;
  // ¿Se explica por el día de la semana? (mismo día de hace 7 y 14 días)
  const di = dayNum(d[off + i][0]);
  let maxSame = null;
  for (const back of [7, 14]) {
    for (let j = n - 1; j >= 0; j--) {
      if (dayNum(d[off + j][0]) === di - back) {
        const x = VALS[j];
        if (x && (maxSame === null || x > maxSame)) maxSame = x;
        break;
      }
    }
  }
  return !(maxSame !== null && v < maxSame * EVENTS.min_ratio);
}

/**
 * Días de evento en EV[0..n). Solo hacen falta los del final (TAIL días, que
 * contienen todo lo que miran g7, la tendencia, el "ayer" y los 8 días limpios
 * del pico); si ahí hay demasiados eventos, se calculan todos. Atajo exacto:
 * si en la ventana max ≤ min_ratio·min, ningún día puede ser evento.
 */
function markEvents(d, off, n) {
  EV.fill(0, 0, n);
  let from = Math.max(0, n - TAIL);
  for (let pass = 0; pass < 2; pass++) {
    let mn = Infinity, mx = -Infinity;
    for (let i = Math.max(0, from - (EVENTS.window_days >> 1)); i < n; i++) {
      const v = VALS[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mn > 0 && mx <= mn * EVENTS.min_ratio) return;
    let clean = 0;
    for (let i = from; i < n; i++) {
      EV[i] = isEvent(i, n, d, off) ? 1 : 0;
      if (!EV[i]) clean++;
    }
    if (from === 0 || clean >= 9) return;
    from = 0;   // pocos días limpios al final: hacen falta los anteriores
  }
}

/** analytics.theil_sen_daily_growth sobre CLEAN[lo..hi) (índices relativos, contando los ≤ 0). */
function theilSenClean(lo, hi) {
  let n = 0;
  if (LOGX.length < hi - lo) { LOGX = new Float64Array(hi - lo); LOGY = new Float64Array(hi - lo); }
  for (let i = lo; i < hi; i++) if (CLEAN[i] > 0) { LOGX[n] = i - lo; LOGY[n] = Math.log(CLEAN[i]); n++; }
  if (n < 4) return null;
  const b = buf(n * (n - 1) / 2);
  let k = 0;
  for (let a = 0; a < n; a++) for (let c = a + 1; c < n; c++) b[k++] = (LOGY[c] - LOGY[a]) / (LOGX[c] - LOGX[a]);
  return pyRound((Math.exp(median(k)) - 1) * 100, 1);
}

/** Visitas ganadas por día (game_metrics), o null. */
function visitsDay(d, s) {
  const n = d.length, ns = s.length;
  let vday = null, i1 = ns - 1;
  while (i1 >= 0 && !s[i1][2]) i1--;
  if (i1 >= 0) {
    const t1 = s[i1][0], v1 = s[i1][2];
    for (let i = i1 - 1; i >= 0; i--) {
      if (s[i][2] && s[i][0] <= t1 - 1200) {
        vday = pyRound0((v1 - s[i][2]) * 86400 / Math.max((t1 - s[i][0]) * 60, 1));
        break;
      }
    }
  }
  if (vday === null) {
    let a = -1, z = -1;
    for (let i = n - 1; i >= 0; i--) if (d[i][5]) { if (z < 0) z = i; else { a = i; break; } }
    if (a >= 0) vday = pyRound0((d[z][5] - d[a][5]) / ((dayNum(d[z][0]) - dayNum(d[a][0])) || 1));
  }
  return vday !== null && vday < 0 ? null : vday;
}

/** Las partes del score de emergente que no dependen de la tendencia. */
function emergingParts(g, typ, visits, ctx) {
  let sRoblox = 0;
  if (g.sorts) for (const k of EMERGING.roblox_sorts || []) {
    if (g.sorts[k] != null) sRoblox = Math.max(sRoblox, ROBLOX_SORT_POINTS[k] ?? 10);
  }
  const d = g.d;
  let seen = g.first_day ? dayNum(g.first_day) : (d.length ? dayNum(d[0][0]) : null);
  const fsMs = isoMs(g.first_seen);
  if (fsMs !== null) {
    const fs = Math.floor(fsMs / DAY_MS);
    if (seen === null || fs < seen) seen = fs;
  }
  const fresh = seen !== null && seen >= ctx.scanStart + 2 && ctx.today - seen <= 3;
  const vday = visitsDay(d, g.s || []);
  const vg = visits && vday ? pyRound(vday * 100 / visits, 2) : 0;
  const created = isoMs(g.created);
  const age = created !== null ? Math.floor((ctx.nowMs - created) / DAY_MS) : null;
  let sYoung = age !== null ? 20 * clip(1 - age / EMERGING.max_age_days) : 0;
  if (fresh) sYoung = Math.max(sYoung, 8);
  const up = g.up ?? null, down = g.down ?? null;
  const lr = up !== null && down !== null && up + down > 0 ? pyRound(up * 100 / (up + down), 1) : null;
  return {
    sRoblox, fresh, sVisits: 30 * clip(vg / 12), sYoung,
    sSize: 15 * clip(Math.log10(typ / EMERGING.min_players) / LOG30), sLike: 10 * clip(((lr || 0) - 75) / 20),
  };
}

/** Typical (mediana de 24 h) y visitas: lo barato, para todos los juegos. */
function basics(g) {
  const d = g.d, s = g.s || [];
  const n = d.length, ns = s.length;
  let typical, n24 = 0;
  if (ns) {
    const ref = s[ns - 1][0], b = buf(ns);
    for (let i = ns - 1; i >= 0; i--) {
      const t = s[i][0];
      if (t < ref - 1440) break;
      if (t < ref + 1) b[n24++] = s[i][1];
    }
    if (n24 >= 2) typical = median(n24);
  }
  if (n24 < 2) typical = n ? d[n - 1][1] : (ns ? s[ns - 1][1] : 0);
  let visits = null;
  for (let i = n - 1; i >= 0; i--) if (d[i][5]) { visits = d[i][5]; break; }
  return { typical, typicalR: typical != null ? pyRound0(typical) : null, visits };
}

/** El resto de game_metrics + status + momentum + emerging (sin motivos). */
function details(g, b, ep, ctx) {
  const d = g.d, s = g.s || [];
  const n = Math.min(d.length, 64), ns = s.length;
  const off = d.length - n;               // el export trae 21 días; por si acaso
  for (let i = 0; i < n; i++) VALS[i] = d[off + i][1];
  markEvents(d, off, n);
  const ref = ns ? s[ns - 1][0] : ctx.nowMin;
  const nowPlayers = ns ? s[ns - 1][1] : (n ? VALS[n - 1] : 0);

  let prev = null, nprev = 0;
  if (ns) {
    const bb = buf(ns);
    for (let i = ns - 1; i >= 0; i--) {
      const t = s[i][0];
      if (t < ref - 2880) break;
      if (t < ref - 1440) bb[nprev++] = s[i][1];
    }
    if (nprev >= 2) prev = median(nprev);
  }
  if (nprev < 2) {
    prev = null;
    for (let i = n - 2; i >= 0; i--) if (!EV[i]) { prev = VALS[i]; break; }
  }
  const g24 = pctNum(b.typical, prev);

  let s3 = 0, c3 = 0, sw = 0, cw = 0;
  for (let i = Math.max(0, n - 3); i < n; i++) if (!EV[i]) { s3 += VALS[i]; c3++; }
  for (let i = Math.max(0, n - 10), e = Math.max(0, n - 6); i < e; i++) if (!EV[i]) { sw += VALS[i]; cw++; }
  const g7 = c3 && cw ? pctNum(s3 / c3, sw / cw) : null;

  let nc = 0, c8 = 0;
  for (let i = 0; i < n; i++) if (!EV[i]) { CLEAN[nc++] = VALS[i]; if (i >= n - 8) c8++; }
  const t = theilSenClean(nc - c8, nc);
  let base7 = null;
  if (nc >= 4) {
    const lo = Math.max(0, nc - 8), bb = buf(nc);
    for (let i = lo; i < nc - 1; i++) bb[i - lo] = CLEAN[i];
    base7 = median(nc - 1 - lo);
  }
  const spike = !!(base7 && nowPlayers >= base7 * EVENTS.spike_now_ratio);
  const st = status(g24, t);

  const size = clip(Math.log10(Math.max(b.typicalR || 1, 1) / 300) / LOG_SIZE);
  let mom = 35 * clip((t || 0) / 20) + 25 * clip((g24 || 0) / 50) + 20 * clip((g7 || 0) / 100) + 20 * size;
  if (spike && (t || 0) < 5) mom *= 0.7;
  const rising = (st === "hot" || st === "up") && (t === null || t > 0) && !(spike && (t || 0) < 5);

  let em = null;
  if (ep) {
    const growing = (t !== null && t > 0) || (g24 !== null && g24 > 0) || (g7 !== null && g7 > 0)
      || (ep.sRoblox > 0 && t === null && g24 === null && g7 === null);
    if ((growing || ep.fresh) && st !== "down" && st !== "down2") {
      const growth = Math.max(t || 0, (g24 || 0) / 2, (g7 || 0) / 5);
      // mismo orden de sumas que metrics.js (el redondeo depende de él)
      em = Math.min(100, pyRound0(ep.sVisits + 25 * clip(growth / 20) + ep.sYoung + ep.sSize + ep.sLike + ep.sRoblox));
      if (spike && (t || 0) < 5) em = pyRound0(em * 0.8);
    }
  }
  return { st: STATUS_CODE[st], rising: rising ? 1 : 0, momentum: pyRound0(mom), g7, em };
}

const STATUS_CODE = { new: 0, flat: 1, hot: 2, up: 3, down: 4, down2: 5 };
const CATS = Object.entries(CATEGORIES);

/**
 * El cálculo reducido de cada juego que puede importar (pertenece a una
 * categoría o puede ser emergente). Devuelve filas pequeñas y serializables,
 * así que se puede repartir el export entre varios pasos y juntar luego las
 * filas (ver telegramScanText / telegramReduce).
 * → [{ id, typical, cat (bit por categoría), st, rising, momentum, g7, em }]
 */
export function quickRows(games, { now } = {}) {
  const nowMs = toDate(now).getTime();
  const today = Math.floor(nowMs / DAY_MS);
  const ctx = { nowMs, nowMin: nowMs / 60000, today, scanStart: dayNum(SCAN_START) };
  const activeCut = new Date((today - 2) * DAY_MS).toISOString().slice(0, 10);
  const rows = [];
  for (const g of games) {
    const d = g.d;
    if (!d || !d.length || d[d.length - 1][0] < activeCut) continue;   // como buildDashboard
    const b = basics(g);
    const typ = b.typicalR || 0;
    let cat = 0;
    CATS.forEach(([, c], ci) => {
      if ((c.classifier === "all" || g.horror) && typ >= c.min_players) cat |= 1 << ci;
    });
    const pool = b.visits !== null && b.visits <= EMERGING.max_visits && typ >= EMERGING.min_players;
    if (!pool && !cat) continue;
    const ep = pool ? emergingParts(g, typ, b.visits, ctx) : null;
    // Cota superior exacta del emergente (crecimiento al máximo, sin penalización):
    // si ni así llega, y el juego no está en ninguna categoría, no hace falta más.
    if (!cat && Math.min(100, ep.sVisits + 25 + ep.sYoung + ep.sSize + ep.sLike + ep.sRoblox) + 1
        < EMERGING.min_score - PICK.emerging_margin) continue;
    rows.push({ id: g.id, horror: g.horror ? 1 : 0, typical: b.typicalR, cat, ...details(g, b, ep, ctx) });
  }
  return rows;
}

/** De las filas de quickRows: cifras de cabecera e ids de los candidatos. */
export function pickCandidates(rows) {
  const picked = new Set();
  const counts = {};
  const UP = [STATUS_CODE.hot, STATUS_CODE.up], DOWN = [STATUS_CODE.down, STATUS_CODE.down2];
  CATS.forEach(([key, cfg], ci) => {
    const bit = 1 << ci;
    const ids = rows.filter(r => r.cat & bit);
    let players = 0, rising = 0, falling = 0;
    for (const r of ids) {
      players += r.typical || 0;
      if (UP.includes(r.st)) rising++;
      if (DOWN.includes(r.st)) falling++;
    }
    counts[key] = { games: ids.length, players, rising, falling };
    // emergentes: los de la categoría (horror: los juegos de horror, aunque no lleguen al mínimo)
    const belongs = cfg.classifier === "all" ? () => true : r => r.horror;
    rows.filter(r => belongs(r) && r.em !== null && r.em >= EMERGING.min_score - PICK.emerging_margin)
      .sort((a, b) => b.em - a.em).slice(0, PICK.emerging_top).forEach(r => picked.add(r.id));
    ids.filter(r => r.rising).sort((a, b) => b.momentum - a.momentum)
      .slice(0, PICK.trending_top).forEach(r => picked.add(r.id));
    const w = ids.filter(r => r.g7 !== null);
    [...w].sort((a, b) => b.g7 - a.g7).slice(0, PICK.weekly_up).forEach(r => picked.add(r.id));
    w.filter(r => r.g7 < 0).sort((a, b) => a.g7 - b.g7).slice(0, PICK.weekly_down).forEach(r => picked.add(r.id));
  });
  return { counts, ids: picked };
}

/**
 * Reduce el export a los juegos que pueden salir en los mensajes y calcula
 * las cifras de cabecera de cada categoría con TODOS los juegos.
 * → { generated_at, last_sample, samples_24h, games: [...],
 *     telegram: { counts: { <cat>: {games, players, rising, falling} }, total, candidates } }
 */
export function telegramCandidates(exportData, { now } = {}) {
  const all = exportData.games || [];
  const { counts, ids } = pickCandidates(quickRows(all, { now: now ?? exportData.generated_at }));
  return reducedExport(exportData, all.filter(g => ids.has(g.id)), counts, all.length);
}

function reducedExport(head, games, counts, total) {
  return {
    generated_at: head.generated_at ?? null,
    last_sample: head.last_sample ?? null,
    samples_24h: head.samples_24h ?? 0,
    games,
    telegram: { counts, total, candidates: games.length },
  };
}

// ─── El mismo prefiltro, repartido en varios pasos ───────────────────────────
// JSON.parse del export entero (~1 MB) ya cuesta casi los 10 ms. El export lo
// escribe SQLite con json_object, sin espacios, y cada juego empieza por
// {"id": (dentro de un texto JSON las comillas van escapadas, así que esa
// secuencia solo aparece al empezar un juego). Así se puede trocear el texto
// sin parsearlo entero:
//   paso k de N:  rows_k = telegramScanText(text, { now, part: k, parts: N })
//   último paso:  reduced = telegramReduce(text, [rows_0, …, rows_N-1])
//                 await runTelegram({ …, exportData: reduced })

const GAME_START = '{"id":';

/** Posiciones de inicio de cada juego en el texto del export (y el fin del array). */
export function gameOffsets(text) {
  const g = text.indexOf('"games":[');
  if (g < 0) throw new Error("export sin games");
  const out = [];
  let i = text.indexOf(GAME_START, g);
  while (i >= 0) {
    out.push(i);
    i = text.indexOf("}," + GAME_START, i + 1);
    if (i >= 0) i += 2;
  }
  if (!out.length && !/"games":\[\s*\]/.test(text)) {
    throw new Error('export con un formato inesperado: cada juego debe empezar por {"id": sin espacios');
  }
  out.push(text.lastIndexOf("]"));   // cierre del array de juegos (el export termina en "]}")
  return out;
}

/** Cabecera del export (generated_at, last_sample, samples_24h) sin parsear los juegos. */
export function exportHead(text) {
  const pick = re => {
    const m = re.exec(text);
    return m ? JSON.parse(m[1]) : null;
  };
  return {
    generated_at: pick(/"generated_at":("[^"]*"|null)/),
    last_sample: pick(/"last_sample":("[^"]*"|null)/),
    samples_24h: pick(/"samples_24h":(\d+|null)/) ?? 0,
  };
}

function parseSlice(text, offs, a, b) {
  if (a >= b) return [];
  let end = offs[b];
  // offs[b] es el inicio del juego siguiente (precedido de ",") o el "]" final
  const slice = text.slice(offs[a], end).replace(/,\s*$/, "");
  return JSON.parse("[" + slice + "]");
}

/** Paso k de N del prefiltro: filas de quickRows de su trozo de juegos. */
export function telegramScanText(text, { now, part = 0, parts = 1 } = {}) {
  const offs = gameOffsets(text), n = offs.length - 1;
  const a = Math.floor(n * part / parts), b = Math.floor(n * (part + 1) / parts);
  const games = parseSlice(text, offs, a, b);
  return quickRows(games, { now: now ?? exportHead(text).generated_at });
}

/** Último paso: junta las filas, elige candidatos y parsea solo esos juegos. */
export function telegramReduce(text, rowParts) {
  const rows = rowParts.flat();
  const { counts, ids } = pickCandidates(rows);
  const offs = gameOffsets(text), games = [];
  for (let k = 0; k < offs.length - 1; k++) {
    // el id va justo después de {"id":
    const p = offs[k] + GAME_START.length;
    const id = Number(text.slice(p, text.indexOf(",", p)));
    if (ids.has(id)) games.push(...parseSlice(text, offs, k, k + 1));
  }
  return reducedExport(exportHead(text), games, counts, offs.length - 1);
}

/**
 * Cifras de cabecera de un export reducido:
 *   · `telegram.counts` (telegramCandidates/telegramReduce): exactas;
 *   · `totals` (data/telegram.json del backend): { <cat>: n } o
 *     { <cat>: { games, players?, rising?, falling? } }.
 * → { <cat>: { games, players?, rising, falling } } o null si no es un export reducido.
 */
export function headerCounts(exportData) {
  if (exportData?.telegram?.counts) return exportData.telegram.counts;
  const totals = exportData?.totals;
  if (!totals || typeof totals !== "object") return null;
  const out = {};
  for (const [key, v] of Object.entries(totals)) {
    const c = typeof v === "number" ? { games: v } : { ...(v || {}) };
    // lo que no venga no se toma de los candidatos (saldría mal): se omite
    if (c.rising == null || c.falling == null) { c.rising = null; c.falling = null; }
    out[key] = c;
  }
  return out;
}

/** Pone en el dashboard reducido las cifras de cabecera calculadas con todo el export. */
function applyCounts(dash, counts) {
  if (!counts) return;
  for (const [key, c] of Object.entries(counts)) {
    const cat = dash.categories?.[key];
    if (!cat) continue;
    const st = { ...cat.stats };
    for (const [k, v] of Object.entries(c)) if (v !== undefined) st[k] = v;
    cat.stats = st;
  }
}

// ─── Envío ────────────────────────────────────────────────────────────────────
function makeClient({ env, fetchImpl, log, maxFetch }) {
  const token = env?.TELEGRAM_TOKEN, chat = env?.TELEGRAM_CHAT_ID;
  const counter = { used: 0 };

  async function call(url, init, timeoutMs) {
    if (counter.used >= maxFetch) throw new Error(`tope de ${maxFetch} peticiones externas`);
    counter.used++;
    return fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  }

  /** Miniatura 16:9 del juego, pedida a Roblox en el momento (no se guarda). */
  async function thumbUrl(uid) {
    if (!uid) return null;
    try {
      const q = new URLSearchParams({
        universeIds: String(uid), countPerUniverse: "1", size: "768x432", format: "Jpeg", defaults: "true",
      });
      const r = await call(`${THUMBS_API}?${q}`, {}, 15000);
      const j = await r.json();
      const shots = ((j?.data || [{}])[0] || {}).thumbnails || [];
      return shots.find(s => s.state === "Completed")?.imageUrl ?? null;
    } catch {
      return null;
    }
  }

  async function post(method, body, timeoutMs) {
    try {
      const r = await call(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }, timeoutMs);
      return { ok: r.ok, status: r.status, text: r.ok ? "" : await r.text().catch(() => "") };
    } catch (e) {
      // Nunca se registra la URL: lleva el token
      return { ok: false, status: 0, text: String(e?.name === "TimeoutError" ? "timeout" : e?.message || e) };
    }
  }

  /** Envía el mensaje; si hay juego, con su miniatura como foto. */
  async function send(message, gameId) {
    if (!token || !chat) {
      log(`--- mensaje (no enviado)${gameId ? ` · foto del juego ${gameId}` : ""} ---`);
      log(message);
      return true;   // sin credenciales cuenta como "hecho" para no repetir
    }
    // Con foto si cabe en el pie de foto; si falla la imagen, como texto
    const photo = visibleLen(message) <= CAPTION_LIMIT ? await thumbUrl(gameId) : null;
    if (photo) {
      const r = await post("sendPhoto", { chat_id: chat, photo, caption: message, parse_mode: "HTML" }, 20000);
      if (r.ok) return true;
      log(`  foto rechazada (${r.status}), se envía como texto`);
    }
    const r = await post("sendMessage", {
      chat_id: chat, text: message, parse_mode: "HTML", link_preview_options: { is_disabled: true },
    }, 15000);
    if (!r.ok) log(`✗ Telegram ${r.status}: ${r.text}`);
    return r.ok;
  }

  return { send, counter, hasCredentials: Boolean(token && chat) };
}

/**
 * Decide qué toca y lo envía.
 *   env: { TELEGRAM_TOKEN, TELEGRAM_CHAT_ID }
 *   exportData: el export completo (R2 data/export.json) o el que devuelve telegramCandidates()
 *   now: Date | ISO | ms
 *   getState(key) / setState(key, value) o setState(value): estado en D1 (clave "telegram")
 *   force: undefined | 'daily' | 'weekly'  (como --daily / --weekly)
 * Opcionales (pruebas): fetch, buildDashboard, log, maxFetch, quickExit (false = calcular siempre).
 */
export async function runTelegram({
  env, exportData, now, getState, setState, force,
  fetch: fetchImpl = globalThis.fetch, buildDashboard = metricsBuildDashboard,
  log = (...a) => console.log(...a), maxFetch = TELEGRAM_MAX_FETCH, quickExit = true,
}) {
  const nowD = toDate(now);
  const today = isoDay(nowD), week = isoWeek(nowD), hour = nowD.getUTCHours();
  const weekday = (nowD.getUTCDay() + 6) % 7;

  // Export reducido (data/telegram.json del backend, con `totals`, o el de
  // telegramCandidates/telegramReduce, con `telegram`) tal cual; el completo
  // se reduce aquí (respaldo: cuesta más CPU).
  const reduced = exportData?.telegram || exportData?.totals ? exportData : telegramCandidates(exportData, { now: nowD });

  const loaded = getState ? await getState(STATE_KEY) : null;
  const state = loaded && typeof loaded === "object" ? structuredClone(loaded) : {};
  const before = JSON.stringify(state);
  const client = makeClient({ env, fetchImpl, log, maxFetch });
  const result = {
    credentials: client.hasCredentials, alerts: 0, daily: null, weekly: null, messages: 0,
    candidates: reduced.games?.length ?? null, total: reduced.telegram?.total ?? null,
    header: headerCounts(reduced) ? (reduced.telegram ? "exacta" : "totals") : "candidatos",
  };
  const dueDaily = force === "daily" || (hour >= TELEGRAM.report_hour_utc && state.last_daily !== today);
  const dueWeekly = force === "weekly"
    || (weekday === 0 && hour >= TELEGRAM.report_hour_utc && state.last_weekly !== week);

  // Atajo (6 de cada 8 pasadas): sin diario ni semanal, solo hace falta
  // buildDashboard si algún juego aún sin avisar puede llegar a alerta. El
  // cálculo reducido da el mismo score que metrics.js (test/telegram.test.mjs);
  // se deja un margen de 5 puntos.
  if (quickExit && !dueDaily && !dueWeekly) {
    const alerted = state.alerted || {};
    const maybe = quickRows(reduced.games || [], { now: nowD })
      .some(r => r.em !== null && r.em >= TELEGRAM.alert_min_score - 5 && !(String(r.id) in alerted));
    if (!maybe) return { ...result, skipped: "sin alertas posibles", fetches: 0 };
  }

  const dash = buildDashboard(reduced, { now: nowD });
  applyCounts(dash, headerCounts(reduced));
  const games = dash.games, cats = dash.categories;

  const save = async () => {
    if (!setState || JSON.stringify(state) === before) return;
    // setState(key, value) (db.js) o setState(value)
    if (setState.length >= 2) await setState(STATE_KEY, state);
    else await setState(state);
  };

  try {
    // Alertas de emergentes (una sola vez por juego, aunque esté en dos categorías)
    const alerted = (state.alerted ||= {});
    for (const [key, cat] of Object.entries(cats)) {
      for (const uid of cat.emerging) {
        const g = games[String(uid)];
        if (g.emerging >= TELEGRAM.alert_min_score && !(String(uid) in alerted)
            && result.alerts < TELEGRAM.max_alerts_per_run) {
          result.messages++;
          if (await client.send(...alertMessage(key, cat, g))) {
            alerted[String(uid)] = today;
            result.alerts++;
          }
        }
      }
    }

    if (dueDaily) {
      const ok = [];
      for (const [key, cat] of Object.entries(cats)) {
        result.messages++;
        ok.push(await client.send(...dailyReport(key, cat, games, nowD)));
      }
      result.daily = ok.every(Boolean);
      if (result.daily) state.last_daily = today;
    }

    if (dueWeekly) {
      const ok = [];
      for (const [key, cat] of Object.entries(cats)) {
        result.messages++;
        ok.push(await client.send(...weeklyReport(key, cat, games, nowD)));
      }
      result.weekly = ok.every(Boolean);
      if (result.weekly) state.last_weekly = week;
    }
  } finally {
    // Lo enviado queda guardado aunque algo falle a medias (el paso se reintenta)
    await save();
  }
  result.fetches = client.counter.used;
  return result;
}
