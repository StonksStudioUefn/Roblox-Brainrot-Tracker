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

/**
 * El `Espacio` del contrato del ecosistema (contrato/tipos.ts) para la base D1.
 * base.bytes es el tamaño de la base que da D1 (meta.size_after); el desglose
 * suma lo que ocupan los valores de cada fila (sin índices ni páginas), como
 * medirTablas() del contrato.
 */
export async function espacioD1(db) {
  const { results: tables } = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE 'd1\\_%' ESCAPE '\\'
     ORDER BY name`,
  ).all();
  const names = tables.map(t => t.name);
  const cols = names.length
    ? await db.batch(names.map(n => db.prepare("SELECT name FROM pragma_table_info(?1)").bind(n)))
    : [];
  const stmts = names.map((n, i) => {
    const bytes = (cols[i]?.results || []).map(c => `COALESCE(length(CAST(${sqlName(c.name)} AS BLOB)), 0)`).join(" + ") || "0";
    return db.prepare(`SELECT COUNT(*) AS filas, COALESCE(SUM(${bytes}), 0) AS bytes FROM ${sqlName(n)}`);
  });
  const res = stmts.length ? await db.batch(stmts) : [];
  let size = 0;
  for (const r of [...cols, ...res]) size = Math.max(size, Number(r?.meta?.size_after) || 0);
  if (!size) size = Number((await db.prepare("SELECT 1").run())?.meta?.size_after) || 0;
  const tablas = names.map((n, i) => ({
    nombre: n, filas: Number(res[i]?.results?.[0]?.filas) || 0, bytes: Number(res[i]?.results?.[0]?.bytes) || 0,
  })).sort((a, b) => b.bytes - a.bytes || a.nombre.localeCompare(b.nombre));
  return {
    app: APP,
    medido: new Date().toISOString(),
    base: { bytes: size, tablas },
    mayores: [{ nombre: "Base D1 «roblox-tracker»", bytes: size, tope: D1_TOPE }],
  };
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
