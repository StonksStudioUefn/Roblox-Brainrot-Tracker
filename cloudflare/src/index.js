import configSrc from "./config.js" with { type: "text" };
import metricsSrc from "./metrics.js" with { type: "text" };
import horrorSrc from "./horror.js" with { type: "text" };

import { dropExportCacheStmt, getState, getStates, history, importStmt, minuteOf, openDayOf, radarCounts, rebuildHistStmts, written } from "./db.js";
import { chunks, gamesUrl, iconsUrl, thumbsUrl, UA } from "./sources.js";
import { espacioD1, withApp } from "./stonks.js";
import { backfillFromRadar } from "./sampler.js";

export { Sampler } from "./sampler.js";
export { Operaciones } from "./stonks.js";

const MAX_LIVE_IDS = 200;
const MAX_IMPORT_BYTES = 4_000_000;
const MAX_BACKFILL_IDS = 400;   // la selección son ~220: con 16 lecturas, 6.400 filas como mucho
const TYPES = {
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  text: "text/plain; charset=utf-8",
};
const PAGE = ["site/dashboard.html", TYPES.html, "no-cache"];
const SITE = {
  "/": PAGE, "/index.html": PAGE, "/dashboard.html": PAGE,
  "/favicon.svg": ["site/favicon.svg", TYPES.svg, "public, max-age=3600"],
};
const MODULES = { "/config.js": configSrc, "/metrics.js": metricsSrc, "/horror.js": horrorSrc };

export default {
  async fetch(req, env, ctx) {
    env = withApp(env);
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path.startsWith("/api/admin/")) return await admin(req, env, url);
      // *.workers.dev no pasa por Access: ahí solo /api/admin/*, que pide ADMIN_TOKEN.
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

function json(data, status = 200, maxAge = 0) {
  return new Response(typeof data === "string" ? data : JSON.stringify(data), {
    status,
    headers: { "content-type": TYPES.json, "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  });
}

function text(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": TYPES.text } });
}

const isId = s => /^\d{1,20}$/.test(s || "");
const shotOf = t => (t?.thumbnails || []).find(s => s.state === "Completed")?.imageUrl ?? null;
const done = i => (i?.state === "Completed" ? i.imageUrl : null);

function parseIds(url, max) {
  const ids = [...new Set((url.searchParams.get("ids") || "").split(",").map(s => s.trim()).filter(isId))];
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

async function site(env, path) {
  if (!SITE[path]) return text("No encontrado", 404);
  const [key, type, cache] = SITE[path];
  const obj = await env.BUCKET.get(key);
  if (!obj) return text("No encontrado", 404);
  return new Response(obj.body, { headers: { "content-type": type, "cache-control": cache, etag: obj.httpEtag } });
}

async function exportFile(req, env) {
  const inm = req.headers.get("if-none-match");
  const obj = await env.BUCKET.get("data/export.json", inm ? { onlyIf: { etagDoesNotMatch: inm.replace(/^W\//, "").replace(/"/g, "") } } : undefined);
  if (!obj) return json({ error: "Todavía no hay export" }, 404);
  const headers = { "content-type": TYPES.json, "cache-control": "public, max-age=60", etag: obj.httpEtag };
  if (!obj.body) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
}

async function historyRoute(env, id) {
  if (!isId(id)) return json({ error: "id no válido" }, 400);
  const nowMs = Date.now();
  const openDay = openDayOf(await getState(env.DB, "closed_day"), nowMs);
  const out = await history(env.DB, Number(id), { nowMs, openDay });
  if (!out) return json({ error: "No encontrado" }, 404);
  return json(out, 200, 300);
}

async function live(url) {
  const ids = parseIds(url, MAX_LIVE_IDS);
  if (!ids.length) return json({ error: "Faltan ids" }, 400);
  const [games, icons] = await Promise.all([
    Promise.all(chunks(ids, 50).map(c => getJson(gamesUrl(c), 30))),
    Promise.all(chunks(ids, 100).map(c => getJson(iconsUrl(c), 21600).catch(() => ({ data: [] })))),
  ]);
  const out = {};
  for (const page of games) {
    for (const g of page.data || []) out[g.id] = { playing: g.playing, visits: g.visits, updated: g.updated };
  }
  for (const page of icons) {
    for (const i of page.data || []) if (done(i)) (out[i.targetId] ||= {}).icon = done(i);
  }
  return json({ ts: new Date().toISOString(), games: out }, 200, 20);
}

async function thumbs(url) {
  const ids = parseIds(url, 50);
  if (!ids.length) return json({ error: "Faltan ids" }, 400);
  const data = await getJson(thumbsUrl(ids), 21600);
  const out = {};
  for (const t of data.data || []) if (shotOf(t)) out[t.universeId] = shotOf(t);
  return json(out, 200, 3600);
}

async function game(id) {
  if (!isId(id)) return json({ error: "id no válido" }, 400);
  const [info, shot, icon] = await Promise.all([
    getJson(gamesUrl([id]), 30),
    getJson(thumbsUrl([id]), 21600).catch(() => ({ data: [] })),
    getJson(iconsUrl([id], "256x256"), 21600).catch(() => ({ data: [] })),
  ]);
  const g = (info.data || [])[0];
  if (!g) return json({ error: "No encontrado" }, 404);
  return json({
    id: g.id, name: g.name, description: g.description, playing: g.playing, visits: g.visits,
    favorites: g.favoritedCount, updated: g.updated, max_players: g.maxPlayers,
    thumb: shotOf((shot.data || [])[0]) || null, icon: done((icon.data || [])[0]),
    ts: new Date().toISOString(),
  }, 200, 30);
}

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
    if (action === "espacio" && req.method === "GET") return json(await espacioD1(env.DB, { exacto: !!url.searchParams.get("exacto") }));
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

    if (action === "run") {
      const body = await readBody(req);
      const params = {};
      const strs = v => (Array.isArray(v) ? v.map(String) : null);
      if (strs(body.daily)) params.daily = strs(body.daily);
      else if (body.daily) params.daily = true;
      if (body.select) params.select = true;
      if (strs(body.skip)) params.skip = strs(body.skip);
      if (body.telegram_force) params.telegram_force = String(body.telegram_force);
      if (body.now) params.now = new Date(body.now).toISOString();
      if (strs(body.only)) params.only = strs(body.only);
      const id = `manual-${stamp()}`;
      const inst = await env.SAMPLER.create({ id, params });
      return json({ id: inst.id, params });
    }
    if (action === "import") {
      const { table, columns, rows } = await readBody(req);
      if (!Array.isArray(columns) || !Array.isArray(rows)) throw new HttpError(400, "Faltan columns/rows");
      if (!rows.length) return json({ table, rows: 0, written: 0 });
      let res;
      // Filas de daily importadas: las cerradas que guarda el export (state.export_d) ya no valen
      try { res = await env.DB.batch([importStmt(env.DB, table, columns, rows), ...(table === "daily" ? [dropExportCacheStmt(env.DB)] : [])]); }
      catch (e) { throw new HttpError(400, String(e?.message || e)); }
      return json({ table, rows: rows.length, written: written(res[0]) });
    }
    // El export se hace por pasos (CPU): se lanza un Workflow que solo exporta
    if (action === "rebuild") {
      const res = await env.DB.batch([...rebuildHistStmts(env.DB), dropExportCacheStmt(env.DB)]);
      const inst = await launchExport(env);
      return json({ hist_written: written(res.slice(0, 2)), export_instance: inst.id });
    }
    if (action === "export") return json({ export_instance: (await launchExport(env)).id });
    // select solo rellena los que entran; esto, los huecos de los ya seguidos.
    if (action === "backfill") {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isSafeInteger) : null;
      return json(await backfillFromRadar(env, ids, minuteOf(Date.now()), { maxGames: MAX_BACKFILL_IDS }));
    }
    return json({ error: "No encontrado" }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    throw e;
  }
}

async function adminStatus(env, url) {
  const out = { now: new Date().toISOString() };
  out.state = await getStates(env.DB, ["last_run", "last_partial_run", "run_current", "meta_day", "closed_day", "sel_day", "maint_day", "daily_tries", "search_cursor", "last_sample_ts", "selection"]);
  // La pasada en curso va por ejecuciones encadenadas (<id>-sN): se enseña la actual
  const id = url.searchParams.get("id") || out.state.run_current?.id || out.state.last_run?.instance;
  if (id) {
    try { out.instance = { id, ...(await (await env.SAMPLER.get(id)).status()) }; }
    catch (e) { out.instance = { id, error: String(e?.message || e) }; }
  }
  if (url.searchParams.get("counts")) {
    // Del desglose de espacio(): contar de verdad recorre todas las tablas (~60.000 filas).
    const [esp, radar] = await Promise.all([espacioD1(env.DB), radarCounts(env.DB)]);
    const n = name => esp.base.tablas.find(t => t.nombre === name)?.filas ?? null;
    out.counts = {
      games: { n: n("games"), tracked: radar.radar }, places: n("places"), samples: n("samples"),
      daily: { n: n("daily"), last: out.state.closed_day ?? null }, sort_hits: n("sort_hits"), estimado: true,
    };
  }
  const head = await env.BUCKET.head("data/export.json");
  if (head) out.export = { size: head.size, uploaded: head.uploaded, meta: head.customMetadata };
  return json(out);
}

const launchExport = env => env.SAMPLER.create({ id: `export-${stamp()}`, params: { only: ["export"] } });

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:]/g, "") + Math.random().toString(36).slice(2, 6);
}
