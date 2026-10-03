/**
 * sampler.js — Workflow `Sampler`: un muestreo completo, por pasos.
 *
 * Lo lanza el cron cada 3 h (index.js → scheduled) o /api/admin/run.
 * Cada `step.do` cabe en 10 ms de CPU (medido: README "CPU por paso") y en
 * ≤ 45 peticiones externas (Budget), y es idempotente: Workflows lo reintenta
 * si falla, y los pasos ya hechos no se repiten al reanudar.
 *
 * Límite de 50 peticiones externas: en el plan gratis la documentación lo da
 * "por invocación" ("50/request" en la tabla de límites de Workflows) sin
 * aclarar si cada paso es una invocación (la CPU sí es "por paso"). Para no
 * depender de ello, antes de cada paso con red hay un `step.sleep` (no cuenta
 * en el límite de pasos), para que el motor reanude la instancia en otra
 * invocación. Ver README / CONTRACT.md.
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
  Budget, chunks, fetchGames, fetchRolimons, fetchSearch, fetchSortContent, fetchSortsPage, fetchVotes,
  resolvePlaces,
} from "./sources.js";
import {
  DAY_MIN, addDays, applyVotesStmt, buildExportSlice, closeDayStmt, exportHeader, exportPlan, getState,
  getStates, insertPlacesStmt, insertSamplesStmt, isoDate, isoMinute, lastSampleTs, lowSinceStmts,
  mergeHistStmt, minuteOf, pickTelegramCandidates, pruneOrphansStmt, pruneSamplesStmt, retrackPlacesStmt,
  setState, setStateStmt, sortHitsStmt, sumTotals, trackedIds, unknownPlaces, untrackStmt, updateMetaStmt,
  upsertDiscoveredStmt, written,
} from "./db.js";
import { classifyHorror } from "./horror.js";
import { runTelegram } from "./telegram.js";

// Tamaños de trozo (CPU medida en frío: ver README "CPU por paso")
export const SAMPLE_CHUNK = 400;       // 8 lotes de 50: parsear ~560 KB de la Games API ≈ 4,3 ms
export const META_CHUNK = 50;          // 1 lote + votos + horror de 50 (horror en frío ≈ 4,2 ms)
export const RESOLVE_CHUNK = 40;       // place → universe por paso
export const RESOLVE_PER_DAY = 200;
export const EXPLORE_MAX_PAGES = 8;    // páginas de get-sorts (hoy son 5)
export const EXPORT_SLICE = 500;       // juegos seguidos por trozo del export (≈ 250 exportados, ≈ 450 KB)
export const EXPORT_KEY = "data/export.json";
export const TELEGRAM_KEY = "data/telegram.json";
export const PART_PREFIX = "tmp/export/part-";

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
        session: crypto.randomUUID(),
      };
    });
    const { ts, today } = init;
    const firstSeen = isoMinute(ts);
    summary.ts = firstSeen;
    summary.first_of_day = init.firstOfDay;

    // ── explore: una página de get-sorts por paso, luego get-sort-content ──
    if (want("explore")) {
      let token = null;
      const pending = [];
      for (let i = 0; i < EXPLORE_MAX_PAGES; i++) {
        await pause(`explore-${i}`);
        const r = await safe(`explore-${i}`, async () => {
          const budget = new Budget(6);
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
        await pause("explore-more");
        await safe("explore-more", async () => {
          const budget = new Budget(30);
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
    if (want("search")) {
      const n = Math.min(SEARCH_QUERIES_PER_RUN, SEARCH_QUERIES.length);
      for (let k = 0; k < n; k++) {
        const query = SEARCH_QUERIES[(init.cursor + k) % SEARCH_QUERIES.length];
        const source = `search:${query}`;
        // La Search API castiga las ráfagas: pausa más larga entre búsquedas
        await step.sleep(`pausa search-${k}`, k ? "3 seconds" : "1 second");
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
      }
      await safe("search-cursor", async () => {
        const next = (init.cursor + n) % SEARCH_QUERIES.length;
        await setState(db, "search_cursor", next);
        return { next };
      });
    }

    // ── rolimons (1ª pasada del día) ──────────────────────────────────────
    if (init.firstOfDay && want("rolimons")) {
      await pause("rolimons");
      const rol = await safe("rolimons", async () => {
        const budget = new Budget(4);
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
        return { stats: { games: list.length, unknown: unknown.length, calls: budget.used, written: written(res) }, todo };
      });
      for (const [i, part] of chunks(rol?.todo || [], RESOLVE_CHUNK).entries()) {
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
    if (want("sample")) {
      const ids = await step.do("sample-list", STEP, () => trackedIds(db));
      const meta = init.firstOfDay;
      const parts = chunks(ids, meta ? META_CHUNK : SAMPLE_CHUNK);
      const agg = { games: 0, samples: 0, failed: 0, meta: 0, calls: 0, written: 0, steps: parts.length };
      for (const [i, part] of parts.entries()) {
        await pause(`sample-${i}`);
        const name = `sample-${i}`;
        let r = null;
        try {
          r = await step.do(name, STEP, () => sampleChunk(db, part, { ts, today, meta }));
        } catch (e) {
          summary.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
        }
        if (r?.votes) Object.assign(votes, r.votes);
        for (const k of Object.keys(agg)) if (k !== "steps") agg[k] += r?.stats?.[k] || 0;
      }
      summary.steps.sample = agg;   // un resumen (con meta son ~55 pasos)
    }

    // ── close (cierre de daily de los días anteriores) ───────────────────
    const yesterday = addDays(today, -1);
    if (want("close") && (init.firstOfDay || !init.closedDay || init.closedDay < yesterday)) {
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
    if (want("telegram") && exported) {
      await safe("telegram", async () => {
        const obj = await env.BUCKET.get(TELEGRAM_KEY);
        if (!obj) throw new Error("No hay data/telegram.json en R2");
        const exportData = await obj.json();
        const r = await runTelegram({
          env, exportData, now: new Date(ts * 60000),
          getState: key => getState(db, key),
          setState: (key, value) => setState(db, key, value),
          force: p.telegram_force || undefined,
        });
        return r ?? { ok: true };
      }, STEP_ONCE);
    }

    // ── finish ────────────────────────────────────────────────────────────
    await step.do("finish", STEP, async () => {
      summary.finished_at = new Date().toISOString().slice(0, 19) + "Z";
      summary.instance = event.instanceId || null;
      // Las pasadas parciales (only: […], p. ej. un export manual) no tapan la última completa
      await setState(db, only ? "last_partial_run" : "last_run", summary);
      return { errors: summary.errors.length };
    });
    return summary;
  }
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
export async function sampleChunk(db, ids, { ts, today, meta }) {
  const budget = new Budget(45);
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
        return {
          n: s.n, bytes: obj?.size ?? 0, last_ts: s.last_ts, ts24: s.ts24, totals: s.totals, scores: s.scores,
          rows_read: s.meta?.rows_read ?? null,
        };
      });
    } catch (e) {
      // Sin todas las partes no se publica un export incompleto
      summary?.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
      return null;
    }
    slices.push(r);
  }
  const join = await safe("export-join", async () => {
    const lastTs = slices.reduce((m, s) => (s.last_ts != null && s.last_ts > (m ?? -1) ? s.last_ts : m), null) ?? plan.lastTs;
    const header = exportHeader({ nowMs, lastTs, ts24: slices.flatMap(s => s.ts24) });
    const total = slices.reduce((a, s) => a + s.n, 0);

    // data/telegram.json: mismo formato, solo los candidatos, + totales
    const ids = pickTelegramCandidates(slices.flatMap(s => s.scores));
    const tg = ids.length
      ? await buildExportSlice(db, { nowMs, lastTs: plan.lastTs, openDay: plan.openDay, ids })
      : { frag: "", n: 0, meta: {} };
    const totals = sumTotals(slices.map(s => s.totals));
    const tgJson = `${JSON.stringify({
      ...header, totals,
      // Mismo dato con el nombre que usa telegram.js (exportData.telegram.counts)
      telegram: { counts: totals, total, candidates: tg.n },
    }).slice(0, -1)},"games":[${tg.frag}]}`;
    await env.BUCKET.put(TELEGRAM_KEY, tgJson, { httpMetadata: { contentType: "application/json; charset=utf-8" } });

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
      telegram: { games: tg.n, bytes: tgJson.length },
      rows_read: slices.reduce((a, s) => a + (s.rows_read || 0), 0) + (tg.meta?.rows_read || 0),
    };
  });
  if (summary && join) summary.steps.export = join;
  return join;
}
