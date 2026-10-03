/**
 * telegram.test.mjs — Pruebas de src/telegram.js, sin red (fetch simulado).
 *
 *   node --test cloudflare/test/telegram.test.mjs      (o node cloudflare/test/telegram.test.mjs)
 *
 * · Mensajes: con data/dashboard.json como salida de buildDashboard, los textos
 *   y la foto de cada mensaje son IDÉNTICOS a los de notifier.py (--dry-run
 *   --daily / --weekly, y la ejecución normal sin credenciales, que guarda
 *   estado) para el mismo `now` (test/notifier_ref.py).
 * · Estado: no repite alertas ni el diario/semanal; con un envío fallido no
 *   marca nada.
 * · Envío: foto + pie; si la foto falla o no hay miniatura, texto; más de 1024
 *   caracteres visibles → texto sin pedir miniatura; nunca más de 50 fetch.
 * · Prefiltro (si existen test/make_export.py y src/metrics.js): con el export
 *   construido de data/, las cabeceras de telegramCandidates son las de
 *   buildDashboard con TODOS los juegos y los mensajes salen iguales que sin
 *   reducir; también repartido en pasos (telegramScanText + telegramReduce).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  alertMessage, dailyReport, headerCounts, isoWeek, num, pct, pyFixed, quickRows, runTelegram,
  telegramCandidates, telegramReduce, telegramScanText, visibleLen, weeklyReport,
} from "../src/telegram.js";
import { buildDashboard } from "../src/metrics.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const PY = process.env.PYTHON || "python3";
const TMP = mkdtempSync(join(tmpdir(), "tg-test-"));
const DASH_PATH = join(ROOT, "data/dashboard.json");
const DASH = JSON.parse(readFileSync(DASH_PATH, "utf8"));
const STATE_JSON = JSON.parse(readFileSync(join(ROOT, "data/state.json"), "utf8"));
const TOKEN = "TEST-TOKEN-no-es-real";
const THUMBS = "https://thumbnails.roblox.com/v1/games/multiget/thumbnails";

// Nada de red real en estas pruebas
globalThis.fetch = () => { throw new Error("red prohibida en las pruebas"); };

const clone = x => structuredClone(x);
let tmpN = 0;
const tmpFile = (name, data) => {
  const p = join(TMP, `${tmpN++}-${name}`);
  writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data));
  return p;
};

/** notifier.py de producción vía notifier_ref.py → { stdout, messages: [[texto, id]], state } */
function python({ now, dashboard = DASH, state = null, args = [] }) {
  const dpath = dashboard === DASH ? DASH_PATH : tmpFile("dash.json", dashboard);
  const a = [join(HERE, "notifier_ref.py"), "--now", now, "--dashboard", dpath];
  if (state) a.push("--state", tmpFile("state.json", state));
  const out = execFileSync(PY, [...a, "--", ...args], { cwd: ROOT, maxBuffer: 1 << 26 });
  return JSON.parse(out.toString("utf8"));
}

/** runTelegram con buildDashboard sustituido por un dashboard fijo. */
async function js({ now, dashboard = DASH, state = null, force, env = {}, fetch, maxFetch }) {
  let stored = state ? clone(state) : null;
  const lines = [];
  const res = await runTelegram({
    env, now, force, fetch, maxFetch, quickExit: false,
    exportData: { telegram: { counts: null }, games: [] },
    buildDashboard: () => clone(dashboard),
    getState: async () => (stored ? clone(stored) : null),
    setState: async (key, value) => { assert.equal(key, "telegram"); stored = clone(value); },
    log: (...x) => lines.push(x.join(" ")),
  });
  return { res, state: stored, stdout: lines.length ? lines.join("\n") + "\n" : "" };
}

/** fetch simulado: miniaturas y Telegram; registra cada llamada. */
function mockFetch({ thumb = "ok", photo = 200, message = 200 } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    assert.ok(init.signal instanceof AbortSignal, "toda petición lleva timeout");
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (url.startsWith(THUMBS + "?")) {
      const id = new URL(url).searchParams.get("universeIds");
      assert.equal(new URL(url).searchParams.get("format"), "Jpeg");
      if (thumb === "throw") throw new Error("thumb caída");
      const shots = thumb === "ok" ? [{ state: "Completed", imageUrl: `https://img/${id}.jpg` }] : [{ state: "Pending" }];
      return Response.json({ data: [{ universeId: Number(id), thumbnails: shots }] });
    }
    if (url === `https://api.telegram.org/bot${TOKEN}/sendPhoto`) return new Response("{}", { status: photo });
    if (url === `https://api.telegram.org/bot${TOKEN}/sendMessage`) return new Response("{}", { status: message });
    throw new Error("URL inesperada " + url);
  };
  return { f, calls };
}

const sortKeys = o => (o && typeof o === "object" && !Array.isArray(o)
  ? Object.fromEntries(Object.keys(o).sort().map(k => [k, sortKeys(o[k])])) : o);

// Dashboard con más emergentes fuertes (para el tope de 5 alertas y los duplicados)
function strongDashboard(n = 7) {
  const d = clone(DASH);
  const gen = d.categories.general.emerging;
  gen.slice(0, n).forEach((u, i) => { d.games[String(u)].emerging = 75 + i; });
  return d;
}

// ─── Formato ──────────────────────────────────────────────────────────────────
test("formato de números, porcentajes y semana ISO = Python", () => {
  const xs = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 5000; i++) xs.push(i % 3 ? Math.round(rnd() * 20000) / 8 - 1000 : (rnd() - 0.5) * 400);
  xs.push(0.5, 1.5, 2.5, -0.5, -2.5, 0.25, 0.35, 99.95, 99.96, 0, 999.95, 1e-7);
  const mine = xs.map(x => [pyFixed(x, 0), pyFixed(x, 1), pct(x), num(Math.abs(x) * 1234.5)]);
  const py = JSON.parse(execFileSync(PY, ["-c", `
import json,sys
sys.path.insert(0, ${JSON.stringify(ROOT)})
import notifier
print(json.dumps([[f"{x:.0f}", f"{x:.1f}", notifier.pct(x), notifier.num(abs(x)*1234.5)] for x in json.load(sys.stdin)]))`],
  { input: JSON.stringify(xs) }).toString());
  assert.deepEqual(mine, py);
  const days = [];
  for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2031, 0, 1); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
  const pyw = JSON.parse(execFileSync(PY, ["-c", `
import json,sys
from datetime import date
print(json.dumps([date.fromisoformat(d).strftime("%G-W%V") for d in json.load(sys.stdin)]))`],
  { input: JSON.stringify(days) }).toString());
  assert.deepEqual(days.map(d => isoWeek(d + "T20:00:00Z")), pyw);
});

test("visibleLen = notifier.visible_len en todos los mensajes", () => {
  const msgs = [];
  for (const [key, cat] of Object.entries(DASH.categories)) {
    msgs.push(dailyReport(key, cat, DASH.games, new Date("2026-10-03T19:00:00Z"))[0]);
    msgs.push(weeklyReport(key, cat, DASH.games, new Date("2026-10-05T19:00:00Z"))[0]);
    for (const u of cat.emerging) msgs.push(alertMessage(key, cat, DASH.games[String(u)])[0]);
  }
  msgs.push("a &amp; b &lt;i&gt; <b>x</b> &amp;amp; 😴");
  const py = JSON.parse(execFileSync(PY, ["-c", `
import json,sys
sys.path.insert(0, ${JSON.stringify(ROOT)})
import notifier
print(json.dumps([notifier.visible_len(m) for m in json.load(sys.stdin)]))`], { input: JSON.stringify(msgs) }).toString());
  assert.deepEqual(msgs.map(visibleLen), py);
});

// ─── Paridad de mensajes con notifier.py ──────────────────────────────────────
for (const [now, args, force] of [
  ["2026-10-03T00:36:44Z", ["--dry-run", "--daily"], "daily"],
  ["2026-10-03T00:36:44Z", ["--dry-run", "--weekly"], "weekly"],
  ["2026-10-05T19:00:00Z", ["--dry-run", "--daily"], "daily"],
  ["2026-10-05T19:00:00Z", ["--dry-run", "--weekly"], "weekly"],
]) {
  test(`notifier.py ${args.join(" ")} (${now}) = runTelegram force=${force}`, async () => {
    const py = python({ now, state: STATE_JSON, args });
    const r = await js({ now, state: STATE_JSON, force });
    // --dry-run imprime sin guardar; aquí sin credenciales también se imprime igual
    assert.equal(r.stdout, py.stdout);
    assert.ok(py.messages.length >= 2);
  });
}

for (const [label, now, state, dash] of [
  ["sábado 19:00, estado vacío (alertas + diario)", "2026-10-03T19:00:00Z", {}, DASH],
  ["lunes 18:30, estado vacío (alertas + diario + semanal)", "2026-10-05T18:30:00Z", {}, DASH],
  ["lunes, estado de data/state.json", "2026-10-05T18:30:00Z", STATE_JSON, DASH],
  ["7 emergentes ≥ 70: tope de 5 alertas", "2026-10-03T19:00:00Z", {}, strongDashboard(7)],
  ["antes de las 18:00: solo alertas", "2026-10-03T12:00:00Z", {}, DASH],
]) {
  test(`ejecución normal sin credenciales = notifier.py: ${label}`, async () => {
    const py = python({ now, state, dashboard: dash });
    const r = await js({ now, state, dashboard: dash });
    assert.equal(r.stdout, py.stdout);
    assert.deepEqual(sortKeys(r.state), sortKeys(py.state));
    // Y la segunda pasada no repite nada (ni Python ni JS)
    const py2 = python({ now, state: py.state, dashboard: dash });
    const r2 = await js({ now, state: r.state, dashboard: dash });
    assert.equal(r2.stdout, py2.stdout);
    if (label.includes("tope")) {
      assert.equal(r.res.alerts, 5);
      assert.ok(r2.res.alerts > 0, "las que no cupieron salen en la siguiente pasada");
    } else {
      assert.equal(r2.stdout, "");
    }
  });
}

test("con credenciales y fetch simulado: mismos textos y fotos que notifier.py", async () => {
  const now = "2026-10-05T18:30:00Z";
  const py = python({ now, state: {} });
  const m = mockFetch();
  const r = await js({ now, state: {}, env: { TELEGRAM_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "123" }, fetch: m.f });
  const photos = m.calls.filter(c => c.url.endsWith("/sendPhoto"));
  assert.deepEqual(photos.map(c => c.body.caption), py.messages.map(x => x[0]));
  // la miniatura pedida es la del juego que elige notifier.py
  assert.deepEqual(photos.map(c => c.body.photo), py.messages.map(x => `https://img/${x[1]}.jpg`));
  for (const c of photos) {
    assert.equal(c.body.parse_mode, "HTML");
    assert.equal(c.body.chat_id, "123");
  }
  assert.equal(m.calls.length, py.messages.length * 2);   // miniatura + sendPhoto
  assert.equal(r.res.fetches, m.calls.length);
  assert.ok(r.res.fetches <= 50);
  assert.deepEqual(sortKeys(r.state), sortKeys(py.state));
});

// ─── Envío: fallbacks y límites ───────────────────────────────────────────────
const ENV = { TELEGRAM_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "123" };

test("foto rechazada → mismo texto con sendMessage (sin vista previa)", async () => {
  const m = mockFetch({ photo: 400 });
  const r = await js({ now: "2026-10-03T19:00:00Z", state: STATE_JSON, env: ENV, fetch: m.f });
  const msgs = m.calls.filter(c => c.url.endsWith("/sendMessage"));
  const photos = m.calls.filter(c => c.url.endsWith("/sendPhoto"));
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs.map(c => c.body.text), photos.map(c => c.body.caption));
  for (const c of msgs) assert.deepEqual(c.body.link_preview_options, { is_disabled: true });
  assert.equal(r.res.daily, true);
  assert.equal(r.state.last_daily, "2026-10-03");
});

test("sin miniatura (o caída) → texto, sin sendPhoto", async () => {
  for (const thumb of ["none", "throw"]) {
    const m = mockFetch({ thumb });
    const r = await js({ now: "2026-10-03T19:00:00Z", state: STATE_JSON, env: ENV, fetch: m.f });
    assert.equal(m.calls.filter(c => c.url.endsWith("/sendPhoto")).length, 0);
    assert.equal(m.calls.filter(c => c.url.endsWith("/sendMessage")).length, 2);
    assert.equal(r.res.daily, true);
  }
});

test("si Telegram falla no se marca como enviado (se reintenta en la siguiente pasada)", async () => {
  const m = mockFetch({ photo: 500, message: 500 });
  const r = await js({ now: "2026-10-03T19:00:00Z", state: {}, env: ENV, fetch: m.f });
  assert.equal(r.res.alerts, 0);
  assert.equal(r.res.daily, false);
  assert.deepEqual(r.state ?? { alerted: {} }, { alerted: {} });
  // 4 alertas (+1: el juego que está en las dos categorías se reintenta en la
  // segunda, como en notifier.py) + 2 diarios, 3 peticiones cada uno
  assert.equal(m.calls.length, 7 * 3);
});

test("límite de 1024 caracteres visibles del pie de foto", async () => {
  const base = clone(DASH);
  const uid = String(base.categories.general.emerging[0]);
  const only = { ...base, categories: { general: { ...base.categories.general, emerging: [Number(uid)], trending: [] } } };
  const fit = async len => {
    const d = clone(only);
    const g = d.games[uid];
    g.emerging = 99;
    g.creator = "";
    const probe = alertMessage("general", d.categories.general, g)[0];
    g.creator = "x".repeat(len - visibleLen(probe) + 1);   // "—" (1) → len caracteres
    const msg = alertMessage("general", d.categories.general, g)[0];
    assert.equal(visibleLen(msg), len);
    const m = mockFetch();
    await js({ now: "2026-10-03T12:00:00Z", state: {}, dashboard: d, env: ENV, fetch: m.f });
    return m.calls.map(c => c.url.split("?")[0].split("/").pop());
  };
  assert.deepEqual(await fit(1024), ["thumbnails", "sendPhoto"]);
  assert.deepEqual(await fit(1025), ["sendMessage"]);
});

test("nunca más de 50 fetch, ni con todo forzado y todo fallando", async () => {
  // 24 emergentes ≥ 70 en las dos categorías, lunes, diario + semanal, fotos rechazadas
  const d = clone(DASH);
  const ids = Object.keys(d.games).slice(0, 24).map(Number);
  for (const key of Object.keys(d.categories)) d.categories[key].emerging = ids;
  ids.forEach(u => { d.games[String(u)].emerging = 90; });
  const m = mockFetch({ photo: 400 });
  const r = await js({ now: "2026-10-05T19:00:00Z", state: {}, dashboard: d, env: ENV, fetch: m.f });
  assert.equal(r.res.alerts, 5);
  assert.equal(m.calls.length, (5 + 2 + 2) * 3);   // 27
  // Con un tope artificial de 10 se para limpio y no marca lo no enviado
  const m2 = mockFetch({ photo: 400 });
  const r2 = await js({ now: "2026-10-05T19:00:00Z", state: {}, dashboard: d, env: ENV, fetch: m2.f, maxFetch: 10 });
  assert.equal(m2.calls.length, 10);
  assert.ok(r2.res.alerts <= 4);
  assert.equal(r2.res.daily, false);
  assert.equal(r2.state.last_daily, undefined);
});

test("estado: diario una vez al día, semanal una vez por semana ISO", async () => {
  let st = {};
  const run = async now => {
    const r = await js({ now, state: st });
    st = r.state ?? st;
    return r.res;
  };
  assert.equal((await run("2026-10-04T17:59:00Z")).daily, null);   // antes de las 18
  assert.equal((await run("2026-10-04T18:00:00Z")).daily, true);
  assert.equal((await run("2026-10-04T21:00:00Z")).daily, null);   // ya enviado hoy
  const mon = await run("2026-10-05T18:10:00Z");
  assert.equal(mon.daily, true);
  assert.equal(mon.weekly, true);
  assert.equal(st.last_weekly, "2026-W41");
  assert.equal((await run("2026-10-05T21:10:00Z")).weekly, null);
  assert.equal((await run("2026-10-06T18:10:00Z")).weekly, null);  // martes
  // setState(value) de un solo argumento también vale
  let one = null;
  await runTelegram({
    env: {}, now: "2026-10-07T19:00:00Z", exportData: { telegram: { counts: null }, games: [] }, quickExit: false,
    buildDashboard: () => clone(DASH), getState: async () => ({}), setState: async v => { one = v; }, log: () => {},
  });
  assert.equal(one.last_daily, "2026-10-07");
});

test("cabecera con `totals` del backend: con y sin suben/bajan", async () => {
  const run = async totals => {
    const lines = [];
    await runTelegram({
      env: {}, now: "2026-10-03T19:00:00Z", force: "daily", exportData: { totals, games: [] },
      buildDashboard: () => clone(DASH), getState: async () => clone(STATE_JSON), setState: async () => {},
      log: x => lines.push(x),
    });
    return lines.filter(l => l.startsWith("🎮") || l.startsWith("👻")).map(l => l.split("\n")[1]);
  };
  assert.deepEqual(await run({ general: { games: 600, rising: 20, falling: 90 }, horror: { games: 150, rising: 2, falling: 30 } }),
    ["<i>600 juegos · 📈 20 suben · 📉 90 bajan</i>", "<i>150 juegos · 📈 2 suben · 📉 30 bajan</i>"]);
  assert.deepEqual(await run({ general: 600, horror: { games: 150 } }), ["<i>600 juegos</i>", "<i>150 juegos</i>"]);
  assert.deepEqual(headerCounts({ totals: { general: 5 } }), { general: { games: 5, rising: null, falling: null } });
});

// ─── Prefiltro sobre un export real (data/ → make_export.py) ──────────────────
const MAKE_EXPORT = join(HERE, "make_export.py");
const NOWS = ["2026-10-03T00:36:44Z", "2026-10-02T21:20:00Z", "2026-09-28T19:00:00Z"];

for (const now of NOWS) {
  test(`prefiltro exacto con el export de data/ en ${now}`, { skip: !existsSync(MAKE_EXPORT) && "falta make_export.py" }, async () => {
    const out = join(TMP, `export-${now}.json`);
    const sortsArg = process.env.SORTS_JSON ? ["--sorts", process.env.SORTS_JSON] : [];
    execFileSync(PY, [MAKE_EXPORT, "--now", now, "--out", out, ...sortsArg], { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] });
    const text = readFileSync(out, "utf8");
    const ex = JSON.parse(text);
    const full = buildDashboard(ex, { now });

    // 1. El cálculo reducido da lo mismo que buildDashboard (status, momentum, g7, emergente)
    const ST = ["new", "flat", "hot", "up", "down", "down2"];
    for (const r of quickRows(ex.games, { now })) {
      const g = full.games[String(r.id)];
      if (!g) continue;
      assert.deepEqual([r.typical, ST[r.st], r.momentum, r.g7, r.em !== null && r.em >= 45 ? r.em : null],
        [g.typical, g.status, g.momentum, g.growth_7d, g.emerging], `juego ${r.id}`);
    }
    // 2. Cabeceras = las de buildDashboard con todos los juegos
    const red = telegramCandidates(ex, { now });
    for (const [key, c] of Object.entries(full.categories)) {
      const { games, players, rising, falling } = c.stats;
      assert.deepEqual(red.telegram.counts[key], { games, players, rising, falling });
    }
    assert.ok(red.games.length <= 80, `${red.games.length} candidatos`);
    // 3. Repartido en 4 pasos sale exactamente lo mismo
    const parts = [0, 1, 2, 3].map(part => JSON.parse(JSON.stringify(telegramScanText(text, { now, part, parts: 4 }))));
    assert.deepEqual(telegramReduce(text, parts), red);
    // 4. Los mensajes (todo forzado, estado vacío) son idénticos con y sin reducir
    const msgs = async exportData => {
      const lines = [];
      for (const force of ["daily", "weekly"]) {
        await runTelegram({
          env: {}, now, force, exportData, getState: async () => ({}), setState: async () => {},
          log: x => lines.push(x), ...(exportData === ex ? { buildDashboard: () => clone(full) } : {}),
        });
      }
      return lines.join("\n");
    };
    // b: buildDashboard con el export completo (sin reducir)
    const a = await msgs(red), b = await msgs(ex);
    assert.equal(a, b);
    // 5. El atajo sin diario/semanal no cambia nada: con estado vacío y con todo avisado
    for (const st of [{}, { alerted: Object.fromEntries(full.categories.general.emerging.map(u => [String(u), "x"])) }]) {
      const pass = async quickExit => {
        const lines = [];
        const r = await runTelegram({
          env: {}, now, exportData: red, quickExit, getState: async () => ({ ...clone(st), last_daily: now.slice(0, 10) }),
          setState: async () => {}, log: x => lines.push(x),
        });
        return [lines.join("\n"), r.alerts];
      };
      assert.deepEqual(await pass(true), await pass(false));
    }
    console.log(`  ${now}: ${ex.games.length} juegos → ${red.games.length} candidatos · ` +
      Object.entries(red.telegram.counts).map(([k, c]) => `${k} ${c.games}/${c.rising}↑/${c.falling}↓`).join(" · "));
  });
}
