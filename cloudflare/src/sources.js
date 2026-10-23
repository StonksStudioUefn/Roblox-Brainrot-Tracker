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

// Sin tope, una petición colgada bloqueaba su paso hasta el timeout del Workflow (10 min).
export const FETCH_TIMEOUT_MS = 20_000;

export class Budget {
  constructor(max = 45) { this.max = max; this.used = 0; }
  take() {
    if (this.used >= this.max) throw new BudgetError(`Presupuesto de peticiones agotado (${this.max})`);
    this.used++;
  }
  get left() { return this.max - this.used; }
}
export class BudgetError extends Error {}

// El tope de 50 subrequests es por invocación y varios pasos la comparten (visto en producción).
export class SubBudget extends Budget {
  constructor(parent, max) { super(max); this.parent = parent; }
  take() {
    if (this.used >= this.max) throw new BudgetError(`Presupuesto del paso agotado (${this.max})`);
    this.parent.take();
    this.used++;
  }
  get left() { return Math.min(this.max - this.used, this.parent.left); }
}

// empty(): la Search API da 200 vacío cuando se le pide mucho; cuenta como un fallo más.
export async function getJson(url, { budget, retries = 3, base = 800, text = false, empty, cf, timeout = FETCH_TIMEOUT_MS } = {}) {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (budget && budget.left <= 0) break;
    budget?.take();
    try {
      const init = { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(timeout) };
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

// Workers: 6 conexiones a la vez como mucho.
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

// Sin JSON.parse: ~3 ms frente a 12–17 ms en frío con el fichero real (test/bench_rolimons.mjs).
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

function playersRegex(min) {
  const digits = String(Math.max(1, Math.floor(min))).length;
  const lead = String(min)[0];
  const same = `[${lead}-9]\\d{${digits - 1}}`;
  const more = `[1-9]\\d{${digits},}`;
  return new RegExp(`",(${same}|${more})[,\\]]`, "g");
}

export async function fetchRolimons(budget, minPlayers) {
  const text = await getJson(URLS.rolimons, { budget, text: true, retries: 3, base: 2000 });
  if (!text || !text.includes('"games"')) return null;
  return filterRolimons(text, minPlayers);
}

function exploreParams(sessionId) {
  return `sessionId=${sessionId}&device=computer&country=all`;
}

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

function gameTuple(g) {
  return [g.universeId, g.rootPlaceId || null, g.name || null, g.playerCount ?? null];
}

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

export async function resolvePlaces(budget, placeIds, { concurrency = 5 } = {}) {
  return pool(placeIds, concurrency, async pid => {
    const d = await getJson(`${URLS.placeUniverse}${pid}/universe`, { budget, retries: 1 });
    return [pid, d?.universeId || null];
  });
}

export function iconsUrl(ids, size = "150x150") {
  return `${URLS.icons}?universeIds=${ids.join(",")}&size=${size}&format=Webp&returnPolicy=PlaceHolder`;
}

export function thumbsUrl(ids) {
  return `${URLS.thumbs}?universeIds=${ids.join(",")}&countPerUniverse=1&size=768x432&format=Webp&defaults=true`;
}
