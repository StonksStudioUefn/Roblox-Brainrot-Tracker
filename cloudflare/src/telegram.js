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

import { CATEGORIES, EMERGING, TELEGRAM } from "./config.js";
import { buildDashboard as metricsBuildDashboard, isRising, quickMetrics } from "./metrics.js";
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
  emerging_top: 30,        // los N mejores emergentes de cada categoría (EMERGING.max_results + margen)
  trending_top: 18,        // en tendencia: TRENDING_MAX (12) + margen, por categoría
  weekly_up: 8,            // semanal: se muestran 5 y 3
  weekly_down: 6,
};

const STATUS_CODE = { new: 0, flat: 1, hot: 2, up: 3, down: 4, down2: 5 };
const CATS = Object.entries(CATEGORIES);

/**
 * Las cifras de cada juego que puede importar (pertenece a una categoría o
 * puede ser emergente), con las mismas funciones que el dashboard
 * (quickMetrics de metrics.js). Devuelve filas pequeñas y serializables, así
 * que se puede repartir el export entre varios pasos y juntar luego las filas
 * (ver telegramScanText / telegramReduce).
 * → [{ id, horror, typical, cat (bit por categoría), st, rising, momentum, g7, em }]
 */
export function quickRows(games, { now } = {}) {
  const rows = [];
  for (const { g, m, em } of quickMetrics(games, { now: toDate(now) })) {
    const typ = m.typical || 0;
    let cat = 0;
    CATS.forEach(([, c], ci) => {
      if ((c.classifier === "all" || g.horror) && typ >= c.min_players) cat |= 1 << ci;
    });
    if (!cat && !em) continue;
    rows.push({
      id: g.id, horror: g.horror ? 1 : 0, typical: m.typical, cat, st: STATUS_CODE[m.status],
      rising: isRising(m) ? 1 : 0, momentum: m.momentum, g7: m.growth_7d, em: em ? em[0] : null,
    });
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
    rows.filter(r => belongs(r) && r.em !== null)
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
/**
 * Chat al que se envía: TELEGRAM_CHAT_ID o, si Telegram dijo que ese grupo
 * pasó a supergrupo, el id nuevo guardado en el estado ({from, to}). Solo se
 * usa mientras el secret siga siendo el id antiguo: si alguien lo cambia, manda él.
 */
export function chatFor(envChat, migrated) {
  if (envChat && migrated?.to && String(migrated.from) === String(envChat)) return String(migrated.to);
  return envChat;
}

function makeClient({ env, fetchImpl, log, maxFetch, migrated }) {
  const token = env?.TELEGRAM_TOKEN;
  let chat = chatFor(env?.TELEGRAM_CHAT_ID, migrated);
  const counter = { used: 0 };
  const moved = { to: null };   // id nuevo si Telegram avisa de que el grupo ha migrado

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

  async function post(method, body, timeoutMs, retry = true) {
    let res;
    try {
      const r = await call(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, chat_id: chat }),
      }, timeoutMs);
      res = { ok: r.ok, status: r.status, text: r.ok ? "" : await r.text().catch(() => "") };
    } catch (e) {
      // Nunca se registra la URL: lleva el token
      return { ok: false, status: 0, text: String(e?.name === "TimeoutError" ? "timeout" : e?.message || e) };
    }
    // El grupo pasó a supergrupo: Telegram da el id nuevo. Se sigue a ese id
    // (y runTelegram lo guarda en el estado para los siguientes envíos).
    const to = res.ok ? null : migrateTo(res.text);
    if (to && retry && String(to) !== String(chat)) {
      log(`  el grupo ahora es un supergrupo: se envía al id nuevo ${to}`);
      chat = String(to);
      moved.to = chat;
      return post(method, body, timeoutMs, false);
    }
    return res;
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
      const r = await post("sendPhoto", { photo, caption: message, parse_mode: "HTML" }, 20000);
      if (r.ok) return true;
      log(`  foto rechazada (${r.status}), se envía como texto`);
    }
    const r = await post("sendMessage", {
      text: message, parse_mode: "HTML", link_preview_options: { is_disabled: true },
    }, 15000);
    if (!r.ok) log(`✗ Telegram ${r.status}: ${r.text}`);
    return r.ok;
  }

  return { send, counter, moved, hasCredentials: Boolean(token && chat) };
}

/** migrate_to_chat_id de una respuesta de error de Telegram, o null. */
function migrateTo(text) {
  try {
    const id = JSON.parse(text)?.parameters?.migrate_to_chat_id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
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
  const client = makeClient({ env, fetchImpl, log, maxFetch, migrated: state.chat_migrated });
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
    if (client.moved.to) {
      state.chat_migrated = { from: String(env.TELEGRAM_CHAT_ID), to: client.moved.to };
      result.chat_migrated = client.moved.to;
    }
    // Lo enviado queda guardado aunque algo falle a medias (el paso se reintenta)
    await save();
  }
  result.fetches = client.counter.used;
  return result;
}
