/**
 * sampler.js — Workflow `Sampler`: un muestreo completo, por pasos.
 *
 * Lo lanza el cron cada 3 h (index.js → scheduled) o /api/admin/run.
 * Cada `step.do` cabe en 10 ms de CPU (medido: README "CPU por paso") y en
 * ≤ 45 peticiones externas (Budget), y es idempotente: Workflows lo reintenta
 * si falla, y los pasos ya hechos no se repiten al reanudar.
 *
 * Límite de 50 peticiones externas: en el plan gratis es POR INVOCACIÓN y los
 * pasos de una instancia comparten invocación (comprobado en producción el
 * 03/10/2026: «Too many subrequests by single Worker invocation»). Por eso una
 * pasada son varias ejecuciones encadenadas: cada una lleva la cuenta de sus
 * peticiones (INVOCATION_BUDGET) y, cuando el paso siguiente ya no cabe, crea
 * la siguiente (`<id>-sN`) con la fase y el punto donde seguir. Las listas que
 * necesitan las siguientes (ids a muestrear, places por resolver, votos) van a
 * R2 tmp/run/<id>/ y se borran al terminar. Estado en D1: run_current.
 *
 * Pasos:  init → explore-0..P (una página de get-sorts por paso) → explore-more →
 *         search-0..N → search-cursor → [rolimons → resolve-0..K] →
 *         sample-list → sample-0..M (en la 1ª pasada del día: meta, horror y votos) →
 *         [close] → maint → export-plan → export-0..E → export-join → telegram → finish
 *
 * Parámetros (event.payload): now (ISO), daily (forzar 1ª pasada del día),
 * skip: [nombres], only: [nombres] (explore, search, rolimons, sample, close,
 * maint, export, telegram), telegram_force ('daily' | 'weekly').
 */

import { WorkflowEntrypoint } from "cloudflare:workers";
import {
  SAMPLE_RETENTION_DAYS, SEARCH_PAGES_PER_QUERY, SEARCH_QUERIES, SEARCH_QUERIES_PER_RUN,
  TRACK_MIN_PLAYERS,
} from "./config.js";
import {
  Budget, SubBudget, chunks, fetchGames, fetchRolimons, fetchSearch, fetchSortContent, fetchSortsPage, fetchVotes,
  resolvePlaces,
} from "./sources.js";
import {
  DAY_MIN, addDays, applyVotesStmt, buildExportSlice, closeDayStmt, exportHeader, exportPlan, getState,
  getStates, insertPlacesStmt, insertSamplesStmt, isoDate, isoMinute, lastSampleTs, lowSinceStmts,
  mergeHistStmt, minuteOf, pruneOrphansStmt, pruneSamplesStmt, retrackPlacesStmt,
  setState, setStateStmt, sortHitsStmt, trackedIds, unknownPlaces, untrackStmt, updateMetaStmt,
  upsertDiscoveredStmt, written,
} from "./db.js";
import { classifyHorror } from "./horror.js";
import { pickCandidates, runTelegram, telegramScanText } from "./telegram.js";

// Tamaños de trozo (CPU medida en frío: ver README "CPU por paso")
export const SAMPLE_CHUNK = 400;       // 8 lotes de 50: parsear ~560 KB de la Games API ≈ 4,3 ms
export const META_CHUNK = 50;          // 1 lote + votos + horror de 50 (horror en frío ≈ 4,2 ms)
export const RESOLVE_CHUNK = 40;       // place → universe por paso (1 petición cada uno)
export const RESOLVE_PER_DAY = 200;
export const EXPLORE_MAX_PAGES = 8;    // páginas de get-sorts (hoy son 5)
export const EXPORT_SLICE = 500;       // juegos seguidos por trozo del export (≈ 250 exportados, ≈ 450 KB)
export const TG_SCAN_GAMES = 50;       // juegos por paso de telegramScanText (en régimen y en frío: 50 ≈ 4 ms, 100 ≈ 9 ms)
export const EXPORT_KEY = "data/export.json";
export const TELEGRAM_KEY = "data/telegram.json";
export const PART_PREFIX = "tmp/export/part-";
export const RUN_PREFIX = "tmp/run/";        // listas que pasan de una ejecución a otra

// Peticiones externas: el plan gratis da 50 por invocación. Se deja margen.
export const INVOCATION_BUDGET = 46;
export const SEARCH_NEED = 9;          // 3 páginas + reintentos
export const ROLIMONS_NEED = 4;
export const SAMPLE_NEED = 12;         // 8 lotes de la Games API + reintentos
export const META_NEED = 6;            // 1 lote + votos + reintentos
export const TELEGRAM_NEED = 30;       // miniaturas + envíos (peor caso medido: 27)

const STEP = { retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }, timeout: "10 minutes" };
const STEP_ONCE = { retries: { limit: 1, delay: "30 seconds", backoff: "constant" }, timeout: "5 minutes" };

export class Sampler extends WorkflowEntrypoint {
  async run(event, step) {
    const env = this.env;
    const db = env.DB;
    const p = event.payload || {};
    const skip = new Set(p.skip || []);
    const only = p.only ? new Set(p.only) : null;
    const want = name => !skip.has(name) && (!only || only.has(name));
    const seg = p.seg || 0;                        // nº de esta ejecución dentro de la pasada
    const base = p.base || event.instanceId;       // id de la primera ejecución de la pasada
    const tmp = `${RUN_PREFIX}${base}/`;
    // Peticiones externas de ESTA invocación (plan gratis: 50). Los pasos ya
    // hechos que se reanudan no vuelven a pedir nada, así que no gastan.
    const inv = new Budget(INVOCATION_BUDGET);
    const sub = n => new SubBudget(inv, n);
    const summary = p.summary || { steps: {}, errors: [] };
    summary.steps ||= {};
    summary.errors ||= [];
    summary.segments = seg + 1;

    // Un paso que falla tras sus reintentos no tumba la pasada entera
    const safe = async (name, fn, cfg = STEP) => {
      try {
        const r = await step.do(name, cfg, fn);
        summary.steps[name] = r?.stats ?? r ?? null;
        return r;
      } catch (e) {
        summary.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
        return null;
      }
    };

    // Sigue la pasada en otra ejecución (= otra invocación, con sus 50 peticiones)
    const next = async (phase, cursor = 0) => {
      await step.do(`next-${phase}-${cursor}`, STEP, async () => {
        const id = `${base}-s${seg + 1}`;
        try {
          await env.SAMPLER.create({ id, params: { ...p, seg: seg + 1, base, init, phase, cursor, summary: compact(summary) } });
        } catch (e) {
          if (!/already exists|duplicate/i.test(String(e?.message || e))) throw e;
        }
        await setState(db, "run_current", { base, seg: seg + 1, id, phase, cursor });
        return { next: id, phase, cursor };
      });
      return { ...compact(summary), continued_in: `${base}-s${seg + 1}` };
    };

    // ── init (solo en la primera ejecución; las demás lo reciben) ─────────
    const init = p.init || await step.do("init", STEP, async () => {
      const ms = p.now ? Date.parse(p.now) : new Date(event.timestamp || Date.now()).getTime();
      const ts = minuteOf(ms);
      const today = isoDate(ts);
      const st = await getStates(db, ["day", "closed_day", "search_cursor"]);
      await setState(db, "run_current", { base, seg, id: base, phase: "discover", cursor: 0 });
      return {
        ts, today,
        firstOfDay: !!p.daily || st.day !== today,
        closedDay: st.closed_day || null,
        cursor: Number(st.search_cursor) || 0,
        session: crypto.randomUUID(),
      };
    });
    const { ts, today } = init;
    const firstSeen = isoMinute(ts);
    summary.ts = firstSeen;
    summary.first_of_day = init.firstOfDay;
    const order = ["discover", "search", "rolimons", "resolve", "sample", "finalize"];
    const at = order.indexOf(p.phase || "discover");
    const reach = ph => order.indexOf(ph) >= at;
    const startCursor = ph => (ph === (p.phase || "discover") ? p.cursor || 0 : 0);

    // ── discover: explore (una página de get-sorts por paso, luego get-sort-content)
    if (reach("discover") && want("explore")) {
      let token = null;
      const pending = [];
      for (let i = 0; i < EXPLORE_MAX_PAGES; i++) {
        const r = await safe(`explore-${i}`, async () => {
          const budget = sub(4);
          const page = await fetchSortsPage(budget, init.session, token);
          if (!page) throw new Error("Explore API sin respuesta");
          const res = await saveExplore(db, page.sorts, today, firstSeen);
          return { stats: { ...res, calls: budget.used }, pending: page.pending, next: page.next };
        });
        if (!r) break;
        pending.push(...r.pending);
        token = r.next;
        if (!token) break;
      }
      if (pending.length) {
        await safe("explore-more", async () => {
          const budget = sub(12);
          const sorts = {}, offsets = {};
          for (const [sortId, t, firstLen] of pending) {
            sorts[sortId] = await fetchSortContent(budget, init.session, sortId, t, 6);
            offsets[sortId] = firstLen;   // el puesto sigue al de la primera página
          }
          const res = await saveExplore(db, sorts, today, firstSeen, offsets);
          return { ...res, lists: pending.length, calls: budget.used };
        });
      }
    }

    // ── search (por turnos) ───────────────────────────────────────────────
    if (reach("search") && want("search")) {
      const n = Math.min(SEARCH_QUERIES_PER_RUN, SEARCH_QUERIES.length);
      for (let k = startCursor("search"); k < n; k++) {
        if (inv.left < SEARCH_NEED) return await next("search", k);
        const query = SEARCH_QUERIES[(init.cursor + k) % SEARCH_QUERIES.length];
        const source = `search:${query}`;
        // La Search API castiga las ráfagas: pausa entre búsquedas
        if (k) await step.sleep(`pausa search-${k}`, "3 seconds");
        await safe(`search-${k}`, async () => {
          const budget = sub(SEARCH_NEED);
          const found = await fetchSearch(budget, query, { pages: SEARCH_PAGES_PER_QUERY });
          if (!found.length) throw new Error(`Search API sin resultados para "${query}"`);
          const seen = new Set();
          const rows = [], hits = [];
          found.forEach(([uid, place, name, players], i) => {
            if (seen.has(uid) || (players ?? 0) < TRACK_MIN_PLAYERS) return;
            seen.add(uid);
            rows.push([uid, place, name]);
            hits.push([uid, source, i + 1]);
          });
          const res = rows.length
            ? await db.batch([upsertDiscoveredStmt(db, rows, source, firstSeen), sortHitsStmt(db, hits, today)])
            : [];
          return { query, results: found.length, kept: rows.length, calls: budget.used, written: written(res) };
        });
      }
      await safe("search-cursor", async () => {
        const nxt = (init.cursor + n) % SEARCH_QUERIES.length;
        await setState(db, "search_cursor", nxt);
        return { next: nxt };
      });
    }

    // ── rolimons (1ª pasada del día): la lista de places por resolver va a R2
    const daily = init.firstOfDay && want("rolimons");
    if (daily && reach("rolimons")) {
      if (inv.left < ROLIMONS_NEED) return await next("rolimons");
      await safe("rolimons", async () => {
        const budget = sub(ROLIMONS_NEED);
        const list = await fetchRolimons(budget, TRACK_MIN_PLAYERS);
        if (!list || !list.length) throw new Error("Rolimons no devolvió la lista");
        const pids = list.map(r => r[0]);
        const [unknown, res] = await Promise.all([
          unknownPlaces(db, pids),
          retrackPlacesStmt(db, pids).run(),
        ]);
        const byPid = new Map(list.map(r => [r[0], r]));
        // Primero los que más jugadores tienen; tope diario
        const todo = unknown.map(pid => byPid.get(pid)).sort((a, b) => b[2] - a[2])
          .slice(0, RESOLVE_PER_DAY).map(([pid, name]) => [pid, name]);
        await env.BUCKET.put(`${tmp}resolve.json`, JSON.stringify(todo));
        return { stats: { games: list.length, unknown: unknown.length, todo: todo.length, calls: budget.used, written: written(res) } };
      });
    }
    if (daily && reach("resolve")) {
      const todo = await step.do(`resolve-list-${seg}`, STEP, async () => {
        const o = await env.BUCKET.get(`${tmp}resolve.json`);
        return o ? await o.json() : [];
      });
      const parts = chunks(todo, RESOLVE_CHUNK);
      for (let i = startCursor("resolve"); i < parts.length; i++) {
        if (inv.left < RESOLVE_CHUNK + 4) return await next("resolve", i);
        const part = parts[i];
        await safe(`resolve-${i}`, async () => {
          const budget = sub(RESOLVE_CHUNK + 4);
          const got = await resolvePlaces(budget, part.map(r => r[0]));
          const names = new Map(part);
          const ok = got.filter(([, uid]) => uid);
          const res = ok.length ? await db.batch([
            insertPlacesStmt(db, ok),
            upsertDiscoveredStmt(db, ok.map(([pid, uid]) => [uid, pid, names.get(pid)]), "rolimons", firstSeen),
          ]) : [];
          return { asked: part.length, resolved: ok.length, calls: budget.used, written: written(res) };
        });
      }
    }

    // ── sample-N (+ meta diario): la lista de ids va a R2 para las demás ejecuciones
    if (reach("sample") && want("sample")) {
      const meta = init.firstOfDay;
      const ids = await step.do(`sample-list-${seg}`, STEP, async () => {
        const key = `${tmp}ids.json`;
        if (p.phase === "sample") {
          const o = await env.BUCKET.get(key);
          if (o) return await o.json();
        }
        const list = await trackedIds(db);
        await env.BUCKET.put(key, JSON.stringify(list));
        return list;
      });
      const size = meta ? META_CHUNK : SAMPLE_CHUNK;
      const need = meta ? META_NEED : SAMPLE_NEED;
      const parts = chunks(ids, size);
      const agg = summary.steps.sample || { games: 0, samples: 0, failed: 0, meta: 0, calls: 0, written: 0, steps: parts.length };
      for (let i = startCursor("sample"); i < parts.length; i++) {
        if (inv.left < need) { summary.steps.sample = agg; return await next("sample", i); }
        const name = `sample-${i}`;
        let r = null;
        try {
          r = await step.do(name, STEP, async () => {
            const out = await sampleChunk(db, parts[i], { ts, today, meta, budget: sub(need) });
            // Los votos se aplican en el cierre del día, que puede ir en otra ejecución
            if (out.votes) await env.BUCKET.put(`${tmp}votes-${i}.json`, JSON.stringify(out.votes));
            return { stats: out.stats };
          });
        } catch (e) {
          summary.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
        }
        for (const k of Object.keys(agg)) if (k !== "steps") agg[k] += r?.stats?.[k] || 0;
      }
      summary.steps.sample = agg;   // un resumen (con meta son ~45 pasos)
    }

    // ── finalize: cierre, mantenimiento, export y Telegram (en una ejecución
    // nueva si ya no quedan peticiones para Telegram)
    if (inv.left < TELEGRAM_NEED && want("telegram") && p.phase !== "finalize") return await next("finalize");

    const yesterday = addDays(today, -1);
    if (want("close") && (init.firstOfDay || !init.closedDay || init.closedDay < yesterday)) {
      await safe("close", async () => {
        // Votos guardados por los pasos sample-N con meta
        const votes = {};
        if (init.firstOfDay) {
          const listed = await env.BUCKET.list({ prefix: `${tmp}votes-` });
          for (const o of listed.objects) {
            const obj = await env.BUCKET.get(o.key);
            if (obj) Object.assign(votes, await obj.json());
          }
        }
        const oldest = addDays(today, -SAMPLE_RETENTION_DAYS);
        let from = init.closedDay ? addDays(init.closedDay, 1) : yesterday;
        if (from < oldest) from = oldest;
        const stmts = [];
        const dates = [];
        for (let d = from; d <= yesterday; d = addDays(d, 1)) {
          dates.push(d);
          stmts.push(closeDayStmt(db, d, d === yesterday ? votes : null), mergeHistStmt(db, d));
        }
        if (!dates.length && Object.keys(votes).length) {
          stmts.push(applyVotesStmt(db, yesterday, votes), mergeHistStmt(db, yesterday));
        }
        const closed = init.closedDay && init.closedDay > yesterday ? init.closedDay : yesterday;
        stmts.push(setStateStmt(db, "closed_day", closed));
        if (init.firstOfDay) stmts.push(setStateStmt(db, "day", today));
        const res = await db.batch(stmts);
        return { dates, votes: Object.keys(votes).length, written: written(res) };
      });
    }

    // ── maint: poda de muestras y untrack ─────────────────────────────────
    if (want("maint")) {
      await safe("maint", async () => {
        const cutoff = ts - SAMPLE_RETENTION_DAYS * DAY_MIN;
        const stmts = [pruneSamplesStmt(db, cutoff), untrackStmt(db, today)];
        if (init.firstOfDay) stmts.push(pruneOrphansStmt(db, cutoff));
        const res = await db.batch(stmts);
        return { pruned: res[0]?.meta?.changes ?? 0, untracked: res[1]?.meta?.changes ?? 0, written: written(res) };
      });
    }

    // ── export → R2 (por trozos) ──────────────────────────────────────────
    let exported = null;
    if (want("export")) exported = await runExport(env, step, ts * 60000, safe, summary);

    // ── telegram (lee data/telegram.json, el export reducido) ─────────────
    if (want("telegram") && exported?.telegram) {
      await safe("telegram", async () => {
        const obj = await env.BUCKET.get(TELEGRAM_KEY);
        if (!obj) throw new Error("No hay data/telegram.json en R2");
        const exportData = await obj.json();
        const r = await runTelegram({
          env, exportData, now: new Date(ts * 60000),
          getState: key => getState(db, key),
          setState: (key, value) => setState(db, key, value),
          force: p.telegram_force || undefined,
          maxFetch: Math.max(0, inv.left),   // lo que queda de las 50 de esta invocación
        });
        return r ?? { ok: true };
      }, STEP_ONCE);
    }

    // ── finish ────────────────────────────────────────────────────────────
    await step.do("finish", STEP, async () => {
      summary.finished_at = new Date().toISOString().slice(0, 19) + "Z";
      summary.instance = event.instanceId || null;
      summary.base = base;
      // Las pasadas parciales (only: […], p. ej. un export manual) no tapan la última completa
      await setState(db, only ? "last_partial_run" : "last_run", compact(summary));
      await setState(db, "run_current", null);
      // Ficheros temporales de la pasada
      const listed = await env.BUCKET.list({ prefix: tmp });
      if (listed.objects.length) await env.BUCKET.delete(listed.objects.map(o => o.key));
      return { errors: summary.errors.length, segments: seg + 1 };
    });
    return compact(summary);
  }
}

/** Resumen que viaja entre ejecuciones (los parámetros de un Workflow tienen tope). */
function compact(summary) {
  const out = { ...summary, errors: (summary.errors || []).slice(-30) };
  const steps = {};
  for (const [k, v] of Object.entries(summary.steps || {})) {
    if (/^(explore-\d+|resolve-\d+|search-\d+|export-\d+|tg-scan-)/.test(k)) continue;   // demasiados: van en el total
    steps[k] = v;
  }
  out.steps = steps;
  return out;
}

/** Guarda una tanda de listas de Explore. `offsets[sortId]`: filas ya vistas de esa lista. */
async function saveExplore(db, sorts, today, firstSeen, offsets = {}) {
  // Juegos nuevos solo con ≥ TRACK_MIN_PLAYERS (las listas temáticas traen
  // muchos pequeños y cada juego seguido son 8 muestras + 8 borrados al día);
  // los puestos se guardan para todos los juegos que ya conocemos.
  const games = new Map();
  const hits = new Map();
  let n = 0;
  for (const [sortId, list] of Object.entries(sorts)) {
    n++;
    const offset = offsets[sortId] || 0;
    list.forEach(([uid, place, name, players], i) => {
      if (!uid) return;
      if (!games.has(uid) && (players ?? 0) >= TRACK_MIN_PLAYERS) games.set(uid, [uid, place, name]);
      const k = `${uid}|${sortId}`;
      if (!hits.has(k)) hits.set(k, [uid, sortId, offset + i + 1]);
    });
  }
  const stmts = [];
  if (games.size) stmts.push(upsertDiscoveredStmt(db, [...games.values()], "explore", firstSeen));
  if (hits.size) stmts.push(sortHitsStmt(db, [...hits.values()], today));
  const res = stmts.length ? await db.batch(stmts) : [];
  return { sorts: n, games: games.size, hits: hits.size, written: written(res) };
}

/** Un trozo de juegos: muestras (+ meta, horror y votos si `meta`). */
export async function sampleChunk(db, ids, { ts, today, meta, budget = new Budget(45) }) {
  const [games, vts] = await Promise.all([
    fetchGames(budget, ids),
    meta ? fetchVotes(budget, ids) : null,
  ]);
  const batches = Math.ceil(ids.length / 50);
  if (games.failed * 2 > batches || (batches === 1 && games.failed)) {
    throw new Error(`Games API: ${games.failed}/${batches} lotes sin respuesta`);
  }
  const { samples, low, metaRows, votes } = processGames(ids, games, vts, meta);
  const stmts = [];
  if (samples.length) {
    stmts.push(insertSamplesStmt(db, samples, ts));
    // Última muestra (para el export): solo escribe la primera vez en cada pasada
    stmts.push(db.prepare(
      `INSERT INTO state (key, value) VALUES ('last_sample_ts', ?1)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value
       WHERE CAST(state.value AS INTEGER) < CAST(excluded.value AS INTEGER)`,
    ).bind(String(ts)));
  }
  stmts.push(...lowSinceStmts(db, low, today));
  if (metaRows.length) stmts.push(updateMetaStmt(db, metaRows, today));
  const res = stmts.length ? await db.batch(stmts) : [];
  return {
    stats: { games: ids.length, samples: samples.length, failed: games.failed, meta: metaRows.length, calls: budget.used, written: written(res) },
    votes: meta ? votes : undefined,
  };
}

/** Parte de puro cómputo de sampleChunk (separada para medir la CPU en Node). */
export function processGames(ids, games, vts, meta) {
  const got = new Map();
  for (const g of games.data) got.set(g.id, g);
  const vmap = new Map();
  if (vts) for (const v of vts.data) vmap.set(v.id, v);
  const samples = [], low = [], metaRows = [];
  const votes = {};
  for (const id of ids) {
    const g = got.get(id);
    if (!g) {
      // Si su lote respondió y el juego no está, ya no existe o es privado
      if (!games.failed) low.push([id, 0]);
      continue;
    }
    const playing = g.playing || 0;
    // Como tracker.py: solo se guardan muestras con ≥ TRACK_MIN_PLAYERS (los
    // que están por debajo siguen vigilados hasta UNTRACK_AFTER_DAYS, pero no
    // gastan escrituras: cada muestra es 1 fila insertada y luego 1 borrada)
    if (playing >= TRACK_MIN_PLAYERS) samples.push([id, playing, g.visits ?? null]);
    low.push([id, playing]);
    if (meta) {
      const c = g.creator || {};
      const h = classifyHorror({
        universe_id: id, name: g.name, description: g.description || "",
        genre: g.genre, genre_l1: g.genre_l1, genre_l2: g.genre_l2,
      });
      metaRows.push([
        id, g.rootPlaceId ?? null, g.name ?? null, c.name ?? null,
        c.hasVerifiedBadge == null ? null : c.hasVerifiedBadge ? 1 : 0,
        g.created ?? null, g.updated ?? null, g.genre ?? null, g.genre_l1 ?? null, g.genre_l2 ?? null,
        g.maxPlayers ?? null, h.horror ? 1 : 0, h.score, JSON.stringify(h.reasons || []),
      ]);
      const v = vmap.get(id);
      votes[id] = [g.favoritedCount ?? null, v?.upVotes ?? null, v?.downVotes ?? null];
    }
  }
  return { samples, low, metaRows, votes };
}

/**
 * Export por trozos: export-plan (rangos) → export-i (SQL de un rango → R2
 * tmp/export/part-i) → export-join (telegram.json con los candidatos y
 * export.json uniendo las partes con un stream).
 * `step`/`safe` del Workflow; fuera de él (pruebas) se puede pasar un `step`
 * que ejecute directamente.
 */
export async function runExport(env, step, nowMs, safe, summary) {
  const db = env.DB;
  const plan = await safe("export-plan", async () => {
    const [lastTs, closed, ranges] = await Promise.all([
      lastSampleTs(db), getState(db, "closed_day"), exportPlan(db, EXPORT_SLICE),
    ]);
    const today = isoDate(minuteOf(nowMs));
    return { lastTs, openDay: closed ? addDays(closed, 1) : today, ranges };
  });
  if (!plan) return null;
  const slices = [];
  for (const [i, [lo, hi]] of plan.ranges.entries()) {
    const name = `export-${i}`;
    let r = null;
    try {
      r = await step.do(name, STEP, async () => {
        const s = await buildExportSlice(db, { nowMs, lastTs: plan.lastTs, openDay: plan.openDay, lo, hi });
        const obj = await env.BUCKET.put(`${PART_PREFIX}${i}.json`, s.frag);
        return { n: s.n, bytes: obj?.size ?? 0, last_ts: s.last_ts, ts24: s.ts24, rows_read: s.meta?.rows_read ?? null };
      });
    } catch (e) {
      // Sin todas las partes no se publica un export incompleto
      summary?.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
      return null;
    }
    slices.push(r);
  }
  const lastTs = slices.reduce((m, s) => (s.last_ts != null && s.last_ts > (m ?? -1) ? s.last_ts : m), null) ?? plan.lastTs;
  const header = exportHeader({ nowMs, lastTs, ts24: slices.flatMap(s => s.ts24) });
  const total = slices.reduce((a, s) => a + s.n, 0);

  const join = await safe("export-join", async () => {
    // data/export.json: cabecera + partes + cierre, sin pasar las partes por JS
    const enc = new TextEncoder();
    const head = enc.encode(`${JSON.stringify(header).slice(0, -1)},"games":[`);
    const comma = enc.encode(","), tail = enc.encode("]}");
    const objs = [];
    for (let i = 0; i < slices.length; i++) {
      if (!slices[i].bytes) continue;
      const o = await env.BUCKET.get(`${PART_PREFIX}${i}.json`);
      if (!o) throw new Error(`Falta la parte ${i} del export`);
      objs.push(o);
    }
    const size = head.length + tail.length + objs.reduce((a, o) => a + o.size, 0) + Math.max(0, objs.length - 1);
    const { readable, writable } = new FixedLengthStream(size);
    const pump = (async () => {
      let w = writable.getWriter();
      await w.write(head);
      w.releaseLock();
      for (let i = 0; i < objs.length; i++) {
        if (i) { w = writable.getWriter(); await w.write(comma); w.releaseLock(); }
        await objs[i].body.pipeTo(writable, { preventClose: true });
      }
      w = writable.getWriter();
      await w.write(tail);
      await w.close();
    })();
    const [put] = await Promise.all([
      env.BUCKET.put(EXPORT_KEY, readable, {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: { generated_at: header.generated_at, games: String(total) },
      }),
      pump,
    ]);
    return {
      bytes: put?.size ?? size, games: total, slices: slices.length,
      rows_read: slices.reduce((a, s) => a + (s.rows_read || 0), 0),
    };
  });
  if (!join) return null;

  // data/telegram.json: prefiltro de telegram.js (telegramScanText) por trozos
  // de ~TG_SCAN_GAMES juegos sobre cada parte, y al final pickCandidates.
  const nowIso = new Date(nowMs).toISOString();
  const rowParts = [];
  let scanOk = true;
  for (const [i, sl] of slices.entries()) {
    const k = Math.max(1, Math.ceil(sl.n / TG_SCAN_GAMES));
    for (let j = 0; sl.n && j < k; j++) {
      const name = `tg-scan-${i}-${j}`;
      try {
        rowParts.push(await step.do(name, STEP, async () => {
          const o = await env.BUCKET.get(`${PART_PREFIX}${i}.json`);
          if (!o) throw new Error(`Falta la parte ${i} del export`);
          return telegramScanText(`{"games":[${await o.text()}]}`, { now: nowIso, part: j, parts: k });
        }));
      } catch (e) {
        summary?.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
        scanOk = false;
      }
    }
  }
  const tg = scanOk ? await safe("tg-reduce", async () => {
    const { counts, ids } = pickCandidates(rowParts.flat());
    const list = [...ids];
    const red = list.length
      ? await buildExportSlice(db, { nowMs, lastTs: plan.lastTs, openDay: plan.openDay, ids: list })
      : { frag: "", n: 0, meta: {} };
    // Mismo formato que el export + cabeceras exactas (telegram.counts, y totals = lo mismo)
    const text = `${JSON.stringify({
      ...header, totals: counts, telegram: { counts, total, candidates: red.n },
    }).slice(0, -1)},"games":[${red.frag}]}`;
    const obj = await env.BUCKET.put(TELEGRAM_KEY, text, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
    return { candidates: red.n, bytes: obj?.size ?? null, rows: rowParts.reduce((a, r) => a + r.length, 0), rows_read: red.meta?.rows_read ?? null };
  }) : null;
  join.telegram = tg;
  if (summary && join) summary.steps.export = join;
  return join;
}
