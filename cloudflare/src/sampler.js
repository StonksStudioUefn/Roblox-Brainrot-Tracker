/**
 * sampler.js — Workflow `Sampler`: un muestreo completo, por pasos.
 *
 * Lo lanza el cron cada hora (index.js → scheduled) o /api/admin/run.
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
 * Radar y juegos seguidos: en cada pasada se lee la lista de Rolimons (1
 * petición) y los jugadores de todos los juegos del radar (tracked = 1) se
 * apuntan en R2 radar/<día>/<ts>.json (los no seguidos que no salen en
 * Rolimons, con la Games API: ~7 peticiones); al cerrar el día se convierten en UNA fila
 * diaria por juego. Solo los juegos seguidos (sel = 1, unos 200 elegidos cada
 * día en `select`) tienen muestras cada hora y votos, y salen en el export.
 *
 * Pasos:  init → explore-0..P (una página de get-sorts por paso) → explore-more →
 *         search-0..N → search-cursor → rolimons (radar; con el meta del día, también
 *         places nuevos) → [resolve-0..K] → sample-list → sample-0..M (seguidos; con
 *         el meta del día todo el radar con meta y horror, y votos de los
 *         seguidos) → [meta-done] → radar-api → [close → close-radar-<día>-0..4 →
 *         close-hist] → [select-plan → select-0..R → select-apply] → [maint] →
 *         export-plan → export-0..E → export-join → telegram → finish
 * Lo que va entre corchetes son tareas del día: cada una con su marca y como
 * mucho DAILY_TRIES intentos al día (ver DAILY_TASKS).
 *
 * Parámetros (event.payload): now (ISO), daily (forzar las tareas del día),
 * skip: [nombres], only: [nombres] (explore, search, rolimons, sample, close,
 * select, maint, export, telegram), telegram_force ('daily' | 'weekly').
 */

import { WorkflowEntrypoint } from "cloudflare:workers";
import {
  DATA_RETENTION_DAYS, RADAR_EVERY_HOURS, SAMPLE_RETENTION_DAYS, SEARCH_PAGES_PER_QUERY, SEARCH_QUERIES,
  SEARCH_QUERIES_PER_RUN, SELECTION, TRACK_MIN_PLAYERS,
} from "./config.js";
import {
  Budget, GAMES_BATCH, SubBudget, chunks, fetchGames, fetchRolimons, fetchSearch, fetchSortContent, fetchSortsPage, fetchVotes,
  resolvePlaces,
} from "./sources.js";
import {
  DAY_MIN, addDays, applySelectionStmt, applyVotesStmt, backfillSamplesStmt, buildExportSlice, closeDayStmt, exportHeader,
  exportPlan, getState, getStates, idPart, idRanges, insertPlacesStmt, insertSamplesStmt, isoDate, isoMinute, lastSampleTs,
  lowSinceStmts, mergeHistStmt, migrateHist, minuteOf, pruneHistStmt, pruneOldStmts, pruneSamplesStmt, radarCloseStmt,
  radarCounts, radarCountsStaleStmt, radarDailyRows, radarIds, radarPlayers, radarReadingsPart, radarSlice, radarStaleStmt,
  retrackPlacesStmt, setState, setStateStmt, sortHitsStmt, trackedIds, unknownPlaces, untrackStmt, updateMetaStmt,
  upsertDiscoveredStmt, written,
} from "./db.js";
import { classifyHorror } from "./horror.js";
import { radarScore } from "./metrics.js";
import { withApp } from "./stonks.js";
import { gameOffsets, pickCandidates, runTelegram, telegramScanText } from "./telegram.js";

// Tamaños de trozo (CPU medida en frío: ver README "CPU por paso")
export const SAMPLE_CHUNK = 400;       // 8 lotes de 50: parsear ~560 KB de la Games API ≈ 4,3 ms
export const META_CHUNK = 50;          // 1 lote + votos + horror de 50 (horror en frío ≈ 4,2 ms)
export const RESOLVE_CHUNK = 40;       // place → universe por paso (1 petición cada uno)
export const RESOLVE_PER_DAY = 200;
export const EXPLORE_MAX_PAGES = 8;    // páginas de get-sorts (hoy son 5)
export const EXPORT_SLICE = 500;       // juegos seguidos por trozo del export (≈ 250 exportados, ≈ 450 KB)
export const TG_SCAN_GAMES = 40;       // juegos por paso de telegramScanText (en frío, con muestras cada hora: 40 ≈ 6 ms)
export const EXPORT_KEY = "data/export.json";
export const TELEGRAM_KEY = "data/telegram.json";
export const PART_PREFIX = "tmp/export/part-";
export const TG_PART_PREFIX = "tmp/export/tg-";   // juegos de Telegram sacados de cada parte
export const RUN_PREFIX = "tmp/run/";        // listas que pasan de una ejecución a otra
export const RADAR_PREFIX = "radar/";        // radar/<día>/<ts>.json: lecturas de Rolimons de cada muestreo
export const RADAR_KEEP_DAYS = 7;            // días de ficheros del radar en R2
export const RADAR_MIN_PLAYERS = 150;        // lecturas desde aquí (un bajón nocturno no deja huecos)
// Los del radar sin lectura de Rolimons (casi todos entraron por Explore o el
// buscador y Rolimons no los lista) que no se siguen se leen con la Games API
// en el paso radar-api: tope por paso como sample-i (8 lotes ≈ 4,9 ms en frío)
export const RADAR_API_MAX = 400;
export const RADAR_DAYS = 14;                // filas diarias por juego para elegir los seguidos
export const SELECT_SLICE = 250;             // juegos del radar por paso de select (en frío ≈ 5 ms)
// Un juego que entra en la selección no tiene muestras de antes: se le copian
// las lecturas del radar de las 48 h que enseña su ficha
export const BACKFILL_HOURS = 48;
export const BACKFILL_FILES = 16;            // 48 h con el radar cada 3 h: tope de lecturas de R2 por paso
export const BACKFILL_MAX_GAMES = 150;       // tope de escrituras: 150 × 16 = 2.400 filas (y otras tantas al podarlas)
// Las filas del radar al cerrar el día, en partes (por la última cifra del id):
// con ~2.800 juegos × 8 lecturas, de una vez costaba ~30 ms de CPU en frío
export const RADAR_CLOSE_PARTS = 5;

// Peticiones externas: el plan gratis da 50 por invocación. Se deja margen.
export const INVOCATION_BUDGET = 46;
export const SEARCH_NEED = 9;          // 3 páginas + reintentos
export const ROLIMONS_NEED = 4;
export const SAMPLE_NEED = 12;         // 8 lotes de la Games API + reintentos
export const META_NEED = 6;            // 1 lote + votos + reintentos
export const TELEGRAM_NEED = 30;       // miniaturas + envíos (peor caso medido: 27)

// Tareas de una vez al día, cada una con su marca en state (meta_day,
// closed_day, sel_day, maint_day) y como mucho DAILY_TRIES intentos al día
// (state.daily_tries): con una sola marca para todo, un cierre que fallaba
// repetía cada hora el meta de todo el radar, el cierre, select y maint
// (~450.000 filas leídas por hora: el tope de 5 M del día en ~10 horas).
export const DAILY_TASKS = ["meta", "close", "select", "maint"];
export const DAILY_TRIES = 2;
const TASK_STEP = { meta: "sample", close: "close", select: "select", maint: "maint" };

const STEP = { retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }, timeout: "10 minutes" };
const STEP_ONCE = { retries: { limit: 1, delay: "30 seconds", backoff: "constant" }, timeout: "5 minutes" };

export class Sampler extends WorkflowEntrypoint {
  async run(event, step) {
    const env = withApp(this.env);   // el bucket, dentro de la carpeta roblox-tracker/
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
      const st = await getStates(db, ["day", "meta_day", "closed_day", "search_cursor", "sel_day", "maint_day", "daily_tries"]);
      // Qué tareas del día tocan en esta pasada (p.daily las fuerza todas)
      const tries = st.daily_tries?.day === today ? { ...st.daily_tries } : { day: today };
      const due = {
        meta: (st.meta_day ?? st.day) !== today,   // `day`: la marca de antes de meta_day
        close: !st.closed_day || st.closed_day < addDays(today, -1),
        select: st.sel_day !== today,
        maint: st.maint_day !== today,
      };
      const daily = {};
      for (const t of DAILY_TASKS) {
        daily[t] = want(TASK_STEP[t]) && (!!p.daily || (due[t] && (tries[t] || 0) < DAILY_TRIES));
        if (daily[t] && due[t]) tries[t] = (tries[t] || 0) + 1;
      }
      await db.batch([
        setStateStmt(db, "run_current", { base, seg, id: base, phase: "discover", cursor: 0 }),
        setStateStmt(db, "daily_tries", tries),
      ]);
      // state.hist_agg → tabla hist (solo la primera vez; luego no hay clave que pasar)
      await migrateHist(db);
      return {
        ts, today, daily,
        firstOfDay: daily.meta,
        closedDay: st.closed_day || null,
        selDay: st.sel_day || null,
        cursor: Number(st.search_cursor) || 0,
        session: crypto.randomUUID(),
      };
    });
    const { ts, today } = init;
    // Una ejecución encadenada que creó el código de antes trae init sin `daily`
    const daily = init.daily || Object.fromEntries(DAILY_TASKS.map(t => [t, !!init.firstOfDay]));
    const firstSeen = isoMinute(ts);
    summary.ts = firstSeen;
    summary.first_of_day = daily.meta;
    summary.daily = daily;
    const order = ["discover", "search", "rolimons", "resolve", "sample", "radar-api", "finalize"];
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

    // ── rolimons: lecturas del radar (cada pasada) y, con el meta del día, los
    // places por resolver (a R2)
    const places = daily.meta && want("rolimons");
    // El radar se lee cada RADAR_EVERY_HOURS (y siempre con el meta del día)
    const radarHour = new Date(ts * 60000).getUTCHours() % RADAR_EVERY_HOURS === 0;
    if (reach("rolimons") && want("rolimons") && (places || radarHour)) {
      if (inv.left < ROLIMONS_NEED) return await next("rolimons");
      await safe("rolimons", async () => {
        const budget = sub(ROLIMONS_NEED);
        // Sin bajar de RADAR_MIN_PLAYERS: con la lista entera (7.600 juegos y no
        // 3.100) el filtro tarda el doble, y los ~25 del radar que salen con
        // menos solo cuestan medio lote de la Games API
        const all = await fetchRolimons(budget, RADAR_MIN_PLAYERS);
        if (!all || !all.length) throw new Error("Rolimons no devolvió la lista");
        // Un fichero por muestreo (un reintento lo reescribe igual): sin leer ni
        // reescribir el del día entero, que costaría CPU en cada pasada
        const [{ players, missing }, selIds] = await Promise.all([
          radarPlayers(db, all, today), getState(db, "sel_ids"),
        ]);
        await env.BUCKET.put(`${RADAR_PREFIX}${today}/${ts}.json`, JSON.stringify(players));
        // Los seguidos ya tienen muestras cada hora; el radar les hace falta
        // antes, para el relleno del día en que los eligen
        const sel = new Set(selIds || []);
        const api = missing.filter(id => !sel.has(id)).slice(0, RADAR_API_MAX);
        await env.BUCKET.put(`${tmp}radar-api.json`, JSON.stringify(api));
        const stats = { radar: Object.keys(players).length, missing: missing.length, api: api.length, calls: budget.used };
        if (!places) return { stats };

        const list = all.filter(r => r[2] >= TRACK_MIN_PLAYERS);
        const pids = list.map(r => r[0]);
        const [unknown, res] = await Promise.all([
          unknownPlaces(db, pids),
          retrackPlacesStmt(db, pids).run(),
        ]);
        if (res.meta?.changes) await radarStaleStmt(db).run();
        const byPid = new Map(list.map(r => [r[0], r]));
        // Primero los que más jugadores tienen; tope diario
        const todo = unknown.map(pid => byPid.get(pid)).sort((a, b) => b[2] - a[2])
          .slice(0, RESOLVE_PER_DAY).map(([pid, name]) => [pid, name]);
        await env.BUCKET.put(`${tmp}resolve.json`, JSON.stringify(todo));
        return { stats: { ...stats, games: list.length, unknown: unknown.length, todo: todo.length, written: written(res) } };
      });
    }
    if (places && reach("resolve")) {
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
            radarStaleStmt(db),
          ]) : [];
          return { asked: part.length, resolved: ok.length, calls: budget.used, written: written(res) };
        });
      }
    }

    // ── sample-N (+ meta diario): la lista de ids va a R2 para las demás ejecuciones.
    // Muestras de los seguidos; en la 1ª pasada del día, meta de todo el radar.
    if (reach("sample") && want("sample")) {
      const meta = daily.meta;
      const { ids, sel } = await step.do(`sample-list-${seg}`, STEP, async () => {
        const key = `${tmp}ids.json`;
        if (p.phase === "sample") {
          const o = await env.BUCKET.get(key);
          if (o) return await o.json();
        }
        const selected = await trackedIds(db, { selected: true });
        // Sin selección todavía (recién desplegado): todo el radar, como antes
        const list = { ids: meta || !selected.length ? await trackedIds(db) : selected, sel: selected.length ? selected : null };
        await env.BUCKET.put(key, JSON.stringify(list));
        return list;
      });
      const selSet = sel ? new Set(sel) : null;
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
            const out = await sampleChunk(db, parts[i], { ts, today, meta, budget: sub(need), sel: selSet });
            // Votos y datos del radar se aplican en el cierre del día, que puede ir en otra ejecución.
            // Los del radar ya repartidos como las partes de close-radar (el cierre solo los junta)
            if (out.votes) {
              const r = Array.from({ length: RADAR_CLOSE_PARTS }, () => ({}));
              for (const id in out.radar) r[idPart(id, RADAR_CLOSE_PARTS)][id] = out.radar[id];
              await env.BUCKET.put(`${tmp}votes-${i}.json`, JSON.stringify({ v: out.votes, r }));
            }
            return { stats: out.stats };
          });
        } catch (e) {
          summary.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
          agg.lost = (agg.lost || 0) + 1;
        }
        for (const k of Object.keys(agg)) if (k !== "steps" && k !== "lost") agg[k] += r?.stats?.[k] || 0;
      }
      summary.steps.sample = agg;   // un resumen (con meta son ~45 pasos)
      // El meta del día queda hecho si se ha perdido menos de la mitad de los trozos
      if (meta && (agg.lost || 0) * 2 < parts.length) {
        await safe("meta-done", () => setState(db, "meta_day", today).then(() => ({ day: today })));
      }
    }

    // ── radar-api: los del radar sin lectura de Rolimons, con la Games API, al
    // mismo fichero radar/<día>/<ts>.json (ts de la pasada: vale en otra ejecución).
    // Después de las muestras: si la Games API corta por ráfaga (429), que se
    // pierda una lectura del radar y no las muestras de los seguidos
    if (reach("radar-api") && want("rolimons") && (places || radarHour)) {
      const todo = await step.do(`radar-api-list-${seg}`, STEP, async () => {
        const o = await env.BUCKET.get(`${tmp}radar-api.json`);
        return o ? await o.json() : [];
      });
      if (todo.length) {
        const need = Math.ceil(todo.length / GAMES_BATCH) + 4;
        if (inv.left < need) return await next("radar-api");
        await safe("radar-api", async () => {
          const budget = sub(need);
          const games = await fetchGames(budget, todo);
          const batches = Math.ceil(todo.length / GAMES_BATCH);
          if (games.failed === batches) throw new Error(`Games API: ${batches}/${batches} lotes sin respuesta`);
          // Leer y reescribir el fichero de Rolimons lo deja igual si el paso se repite
          const key = `${RADAR_PREFIX}${today}/${ts}.json`;
          const obj = await env.BUCKET.get(key);
          const players = obj ? await obj.json() : {};
          let added = 0;
          for (const g of games.data) {
            if ((g.playing || 0) < RADAR_MIN_PLAYERS) continue;
            players[g.id] = Math.max(players[g.id] ?? 0, g.playing);
            added++;
          }
          await env.BUCKET.put(key, JSON.stringify(players));
          return { asked: todo.length, got: games.data.length, added, failed: games.failed, calls: budget.used };
        });
      }
    }
    // ── finalize: cierre, mantenimiento, export y Telegram (en una ejecución
    // nueva si ya no quedan peticiones para Telegram)
    if (inv.left < TELEGRAM_NEED && want("telegram") && p.phase !== "finalize") return await next("finalize");

    const yesterday = addDays(today, -1);
    // Cierre en tres tiempos: `close` (filas desde samples, con los votos),
    // `close-radar-<día>-<k>` (filas del radar, por partes: CPU) y `close-hist`
    // (hist y closed_day). Cada uno se puede repetir; si algo falla, closed_day
    // no avanza y la pasada siguiente lo repite (como mucho DAILY_TRIES al día).
    // Con el meta del día también: sus votos van a la fila de ayer aunque ya esté cerrada.
    if (want("close") && (daily.close || daily.meta)) {
      const plan = await safe("close", async () => {
        // Votos y meta de los no seguidos, guardados por los pasos sample-N con meta
        const votes = {}, metaParts = Array.from({ length: RADAR_CLOSE_PARTS }, () => ({}));
        if (daily.meta) {
          const listed = await env.BUCKET.list({ prefix: `${tmp}votes-` });
          for (const o of listed.objects) {
            const obj = await env.BUCKET.get(o.key);
            if (!obj) continue;
            const part = await obj.json();
            Object.assign(votes, part.v || {});
            if (Array.isArray(part.r)) part.r.forEach((m, k) => Object.assign(metaParts[k], m));
            else for (const id in part.r || {}) metaParts[idPart(id, RADAR_CLOSE_PARTS)][id] = part.r[id];   // de una ejecución de antes
          }
        }
        const oldest = addDays(today, -SAMPLE_RETENTION_DAYS);
        let from = init.closedDay ? addDays(init.closedDay, 1) : yesterday;
        if (from < oldest) from = oldest;
        const dates = [];
        for (let d = from; d <= yesterday; d = addDays(d, 1)) dates.push(d);
        const stats = { dates, votes: Object.keys(votes).length, radar_meta: metaParts.reduce((a, m) => a + Object.keys(m).length, 0) };
        if (!dates.length) {
          // Ya cerrado: solo los votos y el meta de hoy en la fila de ayer
          const rows = metaParts.flatMap((m, k) => radarDailyRows(null, m, k, RADAR_CLOSE_PARTS));
          const res = await db.batch([
            applyVotesStmt(db, yesterday, votes), ...(rows.length ? [radarCloseStmt(db, yesterday, rows)] : []),
            mergeHistStmt(db, yesterday),
          ]);
          return { ...stats, written: written(res) };
        }
        if (stats.radar_meta) {
          await Promise.all(metaParts.map((m, k) => env.BUCKET.put(`${tmp}close-meta-${k}.json`, JSON.stringify(m))));
        }
        // Ayer, con la selección aún sin cambiar (select va después), solo los
        // seguidos tienen muestras; un día más viejo se cierra con todos los juegos
        const res = await db.batch(dates.map(d =>
          closeDayStmt(db, d, d === yesterday ? votes : null, { selected: d === yesterday && init.selDay !== today })));
        return { ...stats, meta: stats.radar_meta > 0, written: written(res) };
      });
      let ok = !!plan?.dates?.length;
      for (const d of plan?.dates || []) {
        for (let k = 0; ok && k < RADAR_CLOSE_PARTS; k++) {
          ok = !!await safe(`close-radar-${d}-${k}`, async () => {
            const texts = await radarTexts(env.BUCKET, d);
            let rm = null;
            if (d === yesterday && plan.meta) rm = await (await env.BUCKET.get(`${tmp}close-meta-${k}.json`))?.json() ?? null;
            const rows = radarDailyRows(radarReadingsPart(texts, k, RADAR_CLOSE_PARTS), rm, k, RADAR_CLOSE_PARTS);
            const res = rows.length ? await radarCloseStmt(db, d, rows).run() : null;
            return { files: texts.length, rows: rows.length, written: written(res) };
          });
        }
      }
      if (ok) {
        await safe("close-hist", async () => {
          const closed = init.closedDay && init.closedDay > yesterday ? init.closedDay : yesterday;
          const res = await db.batch([...plan.dates.map(d => mergeHistStmt(db, d)), setStateStmt(db, "closed_day", closed)]);
          return { closed, written: written(res) };
        });
      }
    }

    // ── select: los juegos seguidos (una vez al día, con el día de ayer cerrado)
    if (want("select") && (daily.select || p.select)) {
      await runSelect(env, step, ts * 60000, today, safe, summary);
    }

    // ── maint: poda de muestras, untrack y ficheros viejos del radar ────────
    // Una vez al día (state.maint_day). Podar muestras recorre todos los juegos
    // (~6.000 filas leídas aunque solo borre una hora): cada hora eran ~150.000
    // al día y una vez ~20.000; a cambio las muestras duran hasta un día más
    // que SAMPLE_RETENTION_DAYS, y nada lee muestras tan viejas. untrack mira
    // fechas (low_since, puestos de hoy o ayer) y solo puede cambiar al cambiar
    // el día: repetirlo cada hora no quitaba ningún juego más.
    // Sin poda de muestras huérfanas: games no pierde filas y todo lo que
    // inserta muestras sale de games (solo /api/admin/import podría dejarlas),
    // y buscarlas recorría `samples` entera (~50.000 filas al día).
    if (want("maint") && daily.maint) {
      await safe("maint", async () => {
        const cutoff = ts - SAMPLE_RETENTION_DAYS * DAY_MIN;
        const oldDate = addDays(today, -DATA_RETENTION_DAYS);
        const stmts = [
          pruneSamplesStmt(db, cutoff), untrackStmt(db, today),
          ...pruneOldStmts(db, oldDate), pruneHistStmt(db, oldDate),
          setStateStmt(db, "maint_day", today),
        ];
        const res = await db.batch(stmts);
        // Las cachés del radar solo dependen de tracked aquí
        if (res[1]?.meta?.changes) await radarStaleStmt(db).run();
        const old = `${RADAR_PREFIX}${addDays(today, -RADAR_KEEP_DAYS)}/`;
        const listed = await env.BUCKET.list({ prefix: RADAR_PREFIX, limit: 1000 });
        const keys = listed.objects.map(o => o.key).filter(k => k < old);
        if (keys.length) await env.BUCKET.delete(keys);
        const oldRows = (res[2]?.meta?.changes ?? 0) + (res[3]?.meta?.changes ?? 0);
        return {
          pruned: res[0]?.meta?.changes ?? 0, untracked: res[1]?.meta?.changes ?? 0, old_rows: oldRows,
          old_hist: res[4]?.meta?.changes ?? 0, radar_files: keys.length, written: written(res),
        };
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
    if (/^(explore-\d+|resolve-\d+|search-\d+|export-\d+|select-\d+|tg-scan-|tg-pick-|close-radar-)/.test(k)) continue;   // demasiados: van en el total
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
export async function sampleChunk(db, ids, { ts, today, meta, budget = new Budget(45), sel = null }) {
  // sel: Set de ids seguidos (null = todos). Votos solo de los seguidos.
  const voteIds = meta ? (sel ? ids.filter(id => sel.has(id)) : ids) : [];
  const [games, vts] = await Promise.all([
    fetchGames(budget, ids),
    voteIds.length ? fetchVotes(budget, voteIds) : null,
  ]);
  const batches = Math.ceil(ids.length / 50);
  if (games.failed * 2 > batches || (batches === 1 && games.failed)) {
    throw new Error(`Games API: ${games.failed}/${batches} lotes sin respuesta`);
  }
  const { samples, low, metaRows, votes, radar } = processGames(ids, games, vts, meta, sel);
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
    radar: meta ? radar : undefined,
  };
}

/** Parte de puro cómputo de sampleChunk (separada para medir la CPU en Node). */
export function processGames(ids, games, vts, meta, sel = null) {
  const got = new Map();
  for (const g of games.data) got.set(g.id, g);
  const vmap = new Map();
  if (vts) for (const v of vts.data) vmap.set(v.id, v);
  const samples = [], low = [], metaRows = [];
  const votes = {}, radar = {};
  for (const id of ids) {
    const g = got.get(id);
    if (!g) {
      // Si su lote respondió y el juego no está, ya no existe o es privado
      if (!games.failed) low.push([id, 0]);
      continue;
    }
    const playing = g.playing || 0;
    const followed = !sel || sel.has(id);
    // Como tracker.py: solo se guardan muestras con ≥ TRACK_MIN_PLAYERS (los
    // que están por debajo siguen vigilados hasta UNTRACK_AFTER_DAYS, pero no
    // gastan escrituras: cada muestra es 1 fila insertada y luego 1 borrada).
    // Los del radar que no se siguen no tienen muestras: su dato del día va al cierre.
    if (followed && playing >= TRACK_MIN_PLAYERS) samples.push([id, playing, g.visits ?? null]);
    if (!followed) radar[id] = [playing, g.visits ?? null];
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
      if (followed) votes[id] = [g.favoritedCount ?? null, v?.upVotes ?? null, v?.downVotes ?? null];
    }
  }
  return { samples, low, metaRows, votes, radar };
}

/** Texto de los ficheros del radar de un día (radar/<día>/<ts>.json). */
export async function radarTexts(bucket, date) {
  const listed = await bucket.list({ prefix: `${RADAR_PREFIX}${date}/` });
  const texts = await Promise.all(listed.objects.map(async o => (await bucket.get(o.key))?.text() ?? null));
  return texts.filter(t => t != null);
}

/**
 * Elige los juegos seguidos. rows: [[id, horror, sel, typical, candidato|null], …]
 * Top por jugadores (general y horror) y mejores candidatos a emergente
 * (general y horror). Un juego ya seguido se queda mientras siga dentro del
 * keep_factor de alguna de sus listas, para no entrar y salir cada día.
 */
export function chooseSelection(rows, cfg = SELECTION) {
  const byPlayers = (a, b) => (b[3] - a[3]) || (a[0] - b[0]);
  const byScore = (a, b) => (b[4] - a[4]) || (b[3] - a[3]) || (a[0] - b[0]);
  // Si no hay candidatos para llenar una lista de emergentes (en horror pasa:
  // muchos superan las visitas máximas), se completa con los siguientes por jugadores
  const fill = (cands, pool) => {
    const ids = new Set(cands.map(r => r[0]));
    return cands.concat(pool.filter(r => !ids.has(r[0])));
  };
  const all = rows.slice().sort(byPlayers), horror = all.filter(r => r[1]);
  const lists = {
    top: [all, cfg.top],
    top_horror: [horror, cfg.top],
    emerging: [fill(rows.filter(r => r[4] != null).sort(byScore), all.slice(cfg.top)), cfg.emerging_general],
    emerging_horror: [fill(horror.filter(r => r[4] != null).sort(byScore), horror.slice(cfg.top)), cfg.emerging_horror],
  };
  const chosen = new Set(), kept = new Set(), counts = {};
  for (const [name, [list, n]] of Object.entries(lists)) {
    const keepN = Math.ceil(n * cfg.keep_factor);
    counts[name] = Math.min(n, list.length);
    for (let i = 0; i < list.length && i < keepN; i++) {
      if (i < n) chosen.add(list[i][0]);
      else if (list[i][2]) kept.add(list[i][0]);
    }
  }
  for (const id of kept) chosen.add(id);
  return { ids: [...chosen].sort((a, b) => a - b), counts: { ...counts, kept: [...kept].filter(id => chosen.has(id)).length, total: chosen.size, radar: rows.length } };
}

/**
 * select-plan (rangos del radar) → select-i (filas diarias + métricas de 500
 * juegos: radarScore de metrics.js) → select-apply (elige y escribe sel).
 */
export async function runSelect(env, step, nowMs, today, safe, summary) {
  const db = env.DB;
  // Los rangos, de los ids del radar (radarIds): sin recorrer games con ROW_NUMBER()
  const plan = await safe("select-plan", async () => ({ ranges: idRanges(await radarIds(db, today), SELECT_SLICE) }));
  if (!plan) return null;
  const now = new Date(nowMs).toISOString();
  const rows = [];
  for (const [i, [lo, hi]] of plan.ranges.entries()) {
    try {
      rows.push(...await step.do(`select-${i}`, STEP, async () => {
        const out = [];
        for (const [id, horror, sel, created, firstSeen, firstDay, sorts, d] of
          await radarSlice(db, { lo, hi, days: RADAR_DAYS, before: today, today })) {
          const r = radarScore({ id, created, first_seen: firstSeen, first_day: firstDay, sorts, d, s: [] }, { now });
          if (r) out.push([id, horror ? 1 : 0, sel ? 1 : 0, r[0], r[1] == null ? null : Math.round(r[1] * 10) / 10]);
        }
        return out;
      }));
    } catch (e) {
      // Sin todos los trozos no se cambia la selección (se queda la de ayer)
      summary?.errors.push(`select-${i}: ${String(e?.message || e).slice(0, 200)}`);
      return null;
    }
  }
  const applied = await safe("select-apply", async () => {
    const { ids, counts } = chooseSelection(rows);
    if (!ids.length) throw new Error("La selección ha salido vacía");
    const res = await db.batch([
      applySelectionStmt(db, ids),
      // La lista va también a state para que el export no tenga que recorrer games
      setStateStmt(db, "sel_ids", ids),
      setStateStmt(db, "sel_day", today),
      setStateStmt(db, "selection", { day: today, ...counts }),
    ]);
    if (res[0]?.meta?.changes) await radarCountsStaleStmt(db).run();
    // Los que entran, con más jugadores primero (por si pasan de BACKFILL_MAX_GAMES)
    const was = new Map(rows.map(r => [r[0], r]));
    const added = ids.filter(id => !was.get(id)?.[2]).sort((a, b) => (was.get(b)?.[3] ?? 0) - (was.get(a)?.[3] ?? 0));
    return { stats: { ...counts, added: added.length, changed: res[0]?.meta?.changes ?? 0, written: written(res) }, added };
  });
  if (!applied) return null;
  if (applied.added.length) {
    await safe("select-backfill", () => backfillFromRadar(env, applied.added, minuteOf(nowMs)));
  }
  return applied.stats;
}

/**
 * Copia a `samples` las lecturas del radar de las últimas BACKFILL_HOURS de
 * `ids` (en ese orden, como mucho `maxGames`; null = todos los seguidos), cada
 * una en el ts de su fichero, sin pisar las muestras que ya hay. Lo usan
 * `select` con los juegos que entran y /api/admin/backfill. Como mucho
 * BACKFILL_FILES lecturas de R2.
 * Quien lleve agregados de `samples` tiene que saber que estas filas llegan
 * con ts del pasado (de días ya cerrados y del día abierto).
 */
export async function backfillFromRadar(env, ids, nowTs, { maxGames = BACKFILL_MAX_GAMES } = {}) {
  ids ??= await trackedIds(env.DB, { selected: true });
  const games = ids.slice(0, maxGames);
  if (!games.length) return { asked: ids.length, games: 0, files: 0, written: 0 };
  const from = nowTs - BACKFILL_HOURS * 60;
  const files = [];
  for (let d = isoDate(from); d <= isoDate(nowTs); d = addDays(d, 1)) {
    const listed = await env.BUCKET.list({ prefix: `${RADAR_PREFIX}${d}/` });
    for (const o of listed.objects) {
      const ts = Number(o.key.slice(o.key.lastIndexOf("/") + 1, -".json".length));
      if (ts > from && ts <= nowTs) files.push([ts, o.key]);
    }
  }
  files.sort((a, b) => a[0] - b[0]);
  const texts = await Promise.all(files.slice(-BACKFILL_FILES).map(async ([ts, key]) => {
    const obj = await env.BUCKET.get(key);
    return obj ? [ts, await obj.text()] : null;
  }));
  const stmts = texts.filter(Boolean).map(([ts, text]) => backfillSamplesStmt(env.DB, text, ts, games));
  const res = stmts.length ? await env.DB.batch(stmts) : [];
  return { asked: ids.length, games: games.length, files: stmts.length, written: written(res) };
}

/**
 * Export por trozos: export-plan (rangos) → export-i (SQL de un rango → R2
 * tmp/export/part-i) → export-join (export.json uniendo las partes con un
 * stream) → tg-scan-i-j → tg-reduce (candidatos) → tg-pick-i (sus objetos,
 * copiados de la parte i) → tg-write (telegram.json).
 * `step`/`safe` del Workflow; fuera de él (pruebas) se puede pasar un `step`
 * que ejecute directamente.
 */
export async function runExport(env, step, nowMs, safe, summary) {
  const db = env.DB;
  const plan = await safe("export-plan", async () => {
    const [lastTs, closed, radar, selIds] = await Promise.all([
      lastSampleTs(db), getState(db, "closed_day"), radarCounts(db), getState(db, "sel_ids"),
    ]);
    // Solo los juegos seguidos, de state.sel_ids (la última selección que
    // escribió select-apply), sin recorrer games. Sin esa lista, por rangos de
    // los sel = 1 como antes. Sin ninguna selección no se reexporta: exportar
    // todo el radar leía ~150.000 filas en cada pasada y se queda el export de antes.
    if (Array.isArray(selIds) && selIds.length) {
      const ranges = chunks([...selIds].sort((a, b) => a - b), EXPORT_SLICE).map(ids => [ids[0], ids[ids.length - 1], ids]);
      return { lastTs, openDay: closed ? addDays(closed, 1) : isoDate(minuteOf(nowMs)), ranges, selected: true, radar };
    }
    if (!(radar.selected > 0)) return { skipped: "sin selección: se queda el export de antes" };
    const ranges = await exportPlan(db, EXPORT_SLICE, { selected: true });
    return { lastTs, openDay: closed ? addDays(closed, 1) : isoDate(minuteOf(nowMs)), ranges, selected: true, radar };
  });
  if (!plan || plan.skipped) return null;
  const slices = [];
  for (const [i, [lo, hi, ids]] of plan.ranges.entries()) {
    const name = `export-${i}`;
    let r = null;
    try {
      r = await step.do(name, STEP, async () => {
        const s = await buildExportSlice(db, { nowMs, lastTs: plan.lastTs, openDay: plan.openDay, lo, hi, ids: ids ?? null, selected: plan.selected });
        const obj = await env.BUCKET.put(`${PART_PREFIX}${i}.json`, s.frag);
        return {
          n: s.n, bytes: obj?.size ?? 0, last_ts: s.last_ts, ts24: s.ts24,
          rows_read: s.meta?.rows_read ?? null, rows_written: s.meta?.rows_written ?? null,
        };
      });
    } catch (e) {
      // Sin todas las partes no se publica un export incompleto
      summary?.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
      return null;
    }
    slices.push(r);
  }
  const lastTs = slices.reduce((m, s) => (s.last_ts != null && s.last_ts > (m ?? -1) ? s.last_ts : m), null) ?? plan.lastTs;
  const header = exportHeader({ nowMs, lastTs, ts24: slices.flatMap(s => s.ts24), radar: plan.radar });
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
      rows_written: slices.reduce((a, s) => a + (s.rows_written || 0), 0),
    };
  });
  if (!join) return null;

  // data/telegram.json: prefiltro de telegram.js (telegramScanText) por trozos
  // de ~TG_SCAN_GAMES juegos sobre cada parte, y al final pickCandidates.
  const nowIso = new Date(nowMs).toISOString();
  const rowParts = [];   // [[parte, filas], …]
  let scanOk = true;
  for (const [i, sl] of slices.entries()) {
    const k = Math.max(1, Math.ceil(sl.n / TG_SCAN_GAMES));
    for (let j = 0; sl.n && j < k; j++) {
      const name = `tg-scan-${i}-${j}`;
      try {
        rowParts.push([i, await step.do(name, STEP, async () => {
          const o = await env.BUCKET.get(`${PART_PREFIX}${i}.json`);
          if (!o) throw new Error(`Falta la parte ${i} del export`);
          return telegramScanText(`{"games":[${await o.text()}]}`, { now: nowIso, part: j, parts: k });
        })]);
      } catch (e) {
        summary?.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
        scanOk = false;
      }
    }
  }
  const red = scanOk ? await safe("tg-reduce", async () => {
    const { counts, ids } = pickCandidates(rowParts.flatMap(([, rows]) => rows));
    const byPart = {};
    for (const [i, rows] of rowParts) for (const r of rows) if (ids.has(r.id)) (byPart[i] ||= []).push(r.id);
    return { counts, byPart, rows: rowParts.reduce((a, [, rows]) => a + rows.length, 0) };
  }) : null;
  // Los objetos de los candidatos son los mismos que los de las partes: se
  // copian de ahí en vez de volver a pedirlos a D1 (eran ~37k filas leídas).
  let picked = !!red;
  for (const [i, list] of Object.entries(red?.byPart || {})) {
    const name = `tg-pick-${i}`;
    try {
      await step.do(name, STEP, async () => {
        const o = await env.BUCKET.get(`${PART_PREFIX}${i}.json`);
        if (!o) throw new Error(`Falta la parte ${i} del export`);
        const out = pickGames(await o.text(), list);
        if (out.n !== list.length) throw new Error(`La parte ${i} tiene ${out.n} de ${list.length} candidatos`);
        await env.BUCKET.put(`${TG_PART_PREFIX}${i}.json`, out.frag);
        return { n: out.n };
      });
    } catch (e) {
      summary?.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
      picked = false;
    }
  }
  const tg = picked ? await safe("tg-write", async () => {
    const frags = [];
    for (const i of Object.keys(red.byPart).sort((a, b) => a - b)) {
      const o = await env.BUCKET.get(`${TG_PART_PREFIX}${i}.json`);
      if (!o) throw new Error(`Faltan los candidatos de la parte ${i}`);
      frags.push(await o.text());
    }
    const candidates = Object.values(red.byPart).reduce((a, l) => a + l.length, 0);
    // Mismo formato que el export + cabeceras exactas (telegram.counts, y totals = lo mismo)
    const text = `${JSON.stringify({
      ...header, totals: red.counts, telegram: { counts: red.counts, total, candidates },
    }).slice(0, -1)},"games":[${frags.join(",")}]}`;
    const obj = await env.BUCKET.put(TELEGRAM_KEY, text, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
    return { candidates, bytes: obj?.size ?? null, rows: red.rows };
  }) : null;
  join.telegram = tg;
  if (summary && join) summary.steps.export = join;
  return join;
}

/**
 * Los objetos de `ids` (en el orden de la parte, que es el de universe_id)
 * copiados del texto de una parte del export, sin parsearlos.
 * → { frag: '{…},{…}', n }
 */
export function pickGames(part, ids) {
  const want = new Set(ids);
  const text = `{"games":[${part}]}`;
  const offs = gameOffsets(text), out = [];
  for (let k = 0; k < offs.length - 1; k++) {
    const p = offs[k] + 6;   // el id va justo después de {"id":
    if (!want.has(Number(text.slice(p, text.indexOf(",", p))))) continue;
    out.push(text.slice(offs[k], offs[k + 1]).replace(/,$/, ""));
  }
  return { frag: out.join(","), n: out.length };
}
