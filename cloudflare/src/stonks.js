/**
 * stonks.js — El tracker como una app más del ecosistema STONKS.
 *
 * - Sus ficheros van en el bucket común `stonks-archivos`, dentro de su
 *   carpeta `roblox-tracker/` (así salen en el Almacén). `appBucket()` envuelve
 *   el binding para que el resto del código siga usando claves cortas
 *   («data/export.json») sin saber nada de la carpeta.
 * - `Operaciones` es el entrypoint que el Almacén llama por service binding:
 *   `espacio()` (lo que ocupa la base D1, con filas y bytes por tabla) y
 *   `nombres()` (cómo se llaman sus carpetas de R2).
 */

import { WorkerEntrypoint } from "cloudflare:workers";
import { DATA_RETENTION_DAYS } from "./config.js";

export const APP = "roblox-tracker";
const PREFIX = `${APP}/`;
const D1_TOPE = 500_000_000;   // D1: 500 MB por base en el plan gratis
const MAX_RUTAS = 500;

/** El bucket común visto desde el tracker: todas las claves dentro de `roblox-tracker/`. */
export function appBucket(bucket) {
  if (!bucket || bucket.__app) return bucket;
  const k = key => PREFIX + key;
  const short = o => ({
    key: o.key.slice(PREFIX.length), size: o.size, etag: o.etag, httpEtag: o.httpEtag,
    uploaded: o.uploaded, httpMetadata: o.httpMetadata, customMetadata: o.customMetadata,
  });
  return {
    __app: true,
    get: (key, opts) => bucket.get(k(key), opts),
    head: key => bucket.head(k(key)),
    // Datos de cada archivo (ECOSISTEMA §5): la app que lo sube y cuándo
    put: (key, value, opts = {}) => bucket.put(k(key), value, {
      ...opts, customMetadata: { app: APP, fecha: new Date().toISOString(), ...(opts.customMetadata || {}) },
    }),
    delete: keys => bucket.delete(Array.isArray(keys) ? keys.map(k) : k(keys)),
    async list(opts = {}) {
      const r = await bucket.list({ ...opts, prefix: PREFIX + (opts.prefix || "") });
      return { ...r, objects: r.objects.map(short), delimitedPrefixes: (r.delimitedPrefixes || []).map(p => p.slice(PREFIX.length)) };
    },
  };
}

/** El env con el bucket ya dentro de la carpeta de la app. */
export const withApp = env => (env.BUCKET?.__app ? env : { ...env, BUCKET: appBucket(env.BUCKET) });

const sqlName = s => `"${String(s).replaceAll('"', '""')}"`;
const ESPACIO_KEY = "espacio";
const ESPACIO_VIDA_MS = 24 * 3600_000;
const MUESTRA_FILAS = 256;   // filas para estimar lo que ocupa una fila de una tabla grande

/**
 * El `Espacio` del contrato del ecosistema (contrato/tipos.ts) para la base D1.
 * base.bytes es el tamaño de la base que da D1 (meta.size_after) y sale de cada
 * llamada sin leer filas. El desglose por tabla (lo que ocupan los valores de
 * cada fila, sin índices ni páginas, como medirTablas() del contrato) se guarda
 * en state.espacio y se rehace como mucho una vez al día: contar y sumar cada
 * tabla las recorre enteras (~60.000 filas hoy, ~2 M dentro de un año) y el
 * plan gratis da 5 M filas leídas al día para todo. `daily` y `sort_hits`, que
 * crecen sin parar hasta el año de datos, se estiman (estimarFilas); las demás
 * se cuentan (`samples` no pasa de ~9 días de muestras). `exacto` las cuenta
 * todas, como antes (solo para el admin).
 */
export async function espacioD1(db, { exacto = false } = {}) {
  const st = await db.prepare("SELECT value FROM state WHERE key = ?1").bind(ESPACIO_KEY).first().catch(() => null);
  let cache = null;
  try { cache = st?.value ? JSON.parse(st.value) : null; } catch { /* se rehace */ }
  let medida = !exacto && cache?.tablas && Date.now() - Date.parse(cache.medido) < ESPACIO_VIDA_MS ? cache : null;
  if (!medida) {
    medida = { medido: new Date().toISOString(), tablas: await medirTablas(db, exacto) };
    await db.prepare(
      `INSERT INTO state (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    ).bind(ESPACIO_KEY, JSON.stringify(medida)).run().catch(() => null);
  }
  const size = Number((await db.prepare("SELECT 1").run())?.meta?.size_after) || 0;
  return {
    app: APP,
    medido: new Date().toISOString(),
    base: { bytes: size, tablas: medida.tablas },
    mayores: [{ nombre: "Base D1 «roblox-tracker»", bytes: size, tope: D1_TOPE }],
  };
}

async function medirTablas(db, exacto) {
  const { results: tables } = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE 'd1\\_%' ESCAPE '\\'
     ORDER BY name`,
  ).all();
  const names = tables.map(t => t.name);
  const cols = names.length
    ? await db.batch(names.map(n => db.prepare("SELECT name FROM pragma_table_info(?1)").bind(n)))
    : [];
  const estimadas = exacto ? {} : await estimarFilas(db, names);
  const stmts = names.map((n, i) => {
    const bytes = (cols[i]?.results || []).map(c => `COALESCE(length(CAST(${sqlName(c.name)} AS BLOB)), 0)`).join(" + ") || "0";
    return n in estimadas
      ? db.prepare(`SELECT COUNT(*) AS filas, COALESCE(AVG(${bytes}), 0) AS media FROM (SELECT * FROM ${sqlName(n)} LIMIT ${MUESTRA_FILAS})`)
      : db.prepare(`SELECT COUNT(*) AS filas, COALESCE(SUM(${bytes}), 0) AS bytes FROM ${sqlName(n)}`);
  });
  const res = stmts.length ? await db.batch(stmts) : [];
  return names.map((n, i) => {
    const r = res[i]?.results?.[0] || {};
    if (!(n in estimadas)) return { nombre: n, filas: Number(r.filas) || 0, bytes: Number(r.bytes) || 0 };
    const filas = Math.max(estimadas[n], Number(r.filas) || 0);
    return { nombre: n, filas, bytes: Math.round(filas * (Number(r.media) || 0)) };
  }).sort((a, b) => b.bytes - a.bytes || a.nombre.localeCompare(b.nombre));
}

/**
 * Filas de las tablas que crecen cada día, sin recorrerlas:
 * - `daily`: la suma de los días de state.hist_agg (lo mantiene el cierre de
 *   cada día; es exacta salvo por lo que la poda del año ya ha borrado, que se
 *   descuenta acotando cada juego a sus días dentro de DATA_RETENTION_DAYS);
 * - `sort_hits`: filas de ayer × días desde el primer puesto guardado + las de
 *   hoy (buscando por clave primaria juego a juego: lee ~3 filas por juego).
 */
async function estimarFilas(db, names) {
  const today = new Date().toISOString().slice(0, 10);
  const dia = n => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
  const out = {};
  const stmts = [];
  if (names.includes("daily")) stmts.push(["daily", db.prepare(
    `SELECT COALESCE(SUM(MAX(0, MIN(value ->> 2,
       CAST(julianday(value ->> 7) - julianday(MAX(COALESCE(value ->> 3, ?1), ?1)) AS INTEGER) + 1))), 0) AS n
     FROM json_each(COALESCE((SELECT value FROM state WHERE key = 'hist_agg'), '{}'))`,
  ).bind(dia(-DATA_RETENTION_DAYS))]);
  if (names.includes("sort_hits")) stmts.push(["sort_hits", db.prepare(
    `SELECT (SELECT MIN((SELECT MIN(h.date) FROM sort_hits h WHERE h.universe_id = g.universe_id)) FROM games g) AS first,
            COALESCE(SUM(h.date = ?1), 0) AS ayer, COALESCE(SUM(h.date = ?2), 0) AS hoy
     FROM games g CROSS JOIN sort_hits h ON h.universe_id = g.universe_id AND h.date >= ?1`,
  ).bind(dia(-1), today)]);
  if (!stmts.length) return out;
  const res = await db.batch(stmts.map(s => s[1]));
  stmts.forEach(([n], i) => {
    const r = res[i]?.results?.[0] || {};
    if (n === "daily") out.daily = Number(r.n) || 0;
    else {
      const dias = r.first ? Math.max(0, Math.round((Date.parse(dia(-1)) - Date.parse(r.first)) / 86400_000) + 1) : 0;
      out.sort_hits = (Number(r.ayer) || 0) * Math.min(dias, DATA_RETENTION_DAYS) + (Number(r.hoy) || 0);
    }
  });
  return out;
}

const DIAS = { "01": "ene", "02": "feb", "03": "mar", "04": "abr", "05": "may", "06": "jun", "07": "jul", "08": "ago", "09": "sept", "10": "oct", "11": "nov", "12": "dic" };
const fecha = d => `${Number(d.slice(8, 10))} ${DIAS[d.slice(5, 7)] || d.slice(5, 7)} ${d.slice(0, 4)}`;
const WEB = "https://robloxtracker.stonksstudio.com/";

/** Nombre de hoy de una carpeta de R2 del tracker (ruta relativa a `roblox-tracker/`), o null. */
export function nombreDe(ruta) {
  const fijos = {
    "site/": { nombre: "Web del tracker", detalle: "dashboard.html", enlace: WEB },
    "data/": { nombre: "Datos de la web", detalle: "export y Telegram", enlace: WEB },
    "radar/": { nombre: "Radar", detalle: "lecturas de Rolimons, 7 días" },
    "tmp/": { nombre: "Temporales", detalle: "se borran solos" },
    "tmp/export/": { nombre: "Partes del export" },
    "tmp/run/": { nombre: "Muestreos en marcha" },
  };
  if (fijos[ruta]) return fijos[ruta];
  let m = ruta.match(/^radar\/(\d{4}-\d{2}-\d{2})\/$/);
  if (m) return { nombre: `Radar del ${fecha(m[1])}` };
  m = ruta.match(/^tmp\/run\/([^/]+)\/$/);
  if (m) return { nombre: `Muestreo ${m[1]}` };
  return null;
}

/** Lo que el Almacén pide a la app por service binding (entrypoint «Operaciones»). */
export class Operaciones extends WorkerEntrypoint {
  async espacio() {
    return espacioD1(this.env.DB);
  }

  async nombres(rutas) {
    const out = {};
    if (!Array.isArray(rutas)) return out;
    for (const r of rutas.slice(0, MAX_RUTAS)) {
      if (typeof r !== "string" || !r.endsWith("/") || r.startsWith("/")) continue;
      const n = nombreDe(r);
      if (n) out[r] = n;
    }
    return out;
  }
}
