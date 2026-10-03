/**
 * sources.js — Clientes de las APIs públicas que usa el muestreo.
 *
 *   Rolimons gamelist · Explore API · Search API · Games API · Votes API
 *   place → universe · iconos y miniaturas
 *
 * Todo pasa por `getJson()`, que reintenta con backoff y lleva la cuenta de
 * peticiones externas en un `Budget` (el plan gratis permite 50 por invocación:
 * cada paso del Workflow crea el suyo y no lo pasa de largo).
 *
 * Sin dependencias: funciona igual en el Worker y en Node ≥ 18 (para medir).
 */

export const UA = "roblox-tracker/3.0 (+https://robloxtracker.stonksstudio.com)";

export const URLS = {
  rolimons: "https://api.rolimons.com/games/v1/gamelist",
  sorts: "https://apis.roblox.com/explore-api/v1/get-sorts",
  sortContent: "https://apis.roblox.com/explore-api/v1/get-sort-content",
  search: "https://apis.roblox.com/search-api/omni-search",
  games: "https://games.roblox.com/v1/games",
  votes: "https://games.roblox.com/v1/games/votes",
  placeUniverse: "https://apis.roblox.com/universes/v1/places/",
  icons: "https://thumbnails.roblox.com/v1/games/icons",
  thumbs: "https://thumbnails.roblox.com/v1/games/multiget/thumbnails",
};

export const GAMES_BATCH = 50;   // la Games API rechaza más de 50 ids ("Too many universe IDs")
export const VOTES_BATCH = 50;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Cuenta las peticiones externas de una invocación y corta antes del límite. */
export class Budget {
  constructor(max = 45) { this.max = max; this.used = 0; }
  take() {
    if (this.used >= this.max) throw new BudgetError(`Presupuesto de peticiones agotado (${this.max})`);
    this.used++;
  }
  get left() { return this.max - this.used; }
}
export class BudgetError extends Error {}

/**
 * GET con reintentos. Devuelve el cuerpo (JSON o texto) o `null` si no hay datos.
 *  - 429 y 5xx: reintenta con backoff exponencial (respeta Retry-After).
 *  - otros 4xx: null sin reintentar.
 *  - `empty(data)`: si devuelve true, la respuesta cuenta como fallida y se
 *    reintenta (la Search API devuelve 200 vacío cuando se le pide mucho).
 */
export async function getJson(url, { budget, retries = 3, base = 800, text = false, empty, cf } = {}) {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (budget && budget.left <= 0) break;
    budget?.take();
    try {
      const init = { headers: { "user-agent": UA, accept: "application/json" } };
      if (cf) init.cf = cf;
      const r = await fetch(url, init);
      if (r.ok) {
        const data = text ? await r.text() : await r.json();
        if (!empty || !empty(data)) return data;
        last = "vacía";
      } else {
        // Hay que consumir el cuerpo para liberar la conexión
        await r.body?.cancel?.();
        last = r.status;
        if (r.status >= 400 && r.status < 500 && r.status !== 429) return null;
        const ra = Number(r.headers.get("retry-after"));
        if (ra > 0 && ra < 30) { await sleep(ra * 1000); continue; }
      }
    } catch (e) {
      if (e instanceof BudgetError) throw e;
      last = String(e?.message || e);
    }
    if (attempt < retries) await sleep(base * 2 ** attempt + Math.random() * 300);
  }
  if (last !== null) console.warn(`getJson: sin datos de ${url.split("?")[0]} (${last})`);
  return null;
}

/** Ejecuta `fn` sobre `items` con como mucho `limit` en vuelo (Workers: 6 conexiones). */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ─── Rolimons ─────────────────────────────────────────────────────────────────
/**
 * Filtra el texto del gamelist de Rolimons sin JSON.parse.
 * Formato: {"success":true,"game_count":N,"games":{"<placeId>":["<name>",<players>,"<icon>"],…}}
 *
 * Una expresión regular (código nativo de V8) busca `",<jugadores>,` solo con
 * números ≥ 300; para cada acierto se retrocede con lastIndexOf hasta el
 * `"<placeId>":["`. Así solo se crean objetos para los ~2.100 juegos que pasan.
 * Devuelve [[placeId, name, players], …].
 *
 * Medido en Node 22 --single-threaded con el fichero real (1,05 MB, 7.602 juegos),
 * primera llamada (sin JIT, como en el Worker): JSON.parse + filtro 12–17 ms;
 * este escaneo ≈ 3,1 ms (ver README y test/bench_rolimons.mjs).
 */
export function filterRolimons(text, minPlayers = 300) {
  const rx = playersRegex(minPlayers);
  const out = [];
  let m;
  while ((m = rx.exec(text))) {
    const e = m.index;
    // La comilla de `",` no puede estar escapada (sería parte del nombre)
    let bs = 0;
    for (let k = e - 1; text.charCodeAt(k) === 92; k--) bs++;
    if (bs & 1) continue;
    const q = text.lastIndexOf('":["', e);
    if (q < 0) continue;
    const pq = text.lastIndexOf('"', q - 1);
    const pid = text.slice(pq + 1, q);
    if (!/^\d{1,20}$/.test(pid)) continue;
    let name = text.slice(q + 4, e);
    if (name.includes("\\")) {
      try { name = JSON.parse(`"${name}"`); } catch { /* se queda escapado */ }
    }
    const players = Number(m[1]);
    if (players >= minPlayers) out.push([Number(pid), name, players]);
  }
  return out;
}

/** `",<n>,` o `",<n>]` con n ≥ min (prefiltro por nº de dígitos; el resto se comprueba después). */
function playersRegex(min) {
  const digits = String(Math.max(1, Math.floor(min))).length;
  const lead = String(min)[0];
  // Mismo nº de dígitos con primera cifra ≥ la de `min`, o más dígitos
  const same = `[${lead}-9]\\d{${digits - 1}}`;
  const more = `[1-9]\\d{${digits},}`;
  return new RegExp(`",(${same}|${more})[,\\]]`, "g");
}

/** El mismo filtro con JSON.parse (referencia para medir y comprobar). */
export function filterRolimonsParse(text, minPlayers) {
  const data = JSON.parse(text);
  const out = [];
  for (const pid in data.games) {
    const g = data.games[pid];
    if (g && g[1] >= minPlayers) out.push([Number(pid), g[0], g[1]]);
  }
  return out;
}

export async function fetchRolimons(budget, minPlayers) {
  const text = await getJson(URLS.rolimons, { budget, text: true, retries: 3, base: 2000 });
  if (!text || !text.includes('"games"')) return null;
  return filterRolimons(text, minPlayers);
}

// ─── Explore API (listas oficiales de Roblox) ─────────────────────────────────
function exploreParams(sessionId) {
  return `sessionId=${sessionId}&device=computer&country=all`;
}

/** Una página de get-sorts. → { sorts: {sortId: [[uid, placeId, name, players], …]}, pending: [[sortId, token, nº filas]], next } */
export async function fetchSortsPage(budget, sessionId, token = null) {
  const url = `${URLS.sorts}?${exploreParams(sessionId)}${token ? `&sortsPageToken=${encodeURIComponent(token)}` : ""}`;
  const d = await getJson(url, { budget });
  if (!d) return null;
  const sorts = {}, pending = [];
  for (const s of d.sorts || []) {
    if (s.contentType !== "Games" || !s.sortId || !Array.isArray(s.games)) continue;
    sorts[s.sortId] = s.games.map(gameTuple);
    if (s.nextPageToken) pending.push([s.sortId, s.nextPageToken, s.games.length]);
  }
  return { sorts, pending, next: d.nextSortsPageToken || null };
}

/** Páginas siguientes de una lista (get-sort-content con pageToken). → [[uid, placeId, name, players], …] */
export async function fetchSortContent(budget, sessionId, sortId, token, maxPages = 6) {
  const out = [];
  let pt = token, n = 0;
  while (pt && n < maxPages && budget.left > 0) {
    const url = `${URLS.sortContent}?${exploreParams(sessionId)}&sortId=${encodeURIComponent(sortId)}&pageToken=${encodeURIComponent(pt)}`;
    const d = await getJson(url, { budget });
    if (!d) break;
    n++;
    for (const g of d.games || []) out.push(gameTuple(g));
    pt = d.nextPageToken || null;
  }
  return out;
}

/** Todas las listas de una vez (para pruebas; el Workflow va página a página). */
export async function fetchExplore(budget, { maxSortPages = 8, maxContentPages = 6 } = {}) {
  const sid = crypto.randomUUID();
  const sorts = {};
  const pending = [];
  let token = null, pages = 0;
  do {
    const r = await fetchSortsPage(budget, sid, token);
    if (!r) break;
    pages++;
    Object.assign(sorts, r.sorts);
    pending.push(...r.pending);
    token = r.next;
  } while (token && pages < maxSortPages && budget.left > 2);
  for (const [sortId, t] of pending) sorts[sortId].push(...await fetchSortContent(budget, sid, sortId, t, maxContentPages));
  return sorts;
}

function gameTuple(g) {
  return [g.universeId, g.rootPlaceId || null, g.name || null, g.playerCount ?? null];
}

// ─── Search API ───────────────────────────────────────────────────────────────
/**
 * Hasta `pages` páginas de omni-search para `query`. Devuelve [[uid, placeId, name, players], …]
 * en el orden de los resultados. Si se le pide mucho seguido, la API responde
 * 200 con `searchResults` vacío: la primera página se reintenta con espera
 * y entre páginas se esperan `gapMs`.
 */
export async function fetchSearch(budget, query, { pages = 3, gapMs = 1200 } = {}) {
  const sid = crypto.randomUUID();
  const out = [];
  let token = null;
  for (let p = 0; p < pages; p++) {
    if (p) await sleep(gapMs);
    const url = `${URLS.search}?searchQuery=${encodeURIComponent(query)}&sessionId=${sid}&pageType=all` +
      (token ? `&pageToken=${encodeURIComponent(token)}` : "");
    const d = await getJson(url, {
      budget, retries: p === 0 ? 3 : 1, base: 2500,
      empty: x => !Array.isArray(x?.searchResults) || x.searchResults.length === 0,
    });
    if (!d) break;
    for (const grp of d.searchResults) {
      if (grp.contentGroupType !== "Game") continue;
      for (const g of grp.contents || []) if (g.universeId) out.push(gameTuple(g));
    }
    token = d.nextPageToken || null;
    if (!token) break;
  }
  return out;
}

// ─── Games / Votes ────────────────────────────────────────────────────────────
/**
 * Detalles de juegos en lotes de 50 (`concurrency` en paralelo).
 * Devuelve { data: [game…], failed: nº de lotes sin respuesta }.
 */
export async function fetchGames(budget, ids, { concurrency = 4 } = {}) {
  const res = await pool(chunks(ids, GAMES_BATCH), concurrency, c =>
    getJson(`${URLS.games}?universeIds=${c.join(",")}`, { budget, retries: 2 }));
  return collect(res);
}

export async function fetchVotes(budget, ids, { concurrency = 4 } = {}) {
  const res = await pool(chunks(ids, VOTES_BATCH), concurrency, c =>
    getJson(`${URLS.votes}?universeIds=${c.join(",")}`, { budget, retries: 2 }));
  return collect(res);
}

function collect(pages) {
  const data = [];
  let failed = 0;
  for (const p of pages) {
    if (p && Array.isArray(p.data)) data.push(...p.data);
    else failed++;
  }
  return { data, failed };
}

/** place_id → universe_id (una llamada por place). Devuelve [[placeId, universeId|null], …]. */
export async function resolvePlaces(budget, placeIds, { concurrency = 5 } = {}) {
  return pool(placeIds, concurrency, async pid => {
    const d = await getJson(`${URLS.placeUniverse}${pid}/universe`, { budget, retries: 1 });
    return [pid, d?.universeId || null];
  });
}

// ─── Iconos y miniaturas (rutas en vivo) ─────────────────────────────────────
export function iconsUrl(ids, size = "150x150") {
  return `${URLS.icons}?universeIds=${ids.join(",")}&size=${size}&format=Webp&returnPolicy=PlaceHolder`;
}

export function thumbsUrl(ids) {
  return `${URLS.thumbs}?universeIds=${ids.join(",")}&countPerUniverse=1&size=768x432&format=Webp&defaults=true`;
}
