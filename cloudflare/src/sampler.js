/**
 * sampler.js — Workflow `Sampler`: un muestreo completo, por pasos.
 *
 * Lo lanza el cron cada 3 h (index.js → scheduled) o /api/admin/run.
 * Cada `step.do` cabe en 10 ms de CPU y ≤ 45 peticiones externas (Budget),
 * y es idempotente: Workflows lo reintenta si falla y los resultados de los
 * pasos ya hechos se guardan, así que al reanudar no se repiten.
 *
 * Límite de 50 peticiones externas: en el plan gratis la documentación lo da
 * "por invocación" (tabla de Workflows: "50/request") sin aclarar si cada paso
 * es una invocación. Para no depender de ello, entre pasos con red hay un
 * `step.sleep` (no cuenta como paso), que obliga al motor a reanudar la
 * instancia en otra invocación. Ver README / CONTRACT.md.
 *
 * Pasos:  init → explore → search-0..N → [rolimons → resolve-0..K] →
 *         sample-list → sample-0..M (con meta diario en la 1ª pasada del día) →
 *         [close] → maint → export → telegram → finish
 */

import { WorkflowEntrypoint } from "cloudflare:workers";
import {
  SAMPLE_RETENTION_DAYS, SEARCH_PAGES_PER_QUERY, SEARCH_QUERIES, SEARCH_QUERIES_PER_RUN,
  TRACK_MIN_PLAYERS,
} from "./config.js";
import {
  Budget, chunks, fetchExplore, fetchGames, fetchRolimons, fetchSearch, fetchVotes, resolvePlaces,
} from "./sources.js";
import {
  DAY_MIN, addDays, applyVotesStmt, buildExport, closeDayStmt, getState, getStates, insertPlacesStmt,
  insertSamplesStmt, isoDate, isoMinute, lowSinceStmts, mergeHistStmt, minuteOf, pruneOrphansStmt,
  pruneSamplesStmt, retrackPlacesStmt, setState, setStateStmt, sortHitsStmt, trackedIds, unknownPlaces,
  untrackStmt, updateMetaStmt, upsertDiscoveredStmt, written,
} from "./db.js";
import { classifyHorror } from "./horror.js";
import { runTelegram } from "./telegram.js";

// Tamaños de trozo (medidos: ver README "CPU por paso")
export const SAMPLE_CHUNK = 1000;      // 20 lotes de 50 → 20 peticiones
export const META_CHUNK = 500;         // 10 lotes de juegos + 10 de votos + horror de 500
export const RESOLVE_CHUNK = 40;       // place → universe por paso
export const RESOLVE_PER_DAY = 200;
export const EXPORT_KEY = "data/export.json";

const STEP = { retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }, timeout: "10 minutes" };
const STEP_ONCE = { retries: { limit: 1, delay: "30 seconds", backoff: "constant" }, timeout: "5 minutes" };

export class Sampler extends WorkflowEntrypoint {
  async run(event, step) {
    const env = this.env;
    const db = env.DB;
    const p = event.payload || {};
    const skip = new Set(p.skip || []);
    const summary = { steps: {}, errors: [] };

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
    const pause = name => step.sleep(`pausa ${name}`, "1 second");

    // ── init ──────────────────────────────────────────────────────────────
    const init = await step.do("init", STEP, async () => {
      const ms = p.now ? Date.parse(p.now) : new Date(event.timestamp || Date.now()).getTime();
      const ts = minuteOf(ms);
      const today = isoDate(ts);
      const st = await getStates(db, ["day", "closed_day", "search_cursor"]);
      return {
        ts, today,
        firstOfDay: !!p.daily || st.day !== today,
        closedDay: st.closed_day || null,
        cursor: Number(st.search_cursor) || 0,
      };
    });
    const { ts, today } = init;
    const firstSeen = isoMinute(ts);
    summary.ts = firstSeen;
    summary.first_of_day = init.firstOfDay;

    // ── explore ───────────────────────────────────────────────────────────
    if (!skip.has("explore")) {
      await safe("explore", async () => {
        const budget = new Budget(45);
        const sorts = await fetchExplore(budget);
        const nSorts = Object.keys(sorts).length;
        if (!nSorts) throw new Error("Explore API sin listas");
        // Juegos nuevos solo con ≥ TRACK_MIN_PLAYERS (las listas temáticas traen
        // muchos pequeños y cada juego seguido son 8 muestras + 8 borrados al día);
        // los puestos se guardan para todos los juegos que ya conocemos.
        const games = new Map();
        const hits = new Map();
        for (const [sortId, list] of Object.entries(sorts)) {
          list.forEach(([uid, place, name, players], i) => {
            if (!uid) return;
            if (!games.has(uid) && (players ?? 0) >= TRACK_MIN_PLAYERS) games.set(uid, [uid, place, name]);
            const k = `${uid}|${sortId}`;
            if (!hits.has(k)) hits.set(k, [uid, sortId, i + 1]);
          });
        }
        const res = await db.batch([
          upsertDiscoveredStmt(db, [...games.values()], "explore", firstSeen),
          sortHitsStmt(db, [...hits.values()], today),
        ]);
        return { sorts: nSorts, games: games.size, hits: hits.size, calls: budget.used, written: written(res) };
      });
      await pause("explore");
    }

    // ── search (por turnos) ───────────────────────────────────────────────
    if (!skip.has("search")) {
      const n = Math.min(SEARCH_QUERIES_PER_RUN, SEARCH_QUERIES.length);
      for (let k = 0; k < n; k++) {
        const query = SEARCH_QUERIES[(init.cursor + k) % SEARCH_QUERIES.length];
        const source = `search:${query}`;
        await safe(`search-${k}`, async () => {
          const budget = new Budget(12);
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
        await step.sleep(`pausa search-${k}`, "3 seconds");   // la Search API castiga las ráfagas
      }
      await safe("search-cursor", async () => {
        const next = (init.cursor + n) % SEARCH_QUERIES.length;
        await setState(db, "search_cursor", next);
        return { next };
      });
    }

    // ── rolimons (1ª pasada del día) ──────────────────────────────────────
    if (init.firstOfDay && !skip.has("rolimons")) {
      const rol = await safe("rolimons", async () => {
        const budget = new Budget(4);
        const list = await fetchRolimons(budget, TRACK_MIN_PLAYERS);
        if (!list || !list.length) throw new Error("Rolimons no devolvió la lista");
        const pids = list.map(r => r[0]);
        const [unknown, res] = await Promise.all([
          unknownPlaces(db, pids),
          retrackPlacesStmt(db, pids).run(),
        ]);
        const names = new Map(list.map(r => [r[0], r]));
        // Primero los que más jugadores tienen; tope diario
        const todo = unknown.map(pid => names.get(pid)).sort((a, b) => b[2] - a[2])
          .slice(0, RESOLVE_PER_DAY).map(([pid, name]) => [pid, name]);
        return { stats: { games: list.length, unknown: unknown.length, calls: budget.used, written: written(res) }, todo };
      });
      const todo = rol?.todo || [];
      for (const [i, part] of chunks(todo, RESOLVE_CHUNK).entries()) {
        await pause(`resolve-${i}`);
        await safe(`resolve-${i}`, async () => {
          const budget = new Budget(45);
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

    // ── sample-N (+ meta diario) ──────────────────────────────────────────
    const votes = {};
    if (!skip.has("sample")) {
      const ids = await step.do("sample-list", STEP, () => trackedIds(db));
      const meta = init.firstOfDay;
      const size = meta ? META_CHUNK : SAMPLE_CHUNK;
      for (const [i, part] of chunks(ids, size).entries()) {
        await pause(`sample-${i}`);
        const r = await safe(`sample-${i}`, () => sampleChunk(db, part, { ts, today, meta }));
        if (r?.votes) Object.assign(votes, r.votes);
      }
    }

    // ── close (cierre de daily de los días anteriores) ───────────────────
    const yesterday = addDays(today, -1);
    if (!skip.has("close") && (init.firstOfDay || !init.closedDay || init.closedDay < yesterday)) {
      await safe("close", async () => {
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
    if (!skip.has("maint")) {
      await safe("maint", async () => {
        const cutoff = ts - SAMPLE_RETENTION_DAYS * DAY_MIN;
        const stmts = [pruneSamplesStmt(db, cutoff), untrackStmt(db, today)];
        if (init.firstOfDay) stmts.push(pruneOrphansStmt(db, cutoff));
        const res = await db.batch(stmts);
        return {
          pruned: res[0]?.meta?.changes ?? 0,
          untracked: res[1]?.meta?.changes ?? 0,
          written: written(res),
        };
      });
    }

    // ── export → R2 ───────────────────────────────────────────────────────
    let exported = null;
    if (!skip.has("export")) {
      exported = await safe("export", () => writeExport(env, ts * 60000));
    }

    // ── telegram ──────────────────────────────────────────────────────────
    if (!skip.has("telegram") && exported) {
      await safe("telegram", async () => {
        const obj = await env.BUCKET.get(EXPORT_KEY);
        if (!obj) throw new Error("No hay export en R2");
        const exportData = await obj.json();
        const r = await runTelegram({
          env, exportData, now: new Date(ts * 60000),
          getState: key => getState(db, key),
          setState: (key, value) => setState(db, key, value),
          force: p.telegram_force || null,
        });
        return r ?? { ok: true };
      }, STEP_ONCE);
    }

    // ── finish ────────────────────────────────────────────────────────────
    await step.do("finish", STEP, async () => {
      summary.finished_at = new Date().toISOString().slice(0, 19) + "Z";
      summary.instance = event.instanceId || null;
      await setState(db, "last_run", summary);
      return { errors: summary.errors.length };
    });
    return summary;
  }
}

/** Un trozo de juegos: muestras (+ meta, horror y votos si `meta`). */
export async function sampleChunk(db, ids, { ts, today, meta }) {
  const budget = new Budget(45);
  const [games, vts] = await Promise.all([
    fetchGames(budget, ids),
    meta ? fetchVotes(budget, ids) : null,
  ]);
  const batches = Math.ceil(ids.length / 50);
  if (games.failed * 2 > batches) {
    throw new Error(`Games API: ${games.failed}/${batches} lotes sin respuesta`);
  }
  const { samples, low, metaRows, votes } = processGames(ids, games, vts, meta);
  const stmts = [];
  if (samples.length) stmts.push(insertSamplesStmt(db, samples, ts));
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

/** Genera el export y lo sube a R2. */
export async function writeExport(env, nowMs) {
  const closed = await getState(env.DB, "closed_day");
  const today = isoDate(minuteOf(nowMs));
  const openDay = closed ? addDays(closed, 1) : today;
  const out = await buildExport(env.DB, { nowMs, openDay });
  if (!out) throw new Error("El export salió vacío");
  const obj = await env.BUCKET.put(EXPORT_KEY, out.json, {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { generated_at: new Date(nowMs).toISOString(), games: String(out.games) },
  });
  return {
    bytes: obj?.size ?? null, games: out.games,
    rows_read: out.meta?.rows_read ?? null, d1_ms: out.meta?.duration ?? null,
  };
}
