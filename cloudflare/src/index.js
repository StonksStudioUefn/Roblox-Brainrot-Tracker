/**
 * Roblox Tracker — Worker de Cloudflare (plan gratis).
 *
 * robloxtracker.stonksstudio.com (detrás de Cloudflare Access):
 *   GET /                    dashboard (R2 site/dashboard.html)
 *   GET /favicon.svg         (R2 site/favicon.svg)
 *   GET /config.js /metrics.js /horror.js   módulos ES compartidos con el Worker
 *   GET /api/export          R2 data/export.json
 *   GET /api/history/<id>    serie diaria + muestras (D1)
 *   GET /api/live?ids=…      jugadores ahora + icono (Roblox en directo)
 *   GET /api/thumbs?ids=…    miniaturas 16:9
 *   GET /api/game/<id>       ficha en vivo
 *
 * Admin (en cualquier host, "Authorization: Bearer <ADMIN_TOKEN>"):
 *   POST /api/admin/run      lanza un muestreo  {daily?, select?, skip?: [...], only?: [...], telegram_force?, now?}
 *   GET  /api/admin/status   estado (state + instancia) ?id=<instancia> &counts=1
 *   POST /api/admin/import   {table, columns, rows}  (migración, por lotes)
 *   POST /api/admin/rebuild  recalcula state.hist_agg desde daily y lanza un export
 *   POST /api/admin/export   lanza un Workflow que solo regenera el export
 *
 * *.workers.dev no pasa por Access: ahí solo responde /api/admin/*; todo lo
 * demás es 404.
 *
 * Los módulos que descarga el navegador se incrustan como texto al empaquetar
 * (`import … with { type: "text" }`, lo resuelve esbuild en `wrangler deploy`
 * / `wrangler deploy --dry-run --outdir dist`), así que web y Worker usan
 * siempre el mismo código. El esquema (schema.sql) NO se incrusta: wrangler
 * trata los .sql como módulo aparte; se aplica con `wrangler d1 execute`.
 *
 * Bindings: DB (D1), BUCKET (R2), SAMPLER (Workflow). Secrets: ADMIN_TOKEN,
 * TELEGRAM_TOKEN, TELEGRAM_CHAT_ID.
 */

import configSrc from "./config.js" with { type: "text" };
import metricsSrc from "./metrics.js" with { type: "text" };
import horrorSrc from "./horror.js" with { type: "text" };

import { getState, getStates, history, importStmt, isoDate, minuteOf, rebuildHistStmt, written } from "./db.js";
import { chunks, iconsUrl, thumbsUrl, URLS, UA } from "./sources.js";

export { Sampler } from "./sampler.js";

const MAX_LIVE_IDS = 200;
const MAX_IMPORT_BYTES = 4_000_000;
const TYPES = {
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  text: "text/plain; charset=utf-8",
};
const MODULES = { "/config.js": configSrc, "/metrics.js": metricsSrc, "/horror.js": horrorSrc };

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path.startsWith("/api/admin/")) return await admin(req, env, url);
      if (url.hostname.endsWith(".workers.dev")) return text("No encontrado", 404);
      if (req.method !== "GET" && req.method !== "HEAD") return text("Método no permitido", 405);

      if (MODULES[path]) {
        return new Response(MODULES[path], {
          headers: { "content-type": TYPES.js, "cache-control": "public, max-age=300" },
        });
      }
      if (path === "/api/export") return await exportFile(req, env);
      if (path.startsWith("/api/history/")) return await historyRoute(env, path.split("/")[3]);
      if (path === "/api/live") return await live(url);
      if (path === "/api/thumbs") return await thumbs(url);
      if (path.startsWith("/api/game/")) return await game(path.split("/")[3]);
      return await site(env, path);
    } catch (e) {
      console.error(e);
      return json({ error: String(e?.message || e) }, 502);
    }
  },

  async scheduled(controller, env, ctx) {
    const at = new Date(controller.scheduledTime || Date.now());
    // Id con fecha y hora: si el cron se dispara dos veces, la segunda falla al crear
    const id = `cron-${at.toISOString().slice(0, 16).replace(/[:]/g, "")}`;
    try {
      await env.SAMPLER.create({ id, params: { now: at.toISOString() } });
      console.log(`Muestreo lanzado: ${id}`);
    } catch (e) {
      console.warn(`No se lanzó ${id}: ${e?.message || e}`);
    }
  },
};

// ─── Respuestas ─────────────────────────────────────────────────────────────
function json(data, status = 200, maxAge = 0) {
  return new Response(typeof data === "string" ? data : JSON.stringify(data), {
    status,
    headers: { "content-type": TYPES.json, "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  });
}

function text(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": TYPES.text } });
}

function parseIds(url, max) {
  const ids = [...new Set((url.searchParams.get("ids") || "").split(",").map(s => s.trim()).filter(s => /^\d{1,20}$/.test(s)))];
  return ids.slice(0, max);
}

async function getJson(url, cacheTtl) {
  const r = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    cf: { cacheTtl, cacheEverything: true },
  });
  if (!r.ok) throw new Error(`Roblox respondió ${r.status}`);
  return r.json();
}

// ─── Web (R2) ───────────────────────────────────────────────────────────────
async function site(env, path) {
  let key;
  if (path === "/" || path === "/index.html" || path === "/dashboard.html") key = "site/dashboard.html";
  else if (path === "/favicon.svg") key = "site/favicon.svg";
  else return text("No encontrado", 404);
  const obj = await env.BUCKET.get(key);
  if (!obj) return text("No encontrado", 404);
  const ext = key.split(".").pop();
  return new Response(obj.body, {
    headers: {
      "content-type": TYPES[ext] || "application/octet-stream",
      "cache-control": ext === "html" ? "no-cache" : "public, max-age=3600",
      etag: obj.httpEtag,
    },
  });
}

async function exportFile(req, env) {
  const inm = req.headers.get("if-none-match");
  const obj = await env.BUCKET.get("data/export.json", inm ? { onlyIf: { etagDoesNotMatch: inm.replace(/^W\//, "").replace(/"/g, "") } } : undefined);
  if (!obj) return json({ error: "Todavía no hay export" }, 404);
  const headers = { "content-type": TYPES.json, "cache-control": "public, max-age=60", etag: obj.httpEtag };
  if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
}

async function historyRoute(env, id) {
  if (!/^\d{1,20}$/.test(id || "")) return json({ error: "id no válido" }, 400);
  const closed = await getState(env.DB, "closed_day");
  const nowMs = Date.now();
  const today = isoDate(minuteOf(nowMs));
  const openDay = closed ? new Date(Date.parse(`${closed}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : today;
  const out = await history(env.DB, Number(id), { nowMs, openDay });
  if (!out) return json({ error: "No encontrado" }, 404);
  return json(out, 200, 300);
}

// ─── En vivo (port de worker/worker.js) ─────────────────────────────────────
async function live(url) {
  const ids = parseIds(url, MAX_LIVE_IDS);
  if (!ids.length) return json({ error: "Faltan ids" }, 400);
  const [games, icons] = await Promise.all([
    Promise.all(chunks(ids, 50).map(c => getJson(`${URLS.games}?universeIds=${c.join(",")}`, 30))),
    Promise.all(chunks(ids, 100).map(c => getJson(iconsUrl(c), 21600).catch(() => ({ data: [] })))),
  ]);
  const out = {};
  for (const page of games) {
    for (const g of page.data || []) out[g.id] = { playing: g.playing, visits: g.visits, updated: g.updated };
  }
  for (const page of icons) {
    for (const i of page.data || []) {
      if (i.state === "Completed") (out[i.targetId] ||= {}).icon = i.imageUrl;
    }
  }
  return json({ ts: new Date().toISOString(), games: out }, 200, 20);
}

async function thumbs(url) {
  const ids = parseIds(url, 50);
  if (!ids.length) return json({ error: "Faltan ids" }, 400);
  const data = await getJson(thumbsUrl(ids), 21600);
  const out = {};
  for (const t of data.data || []) {
    const shot = (t.thumbnails || []).find(s => s.state === "Completed");
    if (shot) out[t.universeId] = shot.imageUrl;
  }
  return json(out, 200, 3600);
}

async function game(id) {
  if (!/^\d{1,20}$/.test(id || "")) return json({ error: "id no válido" }, 400);
  const [info, shot, icon] = await Promise.all([
    getJson(`${URLS.games}?universeIds=${id}`, 30),
    getJson(thumbsUrl([id]), 21600).catch(() => ({ data: [] })),
    getJson(iconsUrl([id], "256x256"), 21600).catch(() => ({ data: [] })),
  ]);
  const g = (info.data || [])[0];
  if (!g) return json({ error: "No encontrado" }, 404);
  const thumb = ((shot.data || [])[0]?.thumbnails || []).find(s => s.state === "Completed");
  const ic = (icon.data || [])[0];
  return json({
    id: g.id, name: g.name, description: g.description, playing: g.playing, visits: g.visits,
    favorites: g.favoritedCount, updated: g.updated, max_players: g.maxPlayers,
    thumb: thumb?.imageUrl || null, icon: ic?.state === "Completed" ? ic.imageUrl : null,
    ts: new Date().toISOString(),
  }, 200, 30);
}

// ─── Admin ──────────────────────────────────────────────────────────────────
async function authorized(req, env) {
  if (!env.ADMIN_TOKEN) return false;
  const got = new TextEncoder().encode(req.headers.get("authorization") || "");
  const want = new TextEncoder().encode(`Bearer ${env.ADMIN_TOKEN}`);
  if (got.byteLength !== want.byteLength) return false;
  return crypto.subtle.timingSafeEqual(got, want);
}

async function readBody(req) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_IMPORT_BYTES) throw new HttpError(413, "Cuerpo demasiado grande");
  const raw = await req.text();
  if (raw.length > MAX_IMPORT_BYTES) throw new HttpError(413, "Cuerpo demasiado grande");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new HttpError(400, "JSON no válido"); }
}

class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

async function admin(req, env, url) {
  if (!(await authorized(req, env))) return json({ error: "No autorizado" }, 401);
  const action = url.pathname.slice("/api/admin/".length);
  try {
    if (action === "status" && req.method === "GET") return await adminStatus(env, url);
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

    if (action === "run") {
      const body = await readBody(req);
      const params = {};
      if (body.daily) params.daily = true;
      if (body.select) params.select = true;
      if (Array.isArray(body.skip)) params.skip = body.skip.map(String);
      if (body.telegram_force) params.telegram_force = String(body.telegram_force);
      if (body.now) params.now = new Date(body.now).toISOString();
      if (Array.isArray(body.only)) params.only = body.only.map(String);
      const id = `manual-${stamp()}`;
      const inst = await env.SAMPLER.create({ id, params });
      return json({ id: inst.id, params });
    }
    if (action === "import") {
      const { table, columns, rows } = await readBody(req);
      if (!Array.isArray(columns) || !Array.isArray(rows)) throw new HttpError(400, "Faltan columns/rows");
      if (!rows.length) return json({ table, rows: 0, written: 0 });
      let res;
      try { res = await importStmt(env.DB, table, columns, rows).run(); }
      catch (e) { throw new HttpError(400, String(e?.message || e)); }
      return json({ table, rows: rows.length, written: written(res) });
    }
    // El export se hace por pasos (CPU): se lanza un Workflow que solo exporta
    if (action === "rebuild") {
      const res = await rebuildHistStmt(env.DB).run();
      const inst = await env.SAMPLER.create({ id: `export-${stamp()}`, params: { only: ["export"] } });
      return json({ hist_written: written(res), export_instance: inst.id });
    }
    if (action === "export") {
      const inst = await env.SAMPLER.create({ id: `export-${stamp()}`, params: { only: ["export"] } });
      return json({ export_instance: inst.id });
    }
    return json({ error: "No encontrado" }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    throw e;
  }
}

async function adminStatus(env, url) {
  const out = { now: new Date().toISOString() };
  out.state = await getStates(env.DB, ["last_run", "last_partial_run", "run_current", "day", "closed_day", "search_cursor", "last_sample_ts", "sel_day", "selection"]);
  // La pasada en curso va por ejecuciones encadenadas (<id>-sN): se enseña la actual
  const id = url.searchParams.get("id") || out.state.run_current?.id || out.state.last_run?.instance;
  if (id) {
    try { out.instance = { id, ...(await (await env.SAMPLER.get(id)).status()) }; }
    catch (e) { out.instance = { id, error: String(e?.message || e) }; }
  }
  if (url.searchParams.get("counts")) {
    // Ojo: COUNT(*) de samples recorre la tabla entera (~150k filas leídas)
    const r = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS n, SUM(tracked = 1) AS tracked FROM games"),
      env.DB.prepare("SELECT COUNT(*) AS n FROM places"),
      env.DB.prepare("SELECT COUNT(*) AS n FROM samples"),
      env.DB.prepare("SELECT COUNT(*) AS n, MAX(date) AS last FROM daily"),
      env.DB.prepare("SELECT COUNT(*) AS n FROM sort_hits"),
    ]);
    out.counts = {
      games: r[0].results[0], places: r[1].results[0].n, samples: r[2].results[0].n,
      daily: r[3].results[0], sort_hits: r[4].results[0].n,
    };
  }
  const head = await env.BUCKET.head("data/export.json");
  if (head) out.export = { size: head.size, uploaded: head.uploaded, meta: head.customMetadata };
  return json(out);
}

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:]/g, "") + Math.random().toString(36).slice(2, 6);
}
