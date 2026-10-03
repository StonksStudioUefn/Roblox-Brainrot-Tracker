/**
 * Roblox Tracker — Worker de Cloudflare (robloxtracker.stonksstudio.com)
 *
 * El dominio está detrás de Cloudflare Access (login del equipo). La URL
 * *.workers.dev solo atiende el almacenamiento privado.
 *
 * Web (robloxtracker.stonksstudio.com):
 *   GET /                    el dashboard (site/dashboard.html en R2)
 *   GET /favicon.svg
 *   GET /data/<fichero>      datos del tracker (dashboard.json, history.json, CSV…)
 *   GET /api/live?ids=1,2    jugadores ahora mismo + icono (directo de Roblox)
 *   GET /api/thumbs?ids=1,2  miniaturas 16:9
 *   GET /api/game/<id>       ficha en vivo: descripción, jugadores, miniatura
 *
 * Privado (cabecera "Authorization: Bearer <INGEST_TOKEN>"), lo usa GitHub
 * Actions para leer y guardar los datos:
 *   GET    /api/files?prefix=data/
 *   GET    /api/file/<key>
 *   PUT    /api/file/<key>
 *   DELETE /api/file/<key>
 *
 * Bindings: BUCKET (R2 "roblox-tracker"), INGEST_TOKEN (secret).
 */

const GAMES_API = "https://games.roblox.com/v1/games";
const ICONS_API = "https://thumbnails.roblox.com/v1/games/icons";
const THUMBS_API = "https://thumbnails.roblox.com/v1/games/multiget/thumbnails";

const MAX_LIVE_IDS = 200;
// Origen de /data/* durante la transición (vacío = R2)
const GITHUB_DATA = "https://raw.githubusercontent.com/StonksStudioUefn/Roblox-Brainrot-Tracker/main";
const TYPES = {
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  svg: "image/svg+xml",
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === "/api/files" || path.startsWith("/api/file/")) return await storage(req, env, url);
      // workers.dev no pasa por Cloudflare Access: ahí solo vale el
      // almacenamiento con token; la web y el modo en vivo, solo en el dominio
      if (url.hostname.endsWith(".workers.dev")) return text("No encontrado", 404);
      if (req.method !== "GET" && req.method !== "HEAD") return text("Método no permitido", 405);
      if (path === "/api/live") return await live(url);
      if (path === "/api/thumbs") return await thumbs(url);
      if (path.startsWith("/api/game/")) return await game(path.split("/")[3]);
      return await site(env, path);
    } catch (e) {
      return json({ error: String(e?.message || e) }, 502);
    }
  },
};

// ─── Respuestas ─────────────────────────────────────────────────────────────
function json(data, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": TYPES.json, "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
  });
}

function text(body, status = 200) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function parseIds(url, max) {
  const ids = [...new Set((url.searchParams.get("ids") || "").split(",").map(s => s.trim()).filter(s => /^\d{1,20}$/.test(s)))];
  return ids.slice(0, max);
}

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function getJson(url, cacheTtl) {
  const r = await fetch(url, {
    headers: { "user-agent": "roblox-tracker/2.0", accept: "application/json" },
    cf: { cacheTtl, cacheEverything: true },
  });
  if (!r.ok) throw new Error(`Roblox respondió ${r.status}`);
  return r.json();
}

// ─── Web y datos públicos (desde R2) ────────────────────────────────────────
async function site(env, path) {
  let key;
  if (path === "/" || path === "/index.html" || path === "/dashboard.html") key = "site/dashboard.html";
  else if (path === "/favicon.svg") key = "site/favicon.svg";
  else if (path.startsWith("/data/") && !path.includes("..")) key = path.slice(1);
  else return text("No encontrado", 404);

  const ext = key.split(".").pop();
  // Transición: mientras GitHub Actions siga muestreando, los datos se leen
  // del repo público (cacheados 2 min). La web sí sale de R2.
  if (key.startsWith("data/") && GITHUB_DATA) {
    const r = await fetch(`${GITHUB_DATA}/${key}`, { cf: { cacheTtl: 120, cacheEverything: true } });
    if (!r.ok) return text("No encontrado", 404);
    return new Response(r.body, {
      headers: { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": "public, max-age=60" },
    });
  }
  const obj = await env.BUCKET.get(key);
  if (!obj) return text("No encontrado", 404);
  return new Response(obj.body, {
    headers: {
      "content-type": TYPES[ext] || "application/octet-stream",
      // la web y los JSON se refrescan pronto; el resto puede cachearse más
      "cache-control": ext === "html" ? "no-cache" : ext === "json" ? "public, max-age=60" : "public, max-age=300",
      etag: obj.httpEtag,
    },
  });
}

// ─── En vivo ────────────────────────────────────────────────────────────────
async function live(url) {
  const ids = parseIds(url, MAX_LIVE_IDS);
  if (!ids.length) return json({ error: "Faltan ids" }, 400);
  const [games, icons] = await Promise.all([
    Promise.all(chunks(ids, 50).map(c => getJson(`${GAMES_API}?universeIds=${c.join(",")}`, 30))),
    Promise.all(chunks(ids, 100).map(c =>
      getJson(`${ICONS_API}?universeIds=${c.join(",")}&size=150x150&format=Webp&returnPolicy=PlaceHolder`, 21600)
        .catch(() => ({ data: [] })))),
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
  const data = await getJson(
    `${THUMBS_API}?universeIds=${ids.join(",")}&countPerUniverse=1&size=768x432&format=Webp&defaults=true`, 21600);
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
    getJson(`${GAMES_API}?universeIds=${id}`, 30),
    getJson(`${THUMBS_API}?universeIds=${id}&countPerUniverse=1&size=768x432&format=Webp&defaults=true`, 21600)
      .catch(() => ({ data: [] })),
    getJson(`${ICONS_API}?universeIds=${id}&size=256x256&format=Webp&returnPolicy=PlaceHolder`, 21600)
      .catch(() => ({ data: [] })),
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

// ─── Almacenamiento privado (GitHub Actions) ────────────────────────────────
async function authorized(req, env) {
  const got = new TextEncoder().encode(req.headers.get("authorization") || "");
  const want = new TextEncoder().encode(`Bearer ${env.INGEST_TOKEN || ""}`);
  if (!env.INGEST_TOKEN || got.byteLength !== want.byteLength) return false;
  return crypto.subtle.timingSafeEqual(got, want);
}

async function storage(req, env, url) {
  if (!(await authorized(req, env))) return json({ error: "No autorizado" }, 401);

  if (url.pathname === "/api/files") {
    const prefix = url.searchParams.get("prefix") || "";
    const files = [];
    let cursor;
    do {
      const page = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
      for (const o of page.objects) files.push({ key: o.key, size: o.size, etag: o.etag });
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return json({ files });
  }

  const key = decodeURIComponent(url.pathname.slice("/api/file/".length));
  if (!/^(data|site)\/[\w.\-\/]+$/.test(key) || key.includes("..")) return json({ error: "Clave no válida" }, 400);

  if (req.method === "GET") {
    const obj = await env.BUCKET.get(key);
    return obj ? new Response(obj.body, { headers: { etag: obj.httpEtag } }) : json({ error: "No existe" }, 404);
  }
  if (req.method === "PUT") {
    const ext = key.split(".").pop();
    const obj = await env.BUCKET.put(key, req.body, { httpMetadata: { contentType: TYPES[ext] || "application/octet-stream" } });
    return json({ key, etag: obj.etag, size: obj.size });
  }
  if (req.method === "DELETE") {
    await env.BUCKET.delete(key);
    return json({ key, deleted: true });
  }
  return json({ error: "Método no permitido" }, 405);
}
