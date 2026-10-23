// Port de notifier.py: los textos son EXACTAMENTE los suyos (test/telegram.test.mjs).

import { CATEGORIES, EMERGING, TELEGRAM } from "./config.js";
import { buildDashboard as metricsBuildDashboard, inCategory, isDown, isRising, pyFixed, quickMetrics } from "./metrics.js";
import { pyLen, pyRstrip } from "./horror.js";

const TELEGRAM_MAX_FETCH = 50;
const CAPTION_LIMIT = 1024;     // límite de Telegram para el texto de una foto
const STATE_KEY = "telegram";
const THUMBS_API = "https://thumbnails.roblox.com/v1/games/multiget/thumbnails";
const DAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];
const DAY_MS = 864e5;
const DASHBOARD_URL = TELEGRAM.dashboard_url;

export { pyFixed };

function h(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

export function pct(p) {
  if (p === null || p === undefined) return "—";
  const s = pyFixed(p, 0);
  return (s.startsWith("-") ? s : "+" + s) + "%";
}

/** Recorta por code points, como Python. */
function short(title) {
  title = title || "?";
  if (pyLen(title) <= TELEGRAM.title_chars) return title;
  return pyRstrip(Array.from(title).slice(0, TELEGRAM.title_chars - 1).join("")) + "…";
}

const pyStr = v => (v == null ? "None" : String(v));

const playUrl = g => `https://www.roblox.com/games/${pyStr(g.place_id)}`;
const gameLink = g => `<a href="${playUrl(g)}">${h(short(g.title))}</a>`;
const dashLine = key => `📊 <a href="${DASHBOARD_URL}#cat=${key}">Abrir dashboard</a>`;
const weekStat = g => [`7d ${pct(g.growth_7d)}`];
const monday0 = d => (d.getUTCDay() + 6) % 7;

const cardLink = (key, g, text) => `<a href="${DASHBOARD_URL}#cat=${key}&amp;game=${pyStr(g.id)}">${text}</a>`;

function growth(g, arrow = false) {
  const t = g.trend ?? null, g24 = g.growth_24h ?? null;
  let value, unit;
  if (t !== null && (Math.abs(t) >= 2 || g24 === null)) [value, unit] = [t, "/día"];
  else if (g24 !== null) [value, unit] = [g24, " 24h"];
  else return "⏳ midiendo";
  const icon = arrow ? (value >= 0 ? "📈 " : "📉 ") : "";
  return `${icon}${pct(value)}${unit}`;
}

function entry(i, g, extra = [], medals = true) {
  const mark = medals ? ({ 1: "🥇", 2: "🥈", 3: "🥉" }[i] ?? `${i}.`) : `${i}.`;
  const stats = [`👥 ${num(g.typical)}`, growth(g), ...extra].join(" · ");
  const flag = g.spike_now ? " 🎉" : "";
  return `${mark} ${gameLink(g)}${flag}\n      └ ${stats}`;
}

function todayLabel(now) {
  const d = toDate(now);
  const dd = String(d.getUTCDate()).padStart(2, "0"), mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${DAYS[monday0(d)]} ${dd}/${mm}`;
}

export function isBoom(g) {
  return (g.players || 0) >= TELEGRAM.alert_min_players
    && (g.typical || 0) >= TELEGRAM.alert_min_typical
    && g.age_days != null && g.age_days <= TELEGRAM.alert_max_age_days
    && !isDown(g.status);
}

function alertCategory(cats, g) {
  const keys = Object.keys(cats);
  return keys.find(k => CATEGORIES[k].classifier === "horror" && g.horror)
    ?? keys.find(k => CATEGORIES[k].classifier === "all");
}

const big = g => (g.typical || 0) >= TELEGRAM.report_min_players;

/**
 * → [texto, id del juego para la miniatura | null], o [null, null] si no hay
 * ningún juego con TELEGRAM.report_min_players (ese día no se manda nada).
 */
export function dailyReport(key, cat, games, now) {
  const s = cat.stats, n = TELEGRAM.list_size;
  const emerging = cat.emerging.map(u => games[String(u)]).filter(big).slice(0, n);
  const shown = new Set(emerging.map(g => g.id));
  const trending = cat.trending.map(u => games[String(u)]).filter(g => big(g) && !shown.has(g.id)).slice(0, n);
  if (!emerging.length && !trending.length) return [null, null];

  const lines = [
    `${cat.icon} <b>${h(cat.label.toUpperCase())}</b> · ${todayLabel(now)}`,
    `<i>${s.games} juegos · 📈 ${s.rising} suben · 📉 ${s.falling} bajan</i>`,
  ];
  if (emerging.length) {
    lines.push("", "🌱 <b>Emergentes</b>");
    emerging.forEach((g, i) => lines.push(entry(i + 1, g, [`⭐${g.emerging}`])));
  }
  if (trending.length) {
    lines.push("", "🔥 <b>En tendencia</b>");
    trending.forEach((g, i) => lines.push(entry(i + 1, g, [], false)));
  }
  lines.push("", dashLine(key));

  const top = emerging[0] || trending[0] || null;
  return [lines.join("\n"), top?.id ?? null];
}

export function weeklyReport(key, cat, games, now) {
  const listed = cat.ids.map(u => games[String(u)])
    .filter(g => big(g) && g.growth_7d !== null && g.growth_7d !== undefined);
  // sorted() de Python es estable, como Array.prototype.sort
  const up = [...listed].sort((a, b) => b.growth_7d - a.growth_7d).slice(0, TELEGRAM.list_size);
  const down = listed.filter(g => g.growth_7d < 0).sort((a, b) => a.growth_7d - b.growth_7d).slice(0, 3);
  if (!up.length) return [null, null];
  const lines = [
    `📅 ${cat.icon} <b>${h(cat.label.toUpperCase())} · LA SEMANA</b>`,
    `<i>hasta el ${todayLabel(now)}</i>`,
    "", "🚀 <b>Lo que más ha crecido</b>",
    ...up.map((g, i) => entry(i + 1, g, weekStat(g))),
  ];
  if (down.length) {
    lines.push("", "🧊 <b>Lo que más ha caído</b>",
      ...down.map((g, i) => entry(i + 1, g, weekStat(g), false)));
  }
  lines.push("", dashLine(key));
  return [lines.join("\n"), up[0]?.id ?? null];
}

export function alertMessage(key, cat, g) {
  const creator = h(g.creator || "—") + (g.creator_verified ? " ✔" : "");
  const genre = h(g.subgenre || g.genre || "");
  const lines = [
    `🚀 <b>PETANDO</b> · ${cat.icon} ${h(cat.label)}`,
    "",
    `<b>${h(g.title)}</b>`,
    `<i>${creator}${genre ? " · " + genre : ""}</i>`,
    "",
    `👥 <b>${num(g.players)}</b> jugadores ahora · ${num(g.typical)} de media en 24h`,
    growth(g, true) + (growth(g).endsWith("/día") && g.growth_24h != null ? ` · ${pct(g.growth_24h)} en 24h` : ""),
    `👁 ${num(g.visits)} visitas` + (g.visits_day ? ` · +${num(g.visits_day)}/día` : ""),
  ];
  const extra = [];
  if (g.like_ratio != null) extra.push(`👍 ${pyFixed(g.like_ratio, 0)}%`);
  if (g.age_days != null) extra.push(`🗓 creado hace ${g.age_days} días`);
  if (extra.length) lines.push(extra.join(" · "));
  if (g.emerging != null) {
    lines.push("", `⭐ <b>${g.emerging}/100</b> — <i>${h((g.emerging_reasons || []).join(", "))}</i>`);
  }
  lines.push(
    "",
    `▶️ <a href="${playUrl(g)}">Jugar</a>   ·   📊 ${cardLink(key, g, "Ver ficha")}`,
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

function toDate(now) {
  if (now instanceof Date) return now;
  if (now === null || now === undefined) return new Date();
  return new Date(typeof now === "number" ? now : String(now));
}

const isoDay = d => d.toISOString().slice(0, 10);

export function isoWeek(now) {
  const d = toDate(now);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = monday0(t);
  t.setUTCDate(t.getUTCDate() - dow + 3);         // el jueves de esa semana
  const year = t.getUTCFullYear();
  const week = 1 + Math.floor((t - Date.UTC(year, 0, 1)) / DAY_MS / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// Mismas fórmulas que metrics.js; si se separan, solo cambia quién pasa (hay margen) y la cabecera.
const PICK = {
  emerging_top: 30,        // los N mejores emergentes de cada categoría (EMERGING.max_results + margen)
  trending_top: 18,        // en tendencia: TRENDING_MAX (12) + margen, por categoría
  weekly_up: 8,            // semanal: se muestran 5 y 3
  weekly_down: 6,
};

const STATUS_CODE = { new: 0, flat: 1, hot: 2, up: 3, down: 4, down2: 5 };
const CATS = Object.entries(CATEGORIES);

export function quickRows(games, { now } = {}) {
  const rows = [];
  for (const { g, m, em } of quickMetrics(games, { now })) {
    const typ = m.typical || 0;
    let cat = 0;
    CATS.forEach(([, c], ci) => {
      if (inCategory(c, g.horror) && typ >= c.min_players) cat |= 1 << ci;
    });
    if (!cat && !em) continue;
    rows.push({
      id: g.id, horror: g.horror ? 1 : 0, typical: m.typical, cat, st: STATUS_CODE[m.status],
      rising: isRising(m) ? 1 : 0, momentum: m.momentum, g7: m.growth_7d, em: em ? em[0] : null,
      boom: isBoom(m) ? 1 : 0,
    });
  }
  return rows;
}

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
    rows.filter(r => inCategory(cfg, r.horror) && r.em !== null)
      .sort((a, b) => b.em - a.em).slice(0, PICK.emerging_top).forEach(r => picked.add(r.id));
    ids.filter(r => r.rising).sort((a, b) => b.momentum - a.momentum)
      .slice(0, PICK.trending_top).forEach(r => picked.add(r.id));
    const w = ids.filter(r => r.g7 !== null && big(r));
    [...w].sort((a, b) => b.g7 - a.g7).slice(0, PICK.weekly_up).forEach(r => picked.add(r.id));
    w.filter(r => r.g7 < 0).sort((a, b) => a.g7 - b.g7).slice(0, PICK.weekly_down).forEach(r => picked.add(r.id));
  });
  for (const r of rows) if (r.boom) picked.add(r.id);
  return { counts, ids: picked };
}

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

// Trocear sin JSON.parse (~10 ms con 1 MB): sin espacios, {"id": solo sale al empezar un juego.

const GAME_START = '{"id":';

function gameOffsets(text) {
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

function parseSlice(text, offs, a, b) {
  if (a >= b) return [];
  let end = offs[b];
  const slice = text.slice(offs[a], end).replace(/,\s*$/, "");
  return JSON.parse("[" + slice + "]");
}

export function telegramScanText(text, { now, part = 0, parts = 1 }) {
  const offs = gameOffsets(text), n = offs.length - 1;
  const a = Math.floor(n * part / parts), b = Math.floor(n * (part + 1) / parts);
  const games = parseSlice(text, offs, a, b);
  return quickRows(games, { now });
}

// Del texto del export, sin parsearlo. → { frag, n }
export function pickGames(text, ids) {
  const want = new Set(ids);
  const offs = gameOffsets(text), out = [];
  for (let k = 0; k < offs.length - 1; k++) {
    const p = offs[k] + GAME_START.length;
    if (!want.has(Number(text.slice(p, text.indexOf(",", p))))) continue;
    out.push(text.slice(offs[k], offs[k + 1]).replace(/,$/, ""));
  }
  return { frag: out.join(","), n: out.length };
}

function applyCounts(dash, counts) {
  if (!counts) return;
  for (const [key, c] of Object.entries(counts)) {
    const cat = dash.categories?.[key];
    if (cat) cat.stats = { ...cat.stats, ...c };
  }
}

function makeClient({ env, fetchImpl, log, maxFetch, migrated }) {
  const token = env?.TELEGRAM_TOKEN;
  // El secret manda: el id migrado solo vale mientras siga el antiguo.
  const envChat = env?.TELEGRAM_CHAT_ID;
  let chat = envChat && migrated?.to && String(migrated.from) === String(envChat) ? String(migrated.to) : envChat;
  const counter = { used: 0 };
  const moved = { to: null };   // id nuevo si Telegram avisa de que el grupo ha migrado

  async function call(url, init, timeoutMs) {
    if (counter.used >= maxFetch) throw new Error(`tope de ${maxFetch} peticiones externas`);
    counter.used++;
    return fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  }

  async function thumbUrl(uid) {
    if (!uid) return null;
    try {
      const q = new URLSearchParams({
        universeIds: String(uid), countPerUniverse: "1", size: "768x432", format: "Jpeg", defaults: "true",
      });
      const r = await call(`${THUMBS_API}?${q}`, {}, 15000);
      const j = await r.json();
      const shots = j?.data?.[0]?.thumbnails || [];
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
    // Grupo pasado a supergrupo: se sigue al id nuevo (runTelegram lo guarda).
    const to = res.ok ? null : migrateTo(res.text);
    if (to && retry && String(to) !== String(chat)) {
      log(`  el grupo ahora es un supergrupo: se envía al id nuevo ${to}`);
      chat = String(to);
      moved.to = chat;
      return post(method, body, timeoutMs, false);
    }
    return res;
  }

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

function migrateTo(text) {
  try {
    const id = JSON.parse(text)?.parameters?.migrate_to_chat_id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

// fetch, buildDashboard, log, maxFetch y quickExit solo para las pruebas.
export async function runTelegram({
  env, exportData, now, getState, setState, force,
  fetch: fetchImpl = globalThis.fetch, buildDashboard = metricsBuildDashboard,
  log = (...a) => console.log(...a), maxFetch = TELEGRAM_MAX_FETCH, quickExit = true,
}) {
  const nowD = toDate(now);
  const today = isoDay(nowD), week = isoWeek(nowD), hour = nowD.getUTCHours();
  const weekday = monday0(nowD);

  const reduced = exportData;
  const counts = reduced.telegram?.counts ?? null;

  const loaded = getState ? await getState(STATE_KEY) : null;
  const state = loaded && typeof loaded === "object" ? structuredClone(loaded) : {};
  const before = JSON.stringify(state);
  const client = makeClient({ env, fetchImpl, log, maxFetch, migrated: state.chat_migrated });
  const result = {
    credentials: client.hasCredentials, alerts: 0, daily: null, weekly: null, messages: 0,
    candidates: reduced.games?.length ?? null, total: reduced.telegram?.total ?? null,
    header: counts ? "exacta" : "candidatos",
  };
  const dueDaily = force === "daily" || (hour >= TELEGRAM.report_hour_utc && state.last_daily !== today);
  const dueWeekly = force === "weekly"
    || (weekday === 0 && hour >= TELEGRAM.report_hour_utc && state.last_weekly !== week);

  // Atajo: sin diario ni semanal, buildDashboard solo si alguien nuevo peta; sin state.boom, nunca.
  if (quickExit && !dueDaily && !dueWeekly && state.boom) {
    const maybe = quickRows(reduced.games || [], { now: nowD })
      .some(r => r.boom && !(String(r.id) in state.boom));
    if (!maybe) return { ...result, skipped: "sin alertas posibles", fetches: 0 };
  }

  const dash = buildDashboard(reduced, { now: nowD });
  applyCounts(dash, counts);
  const games = dash.games, cats = dash.categories;

  const save = async () => {
    if (!setState || JSON.stringify(state) === before) return;
    await setState(STATE_KEY, state);
  };

  try {
    // Primera pasada (sin state.boom): apunta sin avisar los que ya petan, no son noticia.
    const seeding = !state.boom;
    const boomed = (state.boom ||= {});
    if (seeding) delete state.alerted;   // las alertas de emergentes de antes
    const booming = Object.values(games).filter(g => isBoom(g) && !(String(g.id) in boomed))
      .sort((a, b) => (b.players - a.players) || (a.id - b.id));
    for (const g of booming) {
      if (seeding) {
        boomed[String(g.id)] = today;
        continue;
      }
      if (result.alerts >= TELEGRAM.max_alerts_per_run) break;
      const key = alertCategory(cats, g);
      result.messages++;
      if (await client.send(...alertMessage(key, cats[key], g))) {
        boomed[String(g.id)] = today;
        result.alerts++;
      }
    }
    if (seeding) result.seeded = booming.length;

    const sendAll = async report => {
      const ok = [];
      for (const [key, cat] of Object.entries(cats)) {
        const [text, id] = report(key, cat, games, nowD);
        if (!text) continue;
        result.messages++;
        ok.push(await client.send(text, id));
      }
      return ok.every(Boolean);
    };
    if (dueDaily) {
      result.daily = await sendAll(dailyReport);
      if (result.daily) state.last_daily = today;
    }
    if (dueWeekly) {
      result.weekly = await sendAll(weeklyReport);
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
