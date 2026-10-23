import { WorkerEntrypoint } from "cloudflare:workers";
import { DATA_RETENTION_DAYS, TELEGRAM } from "./config.js";
import { addDays, getState, isoDate, minuteOf, setState } from "./db.js";

export const APP = "roblox-tracker";
const PREFIX = `${APP}/`;
const D1_TOPE = 500_000_000;   // D1: 500 MB por base en el plan gratis
const MAX_RUTAS = 500;

// En la carpeta roblox-tracker/ del bucket común: así sale en el Almacén.
function appBucket(bucket) {
  if (!bucket) return bucket;
  const k = key => PREFIX + key;
  const short = o => ({ key: o.key.slice(PREFIX.length), uploaded: o.uploaded });
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
      return { ...r, objects: r.objects.map(short) };
    },
  };
}

export const withApp = env => (env.BUCKET?.__app ? env : { ...env, BUCKET: appBucket(env.BUCKET) });

const sqlName = s => `"${String(s).replaceAll('"', '""')}"`;
const ESPACIO_KEY = "espacio";
const ESPACIO_VIDA_MS = 24 * 3600_000;
const MUESTRA_FILAS = 256;   // filas para estimar lo que ocupa una fila de una tabla grande

// Desglose 1 vez al día: contar recorre ~60.000 filas (2 M en un año) y el tope es 5 M al día.
export async function espacioD1(db, { exacto = false } = {}) {
  const cache = await getState(db, ESPACIO_KEY).catch(() => null);
  let medida = !exacto && cache?.tablas && Date.now() - Date.parse(cache.medido) < ESPACIO_VIDA_MS ? cache : null;
  if (!medida) {
    medida = { medido: new Date().toISOString(), tablas: await medirTablas(db, exacto) };
    await setState(db, ESPACIO_KEY, medida).catch(() => null);
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

// Por clave primaria juego a juego (~3 filas cada uno), nunca recorriendo daily/sort_hits/samples.
async function estimarFilas(db, names) {
  const today = isoDate(minuteOf(Date.now()));
  const dia = n => addDays(today, n);
  const out = {};
  const stmts = [];
  if (names.includes("daily") && names.includes("hist")) stmts.push(["daily", db.prepare(
    `SELECT COALESCE(SUM(MAX(0, MIN(days,
       CAST(julianday(last_date) - julianday(MAX(COALESCE(first_day, ?1), ?1)) AS INTEGER) + 1))), 0) AS n
     FROM hist`,
  ).bind(dia(-DATA_RETENTION_DAYS))]);
  if (names.includes("sort_hits")) stmts.push(["sort_hits", db.prepare(
    `SELECT (SELECT MIN((SELECT MIN(h.date) FROM sort_hits h WHERE h.universe_id = g.universe_id)) FROM games g) AS first,
            COALESCE(SUM(h.date = ?1), 0) AS ayer, COALESCE(SUM(h.date = ?2), 0) AS hoy
     FROM games g CROSS JOIN sort_hits h ON h.universe_id = g.universe_id AND h.date >= ?1`,
  ).bind(dia(-1), today)]);
  // Desde la última muestra (y no desde ahora): si el muestreo se para, la estimación no baja
  if (names.includes("samples")) stmts.push(["samples", db.prepare(
    `SELECT (SELECT CAST(value AS INTEGER) FROM state WHERE key = 'last_sample_ts') AS last,
            (SELECT COUNT(*) FROM games g CROSS JOIN samples s ON s.universe_id = g.universe_id
               AND s.ts > (SELECT CAST(value AS INTEGER) FROM state WHERE key = 'last_sample_ts') - 1440) AS dia,
            (SELECT MIN((SELECT MIN(ts) FROM samples s WHERE s.universe_id = g.universe_id)) FROM games g) AS primera`,
  )]);
  if (!stmts.length) return out;
  const res = await db.batch(stmts.map(s => s[1]));
  stmts.forEach(([n], i) => {
    const r = res[i]?.results?.[0] || {};
    // hist vacía con daily llena (antes de la primera hist_agg): daily se cuenta.
    if (n === "daily") { if (Number(r.n) > 0) out.daily = Number(r.n); }
    else if (n === "samples") {
      const dias = r.primera != null && r.last != null ? Math.max(1, (Number(r.last) - Number(r.primera)) / 1440) : 1;
      out.samples = Math.round((Number(r.dia) || 0) * dias);
    } else {
      const dias = r.first ? Math.max(0, Math.round((Date.parse(dia(-1)) - Date.parse(r.first)) / 86400_000) + 1) : 0;
      out.sort_hits = (Number(r.ayer) || 0) * Math.min(dias, DATA_RETENTION_DAYS) + (Number(r.hoy) || 0);
    }
  });
  return out;
}

const DIAS = { "01": "ene", "02": "feb", "03": "mar", "04": "abr", "05": "may", "06": "jun", "07": "jul", "08": "ago", "09": "sept", "10": "oct", "11": "nov", "12": "dic" };
const fecha = d => `${Number(d.slice(8, 10))} ${DIAS[d.slice(5, 7)] || d.slice(5, 7)} ${d.slice(0, 4)}`;
const WEB = TELEGRAM.dashboard_url;

const FIJOS = {
  "site/": { nombre: "Web del tracker", detalle: "dashboard.html", enlace: WEB },
  "data/": { nombre: "Datos de la web", detalle: "export y Telegram", enlace: WEB },
  "radar/": { nombre: "Radar", detalle: "lecturas de Rolimons, 7 días" },
  "tmp/": { nombre: "Temporales", detalle: "se borran solos" },
  "tmp/export/": { nombre: "Partes del export" },
  "tmp/run/": { nombre: "Muestreos en marcha" },
};

function nombreDe(ruta) {
  if (Object.hasOwn(FIJOS, ruta)) return FIJOS[ruta];
  let m = ruta.match(/^radar\/(\d{4}-\d{2}-\d{2})\/$/);
  if (m) return { nombre: `Radar del ${fecha(m[1])}` };
  m = ruta.match(/^tmp\/run\/([^/]+)\/$/);
  if (m) return { nombre: `Muestreo ${m[1]}` };
  return null;
}

export class Operaciones extends WorkerEntrypoint {
  async espacio() {
    return espacioD1(this.env.DB);
  }

  async nombres(rutas) {
    const out = {};
    if (!Array.isArray(rutas)) return out;
    for (const r of rutas.slice(0, MAX_RUTAS)) {
      if (typeof r !== "string") continue;
      const n = nombreDe(r);
      if (n) out[r] = n;
    }
    return out;
  }
}
