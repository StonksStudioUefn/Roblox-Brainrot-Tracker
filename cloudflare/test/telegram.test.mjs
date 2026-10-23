// node --test test/telegram.test.mjs — sin red; los textos, contra notifier.py (notifier_ref.py).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  alertMessage, dailyReport, isBoom, isoWeek, num, pct, pyFixed, quickRows, runTelegram,
  telegramCandidates, telegramReduce, telegramScanText, visibleLen, weeklyReport,
} from "../src/telegram.js";
import { buildDashboard } from "../src/metrics.js";
import { rng } from "./comun.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const PY = process.env.PYTHON || "python3";
const TMP = mkdtempSync(join(tmpdir(), "tg-test-"));
const DASH_PATH = join(ROOT, "data/dashboard.json");
const DASH = JSON.parse(readFileSync(DASH_PATH, "utf8"));
const STATE_JSON = JSON.parse(readFileSync(join(ROOT, "data/state.json"), "utf8"));
const TOKEN = "TEST-TOKEN-no-es-real";
const THUMBS = "https://thumbnails.roblox.com/v1/games/multiget/thumbnails";
const ENV = { TELEGRAM_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "123" };
const EMPTY_EXPORT = { telegram: { counts: null }, games: [] };

// Nada de red real en estas pruebas
globalThis.fetch = () => { throw new Error("red prohibida en las pruebas"); };

const clone = x => structuredClone(x);
let tmpN = 0;
const tmpFile = (name, data) => {
  const p = join(TMP, `${tmpN++}-${name}`);
  writeFileSync(p, typeof data === "string" ? data : JSON.stringify(data));
  return p;
};

const notifierPy = (expr, input) => JSON.parse(execFileSync(PY, ["-c",
  `import json,sys\nfrom datetime import date\nsys.path.insert(0, ${JSON.stringify(ROOT)})\nimport notifier\nprint(json.dumps(${expr}))`],
{ input: JSON.stringify(input) }).toString());

function python({ now, dashboard = DASH, state = null, args = [] }) {
  const dpath = dashboard === DASH ? DASH_PATH : tmpFile("dash.json", dashboard);
  const a = [join(HERE, "notifier_ref.py"), "--now", now, "--dashboard", dpath];
  if (state) a.push("--state", tmpFile("state.json", state));
  const out = execFileSync(PY, [...a, "--", ...args], { cwd: ROOT, maxBuffer: 1 << 26 });
  return JSON.parse(out.toString("utf8"));
}

async function js({ now, dashboard = DASH, state = null, force, env = {}, fetch, maxFetch }) {
  let stored = state ? clone(state) : null;
  const lines = [];
  const res = await runTelegram({
    env, now, force, fetch, maxFetch, quickExit: false,
    exportData: EMPTY_EXPORT,
    buildDashboard: () => clone(dashboard),
    getState: async () => (stored ? clone(stored) : null),
    setState: async (key, value) => { assert.equal(key, "telegram"); stored = clone(value); },
    log: (...x) => lines.push(x.join(" ")),
  });
  return { res, state: stored, stdout: lines.length ? lines.join("\n") + "\n" : "" };
}

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

function boomDashboard(n = 7) {
  const d = clone(DASH);
  d.categories.general.emerging.slice(0, n).forEach((u, i) => {
    Object.assign(d.games[String(u)], { players: 50_000 + i * 1000, typical: 30_000, age_days: 30, status: "up" });
  });
  return d;
}
const BOOM_IDS = d => Object.values(d.games).filter(isBoom).map(g => String(g.id));
const NO_BOOM = { boom: {} };   // estado ya desplegado: sin apuntar a nadie

test("formato de números, semana ISO y visibleLen = notifier.py", () => {
  const xs = [];
  const rnd = rng(7);
  for (let i = 0; i < 500; i++) xs.push(i % 3 ? Math.round(rnd() * 20000) / 8 - 1000 : (rnd() - 0.5) * 400);
  xs.push(0.5, 1.5, 2.5, -0.5, -2.5, 0.25, 0.35, 99.95, 99.96, 0, 999.95, 1e-7);
  const days = [];
  for (let t = Date.UTC(2024, 0, 1); t < Date.UTC(2031, 0, 1); t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
  const msgs = [];
  for (const [key, cat] of Object.entries(DASH.categories)) {
    const d = boomDashboard(24);
    msgs.push(dailyReport(key, cat, d.games, new Date("2026-10-03T19:00:00Z"))[0]);
    msgs.push(weeklyReport(key, cat, d.games, new Date("2026-10-05T19:00:00Z"))[0]);
    for (const u of cat.emerging) msgs.push(alertMessage(key, cat, DASH.games[String(u)])[0]);
  }
  assert.ok(msgs.every(m => m !== null));
  msgs.push("a &amp; b &lt;i&gt; <b>x</b> &amp;amp; 😴");
  const [fmt, weeks, lens] = notifierPy(`(lambda d: [[[f"{x:.0f}", f"{x:.1f}", notifier.pct(x), notifier.num(abs(x)*1234.5)] for x in d[0]],
  [date.fromisoformat(x).strftime("%G-W%V") for x in d[1]], [notifier.visible_len(m) for m in d[2]]])(json.load(sys.stdin))`, [xs, days, msgs]);
  assert.deepEqual(xs.map(x => [pyFixed(x, 0), pyFixed(x, 1), pct(x), num(Math.abs(x) * 1234.5)]), fmt);
  assert.deepEqual(days.map(d => isoWeek(d + "T20:00:00Z")), weeks);
  assert.deepEqual(msgs.map(visibleLen), lens);
});

for (const [now, args, force] of [
  ["2026-10-03T00:36:44Z", ["--dry-run", "--daily"], "daily"],
  ["2026-10-03T00:36:44Z", ["--dry-run", "--weekly"], "weekly"],
]) {
  test(`notifier.py ${args.join(" ")} (${now}) = runTelegram force=${force}`, async () => {
    const py = python({ now, state: STATE_JSON, args });
    const r = await js({ now, state: STATE_JSON, force });
    // --dry-run imprime sin guardar; aquí sin credenciales también se imprime igual
    assert.equal(r.stdout, py.stdout);
    assert.ok(py.messages.length >= 1);
  });
}

for (const [label, now, state, dash] of [
  ["sábado 19:00, estado vacío (apunta sin avisar + diario)", "2026-10-03T19:00:00Z", {}, boomDashboard(4)],
  ["lunes 18:30, ya desplegado (alertas + diario + semanal)", "2026-10-05T18:30:00Z", NO_BOOM, DASH],
  ["lunes, estado de data/state.json", "2026-10-05T18:30:00Z", STATE_JSON, DASH],
  ["8 petando: tope de 3 alertas", "2026-10-03T19:00:00Z", NO_BOOM, boomDashboard(7)],
  ["antes de las 18:00: solo alertas", "2026-10-03T12:00:00Z", NO_BOOM, DASH],
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
      assert.equal(r.res.alerts, 3);
      assert.ok(r2.res.alerts > 0, "las que no cupieron salen en la siguiente pasada");
    } else {
      assert.equal(r2.stdout, "");
    }
  });
}

test("primera pasada: los que ya petan se apuntan sin avisar; los nuevos sí avisan", async () => {
  const d = boomDashboard(2);
  const r = await js({ now: "2026-10-03T12:00:00Z", state: { alerted: { 1: "2026-10-02" }, last_daily: "x" }, dashboard: d });
  assert.equal(r.res.alerts, 0);
  assert.equal(r.res.seeded, BOOM_IDS(d).length);
  assert.equal(r.stdout, "");
  assert.deepEqual(Object.keys(r.state.boom).sort(), BOOM_IDS(d).sort());
  assert.equal(r.state.alerted, undefined, "las alertas de emergentes de antes se borran");
  // Un juego que empieza a petar después sí avisa
  const d2 = boomDashboard(3);
  const r2 = await js({ now: "2026-10-03T13:00:00Z", state: r.state, dashboard: d2 });
  assert.equal(r2.res.alerts, 1);
  assert.match(r2.stdout, /🚀 <b>PETANDO<\/b>/);
  // Juegos que no cuentan: viejos, cayendo, pico de una hora o por debajo
  const g = d2.games[String(d2.categories.general.emerging[0])];
  for (const [k, v] of [["age_days", 121], ["age_days", null], ["status", "down"], ["status", "down2"],
    ["typical", 19_999], ["players", 39_999]]) {
    assert.equal(isBoom({ ...g, [k]: v }), false, `${k} = ${v}`);
  }
  assert.equal(isBoom({ ...g, status: "new", age_days: 120, players: 40_000, typical: 20_000 }), true);
});

test("con credenciales y fetch simulado: mismos textos y fotos que notifier.py", async () => {
  const now = "2026-10-05T18:30:00Z";
  const dash = boomDashboard(2);
  const py = python({ now, state: NO_BOOM, dashboard: dash });
  const m = mockFetch();
  const r = await js({ now, state: NO_BOOM, dashboard: dash, env: ENV, fetch: m.f });
  assert.equal(r.res.alerts, 3);
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

test("foto rechazada o sin miniatura → el mismo texto con sendMessage (sin vista previa)", async () => {
  for (const opts of [{ photo: 400 }, { thumb: "none" }, { thumb: "throw" }]) {
    const m = mockFetch(opts);
    const r = await js({ now: "2026-10-03T19:00:00Z", state: STATE_JSON, env: ENV, fetch: m.f });
    const msgs = m.calls.filter(c => c.url.endsWith("/sendMessage"));
    const photos = m.calls.filter(c => c.url.endsWith("/sendPhoto"));
    assert.equal(msgs.length, 1);   // solo general: en horror no hay juegos de 10K
    if (photos.length) assert.deepEqual(msgs.map(c => c.body.text), photos.map(c => c.body.caption));
    else assert.equal(opts.photo, undefined);
    for (const c of msgs) assert.deepEqual(c.body.link_preview_options, { is_disabled: true });
    assert.equal(r.res.daily, true);
    assert.equal(r.state.last_daily, "2026-10-03");
  }
});

test("si Telegram falla no se marca como enviado (se reintenta en la siguiente pasada)", async () => {
  const m = mockFetch({ photo: 500, message: 500 });
  const d = boomDashboard(4);
  const r = await js({ now: "2026-10-03T19:00:00Z", state: NO_BOOM, dashboard: d, env: ENV, fetch: m.f });
  assert.equal(r.res.alerts, 0);
  assert.equal(r.res.daily, false);
  assert.deepEqual(r.state ?? NO_BOOM, NO_BOOM);
  // Cada fallo deja probar la alerta siguiente; 3 peticiones por mensaje (y 2 diarios)
  assert.equal(m.calls.length, (BOOM_IDS(d).length + 2) * 3);
});

test("nunca más de 50 fetch, ni con todo forzado y todo fallando", async () => {
  // 24 juegos petando en las dos categorías, lunes, diario + semanal, fotos rechazadas
  const d = clone(DASH);
  const ids = Object.keys(d.games).slice(0, 24).map(Number);
  for (const key of Object.keys(d.categories)) {
    d.categories[key].emerging = ids;
    d.categories[key].ids = ids;
  }
  ids.forEach(u => Object.assign(d.games[String(u)], { emerging: 90, players: 50_000, typical: 30_000, age_days: 30, status: "up", growth_7d: 50 }));
  const m = mockFetch({ photo: 400 });
  const r = await js({ now: "2026-10-05T19:00:00Z", state: NO_BOOM, dashboard: d, env: ENV, fetch: m.f });
  assert.equal(r.res.alerts, 3);
  assert.equal(r.res.messages, 3 + 2 + 2);
  assert.equal(m.calls.length, (3 + 2 + 2) * 3);   // 21
  // Con un tope artificial de 10 se para limpio y no marca lo no enviado
  const m2 = mockFetch({ photo: 400 });
  const r2 = await js({ now: "2026-10-05T19:00:00Z", state: NO_BOOM, dashboard: d, env: ENV, fetch: m2.f, maxFetch: 10 });
  assert.equal(m2.calls.length, 10);
  assert.ok(r2.res.alerts <= 3);
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
});

for (const now of ["2026-10-03T00:36:44Z", "2026-09-28T19:00:00Z"]) {
  test(`prefiltro exacto con el export de data/ en ${now}`, async () => {
    const out = join(TMP, `export-${now}.json`);
    execFileSync(PY, [join(HERE, "make_export.py"), "--now", now, "--out", out], { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] });
    const text = readFileSync(out, "utf8");
    const ex = JSON.parse(text);
    const full = buildDashboard(ex, { now });

    // 1. El cálculo reducido da lo mismo que buildDashboard (status, momentum, g7, emergente)
    const ST = ["new", "flat", "hot", "up", "down", "down2"];
    for (const r of quickRows(ex.games, { now })) {
      const g = full.games[String(r.id)];
      if (!g) continue;
      assert.deepEqual([r.typical, ST[r.st], r.momentum, r.g7, r.em !== null && r.em >= 45 ? r.em : null, !!r.boom],
        [g.typical, g.status, g.momentum, g.growth_7d, g.emerging, isBoom(g)], `juego ${r.id}`);
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
    const boomed = Object.values(full.games).filter(isBoom);
    for (const g of boomed) assert.ok(red.games.some(x => x.id === g.id), `${g.title} petando y fuera de los candidatos`);
    for (const st of [{}, NO_BOOM, { boom: Object.fromEntries(boomed.map(g => [String(g.id), "x"])) }]) {
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
