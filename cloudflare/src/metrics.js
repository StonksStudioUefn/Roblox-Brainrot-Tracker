/**
 * metrics.js — Métricas del dashboard (port de analytics.py + export_dashboard.py).
 *
 * Módulo ES sin dependencias: lo usan igual el navegador (que lo descarga de
 * /metrics.js) y el Worker (Telegram, con ~150 juegos y 10 ms de CPU).
 *
 *   buildDashboard(exportData, { now }) → mismo esquema que data/dashboard.json
 *                                          + `roblox_sorts` en cada juego
 *   flagEvents(values, dates)          → días de evento (para /api/history)
 *   cleanTitle(name)                   → reexportado de horror.js
 *
 * Es un port FIEL: mismas fórmulas, umbrales (config.js), redondeos (el
 * `round` de Python redondea al par en los empates, ver pyRound) y orden de
 * las listas. Diferencias de entrada respecto a Python, que veía toda la
 * historia:
 *   · la serie diaria trae solo EXPORT_DAILY_DAYS días: los días de evento del
 *     principio de la ventana no se pueden marcar igual y `event_days` cuenta
 *     como mucho esos días (Python: últimos 30);
 *   · `peak`, `peak_date`, `days_tracked` y `first_day` vienen ya calculados
 *     de toda la historia;
 *   · las muestras son [ts_minutos_epoch, playing, visits] de las últimas
 *     EXPORT_SAMPLE_HOURS h (Python leía 8 días; solo se usan 48 h).
 *
 * Rendimiento: una pasada por juego, arrays pequeños, medianas con
 * ordenación por inserción sobre búferes reutilizados y sin copias del
 * export. Medido con cloudflare/test/metrics.bench.mjs (Node 22, proceso
 * nuevo): 150 juegos ≈ 2,5 ms en caliente y ≈ 10 ms la primera llamada (código
 * aún sin optimizar); 1.000 juegos ≈ 8 ms en caliente, ≈ 25-40 ms en frío.
 * La paridad con Python: cloudflare/test/metrics.parity.mjs.
 */

import { CATEGORIES, EMERGING, EVENTS, SCAN_START, SELECTION, TRACK_MIN_PLAYERS } from './config.js';
import { cleanTitle } from './horror.js';

export { cleanTitle };

const ACTIVE_DAYS = 2;        // sin muestras en 2 días → fuera de las listas
const SPARK_DAYS = 21;        // puntos del minigráfico
const EVENT_DAYS_WINDOW = 30; // `event_days` = días de evento de los últimos 30
const TRENDING_MAX = 12;

// Señal de Roblox para los emergentes. Estar en una lista oficial es una señal
// externa de que el juego despega, independiente de nuestras muestras:
//   · up-and-coming (juegos nuevos que crecen): +15, lo mismo que un 75 % del
//     peso del crecimiento propio (25) o que ser un juego de un mes (≈15/20);
//   · top-trending (crecimiento reciente, también de juegos grandes, aunque esos
//     ya los quita max_visits): +10.
// No se suman entre sí (cuenta la mayor). Nuestros datos mandan: la lista solo
// vale como "está creciendo" para la condición de entrada cuando aún no hay con
// qué medir (tendencia, 24 h y 7 d en null, p. ej. juegos recién descubiertos);
// si las medimos y no crecen, no entra. Tampoco salva a un juego en caída
// (status down/down2) ni a uno con muchas visitas o pocos jugadores. Su motivo
// va el primero para que no lo corte el límite de 4 motivos. La puntuación se
// recorta a 100 (sin la señal el máximo ya era 100).
// Con las listas del 03/10/2026 (cloudflare/test/metrics.parity.mjs --sorts):
// general pasa de 12 a 20 emergentes (8 juegos con 31-44 puntos que ya crecían).
export const ROBLOX_SORT_POINTS = { 'up-and-coming': 15, 'top-trending': 10 };
const ROBLOX_SORT_LABELS = { 'up-and-coming': 'Roblox: Up-and-Coming', 'top-trending': 'Roblox: Top Trending' };

const MIN = 60e6;             // microsegundos por minuto
const DAY_US = 86400e6;
const DAY_MS = 864e5;

// ─── Redondeo como Python ─────────────────────────────────────────────────────
/** round(x) de Python: entero más cercano y, en el empate exacto .5, el par. */
function pyRound0(x) {
  const f = Math.floor(x), d = x - f;           // exacto para |x| < 2^52
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

const P10 = [1, 10, 100, 1000];
/**
 * round(x, nd) de Python. Python redondea el valor binario EXACTO (por eso
 * round(2.675, 2) = 2.67) y solo hay empate si x·2^(nd+1) es un entero impar
 * (p. ej. 0.25, 0.75 con nd=1); entonces va al par.
 */
function pyRound(x, nd) {
  const p = P10[nd], y = x * p;
  const f = Math.floor(y), d = y - f;
  // Lejos de .5 el error de y·10^nd no cambia el resultado: camino rápido.
  if (Math.abs(d - 0.5) > 1e-6 && Math.abs(y) < 1e9) return (d < 0.5 ? f : f + 1) / p;
  const q = x * 2 ** (nd + 1);                  // exacto (potencia de 2)
  if (Number.isInteger(q) && q % 2 !== 0) return (f % 2 === 0 ? f : f + 1) / p;  // empate: y es exacto
  return Number(x.toFixed(nd));                 // toFixed usa el valor exacto
}

/** f"{x:.0f}" de Python. */
const fmt0 = x => String(pyRound0(x));

// ─── Utilidades ───────────────────────────────────────────────────────────────
const clip = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

function pct(nw, old) {
  if (nw == null || !old) return null;
  return pyRound((nw - old) * 100 / old, 1);
}

// Búfer reutilizado para las medianas (las listas son pequeñas: ≤ 28 slopes,
// ≤ 6 vecinos, las muestras de 24 h…). Ordenación por inserción in situ.
let BUF = new Float64Array(64);
function bufFor(n) {
  if (BUF.length < n) BUF = new Float64Array(Math.max(n, BUF.length * 2));
  return BUF;
}
/** Mediana de buf[0..n) (lo ordena). Igual que statistics.median. */
function medianBuf(buf, n) {
  for (let i = 1; i < n; i++) {
    const v = buf[i];
    let j = i - 1;
    while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; }
    buf[j + 1] = v;
  }
  const h = n >> 1;
  return n % 2 ? buf[h] : (buf[h - 1] + buf[h]) / 2;
}
/** Mediana de arr[lo..hi) sin tocar arr; atajo para ≤ 3 (el caso de flagEvents). */
function medianRange(arr, lo, hi) {
  const n = hi - lo;
  if (n === 1) return arr[lo];
  if (n === 2) return (arr[lo] + arr[lo + 1]) / 2;
  if (n === 3) {
    const a = arr[lo], b = arr[lo + 1], c = arr[lo + 2];
    return a > b ? (b > c ? b : a > c ? c : a) : (a > c ? a : b > c ? c : b);
  }
  const buf = bufFor(n);
  for (let i = 0; i < n; i++) buf[i] = arr[lo + i];
  return medianBuf(buf, n);
}

/** "AAAA-MM-DD" → nº de día desde epoch. */
function dayNum(s) {
  return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS;
}
function isoDate(dn) {
  return new Date(dn * DAY_MS).toISOString().slice(0, 10);
}

/**
 * ISO de Roblox → microsegundos desde epoch (entero exacto) o null, como
 * parse_ts (datetime.fromisoformat, que trunca la fracción a microsegundos).
 * Date.parse acepta "…THH:MMZ" y fracciones de más de 3 cifras (las trunca a
 * ms); los dígitos 4-6 se añaden a mano. Es mucho más barato que una regex
 * cuando el código aún no está optimizado (isolate frío).
 */
function isoUs(s) {
  if (!s) return null;
  const ms = Date.parse(s);
  if (ms !== ms) return null;
  const dot = s.indexOf('.', 19);
  if (dot < 0) return ms * 1000;
  let us = 0, i = dot + 1;
  while (i < dot + 4 && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) i++;
  if (i < dot + 4) return ms * 1000;            // ≤ 3 cifras: ya están en ms
  for (let k = 0; k < 3; k++, i++) {
    const c = s.charCodeAt(i) - 48;
    if (!(c >= 0 && c <= 9)) { for (; k < 3; k++) us *= 10; break; }
    us = us * 10 + c;
  }
  return ms * 1000 + us;
}

function toUs(now) {
  if (now == null) return Date.now() * 1000;
  if (now instanceof Date) return now.getTime() * 1000;
  if (typeof now === 'number') return now * 1000;          // ms, como Date.now()
  const us = isoUs(String(now));
  if (us == null) throw new Error('now inválido: ' + now);
  return us;
}

// datetime.isoformat() de Python para un instante UTC
const pyIso = ms => new Date(ms).toISOString().slice(0, 19) + '+00:00';

// ─── Series y eventos ─────────────────────────────────────────────────────────
/**
 * Marca días de evento (picos que se salen de su entorno y luego bajan).
 * Compara con los días de antes Y de después, descuenta el día de la semana
 * (mismo día de hace 7 y 14 días) y nunca marca el último día.
 * `values`: medianas diarias; `dates`: "AAAA-MM-DD" ascendente.
 */
export function flagEvents(values, dates) {
  return flagCore(values, dates.map(dayNum));
}

/**
 * `dn`: nº de día de cada valor. Los vecinos son los 3 de cada lado que estén
 * a 7 días o menos: con huecos, un juego no se compara con días de hace meses.
 */
function flagCore(values, dn) {
  const n = values.length, w = Math.floor(EVENTS.window_days / 2), gap = EVENTS.window_days;
  const minRatio = EVENTS.min_ratio, madK = EVENTS.mad_k;
  const flags = new Array(n).fill(false);
  const b = bufFor(2 * w + 2);
  for (let i = 0; i < n; i++) {
    let lo = Math.max(0, i - w), hi = Math.min(n, i + 1 + w);
    while (lo < i && dn[i] - dn[lo] > gap) lo++;
    while (hi > i + 1 && dn[hi - 1] - dn[i] > gap) hi--;
    const nb = i - lo, na = hi - i - 1;
    if (nb < 2 || na === 0) continue;
    const base = Math.max(medianRange(values, lo, i), medianRange(values, i + 1, hi));
    const v = values[i];
    if (!(v > base * minRatio)) continue;          // corta antes de calcular la MAD
    let k = 0;
    for (let j = lo; j < hi; j++) if (j !== i) b[k++] = values[j];
    const m = medianBuf(b, k);
    for (let j = 0; j < k; j++) b[j] = Math.abs(b[j] - m);
    const mad = Math.max(medianBuf(b, k) * 1.4826, m * 0.05);
    if (!((v - base) > madK * mad)) continue;
    // ¿Se explica por el día de la semana?
    let maxSame = null;
    for (const back of [7, 14]) {
      const target = dn[i] - back;
      for (let j = i - 1; j >= 0 && dn[j] >= target; j--) {
        if (dn[j] === target) {
          const x = values[j];
          if (x && (maxSame === null || x > maxSame)) maxSame = x;
          break;
        }
      }
    }
    flags[i] = !(maxSame !== null && v < maxSame * minRatio);
  }
  return flags;
}

const TX = new Float64Array(8), TY = new Float64Array(8), LAST8 = new Float64Array(8), LAST8X = new Float64Array(8);
const MAX7 = new Float64Array(8), SAME = new Float64Array(4);

/** Crecimiento diario típico (%) por Theil–Sen sobre vals[0..k) en los días xs[0..k) (k ≤ 8). */
function theilSen(vals, xs, k) {
  let n = 0;
  for (let i = 0; i < k; i++) {
    const v = vals[i];
    if (v && v > 0) { TX[n] = xs[i]; TY[n] = Math.log(v); n++; }
  }
  if (n < 4) return null;
  const b = bufFor(n * (n - 1) / 2);
  let m = 0;
  for (let a = 0; a < n; a++) for (let c = a + 1; c < n; c++) b[m++] = (TY[c] - TY[a]) / (TX[c] - TX[a]);
  return pyRound((Math.exp(medianBuf(b, m)) - 1) * 100, 1);
}

// ─── Métricas por juego ───────────────────────────────────────────────────────
// `g` es un juego del export. Las ventanas van por FECHA, contadas hacia atrás
// desde ayer (el último día cerrado): el día de hoy está a medias y solo cuenta
// para «ahora» y las 24 h (por las muestras).
function gameMetrics(g, ctx) {
  const d = g.d || [], s = g.s || [];
  const n = d.length;
  const values = new Array(n), dn = new Array(n);
  for (let i = 0; i < n; i++) { values[i] = d[i][1]; dn[i] = dayNum(d[i][0]); }
  const events = flagCore(values, dn);
  let nc = n;                                       // filas de días cerrados: [0, nc)
  while (nc > 0 && dn[nc - 1] >= ctx.today) nc--;
  const D = ctx.today - 1;                          // ayer: el último día cerrado

  // Muestras (ascendentes según el contrato)
  const ns = s.length;
  const lastTs = ns ? s[ns - 1][0] : null;           // minutos
  const nowPlayers = ns ? s[ns - 1][1] : (n ? values[n - 1] : 0);
  const ref = lastTs ?? ctx.nowMin;

  // Jugadores típicos: mediana de las últimas 24 h; y las 24 h anteriores
  const b = bufFor(ns);
  let n24 = 0;
  for (let i = 0; i < ns; i++) { const t = s[i][0]; if (t >= ref - 1440 && t < ref + 1) b[n24++] = s[i][1]; }
  let typical = n24 ? medianBuf(b, n24) : null;
  // Sin muestras: el último día cerrado (o el de hoy si no hay otro)
  const tIdx = nc ? nc - 1 : n - 1;
  if (n24 < 2) typical = n ? values[tIdx] : nowPlayers;
  let nprev = 0;
  for (let i = 0; i < ns; i++) { const t = s[i][0]; if (t >= ref - 2880 && t < ref - 1440) b[nprev++] = s[i][1]; }
  let prev = nprev ? medianBuf(b, nprev) : null;
  if (nprev < 2) {
    prev = null;
    // sin muestras de ayer: el último día "limpio" cerrado anterior al que da el típico (≤ 7 días antes)
    const from = n24 < 2 ? tIdx - 1 : nc - 1;
    const anchor = n24 < 2 && tIdx >= 0 ? dn[tIdx] : D + 1;
    for (let i = from; i >= 0 && anchor - dn[i] <= 7; i--) if (!events[i]) { prev = values[i]; break; }
  }
  const growth24 = pct(typical, prev);

  // Una pasada hacia atrás por los días cerrados; k = D − día + 1 (1 = ayer):
  //   7 días = k 1..7, recent3 = k 1..3, week_ago = k 7..10 y k 1..8 para la
  //   tendencia, todos sin días de evento; los máximos de k 1..7 y del mismo
  //   día de la semana de hace 1-3 semanas para el pico; días de evento de los
  //   últimos 30; las 2 últimas visitas (en todas las filas).
  let sum7 = 0, c7 = 0, sum3 = 0, c3 = 0, sumW = 0, cW = 0, evDays = 0;
  let n8 = 0, nmax = 0, nsame = 0, vz = -1, va = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (va < 0 && d[i][5]) { if (vz < 0) vz = i; else va = i; }
    if (i >= nc) continue;
    const k = D - dn[i] + 1;
    if (k > 30 && va >= 0) break;
    if (events[i]) {
      if (k <= EVENT_DAYS_WINDOW) evDays++;
      continue;
    }
    const v = values[i];
    if (k <= 7) { sum7 += v; c7++; MAX7[nmax++] = d[i][3] ?? v; }
    if (k <= 3) { sum3 += v; c3++; }
    if (k >= 7 && k <= 10) { sumW += v; cW++; }
    if (k <= 8) { LAST8[n8] = v; LAST8X[n8] = dn[i]; n8++; }
    const back = ctx.today - dn[i];
    if (back % 7 === 0 && back <= 21 && nsame < 3) SAME[nsame++] = d[i][3] ?? v;
  }
  const avg7 = c7 ? pyRound0(sum7 / c7) : typical;
  const growth7 = c3 && cW ? pct(sum3 / c3, sumW / cW) : null;
  for (let a = 0, z = n8 - 1; a < z; a++, z--) {
    let t = LAST8[a]; LAST8[a] = LAST8[z]; LAST8[z] = t;
    t = LAST8X[a]; LAST8X[a] = LAST8X[z]; LAST8X[z] = t;
  }
  const trend = theilSen(LAST8, LAST8X, n8);

  // Pico ahora: la última muestra frente a los MÁXIMOS diarios (con muestras
  // cada hora la mediana del día queda por debajo del pico de la tarde) de los
  // 7 días limpios anteriores y, si los hay, del mismo día de la semana de
  // hace 1-3 semanas.
  const baseMax = nmax >= 4 ? medianBuf(MAX7, nmax) : null;
  const sameMax = nsame ? medianBuf(SAME, nsame) : null;
  const spikeNow = !!(baseMax && nowPlayers >= baseMax * EVENTS.spike_now_ratio
    && (sameMax === null || nowPlayers >= sameMax * EVENTS.spike_weekday_ratio));

  // Visitas: actuales y ganadas en el último día
  const visits = vz >= 0 ? d[vz][5] : null;
  let visitsDay = null;
  let i1 = ns - 1;
  while (i1 >= 0 && !s[i1][2]) i1--;
  if (i1 >= 0) {
    const t1 = s[i1][0], v1 = s[i1][2];
    for (let i = i1 - 1; i >= 0; i--) {
      if (s[i][2] && s[i][0] <= t1 - 1200) {      // 20 h antes como mínimo
        visitsDay = pyRound0((v1 - s[i][2]) * 86400 / Math.max((t1 - s[i][0]) * 60, 1));
        break;
      }
    }
  }
  if (visitsDay === null && va >= 0) {
    const gap = (dn[vz] - dn[va]) || 1;
    visitsDay = pyRound0((d[vz][5] - d[va][5]) / gap);
  }
  if (visitsDay !== null && visitsDay < 0) visitsDay = null;

  const fav = g.favorites || null;
  const up = g.up ?? null, down = g.down ?? null;
  const likeRatio = up !== null && down !== null && up + down > 0 ? pyRound(up * 100 / (up + down), 1) : null;

  const created = isoUs(g.created), updated = isoUs(g.updated), firstSeen = isoUs(g.first_seen);
  let seen = g.first_day ? dayNum(g.first_day) : (n ? dn[0] : null);
  if (firstSeen !== null) {
    const fs = Math.floor(firstSeen / DAY_US);
    if (seen === null || fs < seen) seen = fs;
  }
  const firstSeenDays = seen !== null ? ctx.today - seen : null;
  // Antes de SCAN_START + 2 días todo el catálogo es "nuevo"
  const trusted = seen !== null && seen >= ctx.scanStart + 2;

  const last = n ? d[n - 1] : null;
  return {
    players: nowPlayers,
    _lastTs: lastTs,                    // players_ts se formatea en summary()
    typical: typical != null ? pyRound0(typical) : null,
    avg_7d: avg7,
    growth_24h: growth24,
    growth_7d: growth7,
    trend,
    spike_now: spikeNow,
    event_days: evDays,
    peak: g.peak ?? nowPlayers,
    peak_date: g.peak_date ?? null,
    visits,
    visits_day: visitsDay,
    visits_growth: visits && visitsDay ? pyRound(visitsDay * 100 / visits, 2) : null,
    favorites: fav,
    like_ratio: likeRatio,
    votes: up !== null ? (up || 0) + (down || 0) : null,
    age_days: created !== null ? Math.floor((ctx.nowUs - created) / DAY_US) : null,
    updated_days: updated !== null ? pyRound((ctx.nowUs - updated) / 1e6 / 86400, 1) : null,
    first_seen_days: firstSeenDays,
    fresh: !!(trusted && firstSeenDays <= 3),
    new_week: !!(trusted && firstSeenDays <= 7),
    days_tracked: g.days_tracked ?? n,
    samples_today: last && last[0] === ctx.todayIso ? last[4] : 0,
    status: null,
    momentum: 0,
    _events: events,
    _values: values,
  };
}

// ─── Estado y puntuaciones ────────────────────────────────────────────────────
/** analytics.status: si 24 h y tendencia se contradicen, manda la tendencia. */
function status(m) {
  const t = m.trend;
  let g = m.growth_24h;
  if (g === null && t === null) return 'new';
  g = g || 0;
  if ((t !== null && t >= 15) || (g >= 30 && (t === null || t >= 0))) return 'hot';
  if ((t !== null && t >= 5) || (g >= 10 && (t === null || t >= -1))) return 'up';
  if ((t !== null && t <= -8) || (g <= -20 && (t === null || t <= 0))) return 'down2';
  if ((t !== null && t <= -3) || (g <= -7 && (t === null || t <= 1))) return 'down';
  return 'flat';
}

const LOG_SIZE = Math.log10(1_000_000 / 300);
/** analytics.momentum_score: 0-100, crecimiento sostenido ponderado por tamaño. */
function momentumScore(m) {
  const t = m.trend || 0, g24 = m.growth_24h || 0, g7 = m.growth_7d || 0;
  const size = clip(Math.log10(Math.max(m.typical || 1, 1) / 300) / LOG_SIZE);
  let s = 35 * clip(t / 20) + 25 * clip(g24 / 50) + 20 * clip(g7 / 100) + 20 * size;
  if (m.spike_now && t < 5) s *= 0.7;   // sube solo por un evento: cuenta menos
  return pyRound0(s);
}

const LOG30 = Math.log10(30);
/** analytics.emerging + la señal de las listas de Roblox. → [score, motivos] o null. */
function emerging(m, sorts) {
  return emergingCore(m, sorts, true);
}

/**
 * strict = true: la regla de emergentes (lo que sale en la web y en Telegram).
 * strict = false: puntuación de CANDIDATO para elegir qué juegos se siguen
 * (radar): la misma fórmula, pero sin corte por puntuación, con visitas aún
 * desconocidas (juego recién descubierto) y, si no crece o está bajando, a mitad.
 */
function emergingCore(m, sorts, strict) {
  const cfg = EMERGING;
  const visits = m.visits, typical = m.typical || 0;
  if (typical < cfg.min_players || (visits !== null && visits > cfg.max_visits)) return null;
  if (visits === null && strict) return null;
  const t = m.trend, g24 = m.growth_24h, g7 = m.growth_7d;
  // Listas oficiales de Roblox (ver ROBLOX_SORT_POINTS)
  let sRoblox = 0;
  const rReasons = [];
  if (sorts) {
    for (const k of cfg.roblox_sorts || []) {
      if (sorts[k] != null) {
        sRoblox = Math.max(sRoblox, ROBLOX_SORT_POINTS[k] ?? 10);
        rReasons.push(ROBLOX_SORT_LABELS[k] || 'Roblox: ' + k);
      }
    }
  }
  const growing = (t !== null && t > 0) || (g24 !== null && g24 > 0) || (g7 !== null && g7 > 0)
    || (sRoblox > 0 && t === null && g24 === null && g7 === null);
  const fresh = m.fresh;
  const weak = (!growing && !fresh) || m.status === 'down' || m.status === 'down2';
  if (weak && strict) return null;

  const reasons = rReasons;
  const vg = m.visits_growth || 0;
  const sVisits = 30 * clip(vg / 12);
  if (vg >= 3) reasons.push(`visitas +${fmt0(vg)}%/día`);

  const growth = Math.max(t || 0, (g24 || 0) / 2, (g7 || 0) / 5);
  const sGrowth = 25 * clip(growth / 20);
  if (t && t >= 5) reasons.push(`tendencia +${fmt0(t)}%/día`);
  else if (g24 && g24 >= 15) reasons.push(`+${fmt0(g24)}% en 24h`);

  const age = m.age_days;
  let sYoung = age !== null ? 20 * clip(1 - age / cfg.max_age_days) : 0;
  if (age !== null && age <= 30) reasons.push(`creado hace ${age} días`);
  if (fresh) {
    sYoung = Math.max(sYoung, 8);
    reasons.push('recién detectado');
  }

  const sSize = 15 * clip(Math.log10(typical / cfg.min_players) / LOG30);
  const lr = m.like_ratio;
  const sLike = 10 * clip(((lr || 0) - 75) / 20);
  if (lr && lr >= 90) reasons.push(`${fmt0(lr)}% likes`);
  if (visits !== null && visits < 2_000_000) reasons.push('menos de 2M visitas');

  // sRoblox va al final: con 0 la suma es la misma que en Python. Sin él el
  // máximo ya es 100; con él se recorta a 100 para que siga siendo 0-100.
  let score = Math.min(100, pyRound0(sVisits + sGrowth + sYoung + sSize + sLike + sRoblox));
  if (m.spike_now && (t || 0) < 5) score = pyRound0(score * 0.8);
  if (!strict) return [weak ? score / 2 : score, reasons];
  if (score < cfg.min_score) return null;
  return [score, reasons.slice(0, 4)];
}

/**
 * Radar: métricas mínimas de un juego para elegir los que se siguen.
 * `g` como un juego del export (sin muestras basta: d con la serie diaria).
 * → [typical, candidato (0-100) | null], o null si lleva 2 días sin datos.
 */
export function radarScore(g, { now } = {}) {
  const ctx = radarCtx(now);
  const d = g.d;
  if (!d || !d.length || d[d.length - 1][0] < ctx.activeCut) return null;
  const m = gameMetrics(g, ctx);
  m.status = status(m);
  const c = emergingCore(m, g.sorts, false);
  return [m.typical || 0, c ? c[0] : null];
}

let RADAR_CTX = null;
function radarCtx(now) {
  const nowUs = toUs(now);
  if (RADAR_CTX && RADAR_CTX.nowUs === nowUs) return RADAR_CTX;
  const today = Math.floor(nowUs / DAY_US);
  RADAR_CTX = {
    nowUs, nowMin: nowUs / MIN, today, todayIso: isoDate(today), scanStart: dayNum(SCAN_START),
    activeCut: isoDate(Math.floor((nowUs - ACTIVE_DAYS * DAY_US) / DAY_US)),
  };
  return RADAR_CTX;
}

/**
 * Las cifras de cada juego que necesita el prefiltro de Telegram (telegram.js
 * quickRows), calculadas con las MISMAS funciones que buildDashboard: así los
 * candidatos y el dashboard no pueden separarse. → [{ g, m, em }] (activos).
 */
export function quickMetrics(games, { now } = {}) {
  const ctx = radarCtx(now);
  const out = [];
  for (const g of games || []) {
    const d = g.d;
    if (!d || !d.length || d[d.length - 1][0] < ctx.activeCut) continue;
    const m = gameMetrics(g, ctx);
    m.status = status(m);
    m.momentum = momentumScore(m);
    out.push({ g, m, em: emerging(m, g.sorts) });
  }
  return out;
}

/** «En tendencia»: subiendo de forma sostenida, sin ser solo un pico. */
export const isRising = m => (m.status === 'hot' || m.status === 'up') && (m.trend === null || m.trend > 0)
  && !(m.spike_now && (m.trend || 0) < 5);

// ─── Dashboard ────────────────────────────────────────────────────────────────
/**
 * Port de export_dashboard.build() sobre el export de Cloudflare.
 * `now`: Date, ms desde epoch o ISO (por defecto, ahora).
 */
export function buildDashboard(exportData, { now } = {}) {
  const nowUs = toUs(now);
  const nowMs = Math.floor(nowUs / 1000);
  const today = Math.floor(nowUs / DAY_US);
  const ctx = {
    nowUs, nowMin: nowUs / MIN, today, todayIso: isoDate(today),
    scanStart: dayNum(SCAN_START),
  };
  const activeCut = isoDate(Math.floor((nowUs - ACTIVE_DAYS * DAY_US) / DAY_US));

  const list = [];          // [{ g, m, horror, em, firstDay }]
  for (const g of exportData.games || []) {
    const d = g.d;
    if (!d || !d.length || d[d.length - 1][0] < activeCut) continue;
    const m = gameMetrics(g, ctx);
    m.status = status(m);
    m.momentum = momentumScore(m);
    const em = emerging(m, g.sorts);
    list.push({ g, m, horror: !!g.horror, em, firstDay: g.first_day || d[0][0] });
  }

  // Python recorre los juegos por orden de aparición en el CSV diario: primera
  // fecha y luego id. Como sus sort son estables, ese orden decide los empates.
  const byOrder = (a, b) => (a.firstDay < b.firstDay ? -1 : a.firstDay > b.firstDay ? 1 : a.g.id - b.g.id);

  const categories = {};
  const used = new Set();
  for (const [key, cfg] of Object.entries(CATEGORIES)) {
    const belongs = x => cfg.classifier === 'all' || x.horror;
    const ids = list.filter(x => belongs(x) && (x.m.typical || 0) >= cfg.min_players);
    ids.sort((a, b) => ((b.m.typical || 0) - (a.m.typical || 0)) || byOrder(a, b));
    const emerg = list.filter(x => belongs(x) && x.em);
    emerg.sort((a, b) => (b.em[0] - a.em[0]) || byOrder(a, b));
    emerg.length = Math.min(emerg.length, EMERGING.max_results);
    const rising = ({ m }) => isRising(m);
    const trending = ids.filter(rising).sort((a, b) => b.m.momentum - a.m.momentum).slice(0, TRENDING_MAX);
    let players = 0, up = 0, down = 0, events = 0, new7 = 0;
    for (const { m } of ids) {
      players += m.typical || 0;
      if (m.status === 'hot' || m.status === 'up') up++;
      if (m.status === 'down' || m.status === 'down2') down++;
      if (m.spike_now) events++;
      if (m.new_week) new7++;
    }
    categories[key] = {
      label: cfg.label,
      icon: cfg.icon ?? '🎮',
      min_players: cfg.min_players,
      ids: ids.map(x => x.g.id),
      top: ids.slice(0, SELECTION.top).map(x => x.g.id),
      emerging: emerg.map(x => x.g.id),
      trending: trending.map(x => x.g.id),
      stats: { games: ids.length, players, rising: up, falling: down, events, new_7d: new7 },
    };
    for (const x of ids) used.add(x);
    for (const x of emerg) used.add(x);
  }

  // Solo se resumen los juegos que salen en alguna lista (como Python)
  const games = {};
  for (const x of [...used].sort((a, b) => a.g.id - b.g.id)) games[String(x.g.id)] = summary(x);

  return {
    updated_at: pyIso(nowMs),
    last_sample: exportData.last_sample ?? null,
    samples_24h: exportData.samples_24h ?? 0,
    track_min_players: TRACK_MIN_PLAYERS,
    emerging_max_visits: EMERGING.max_visits,
    categories,
    games,
  };
}

function summary({ g, m, em }) {
  const [title, tags] = cleanTitle(g.name || '');
  const events = m._events, values = m._values, n = values.length;
  const from = Math.max(0, n - SPARK_DAYS);
  const spark = values.slice(from), sparkEv = [];
  for (let i = from; i < n; i++) if (events[i]) sparkEv.push(i - from);
  return {
    id: g.id,
    place_id: g.place_id ?? null,
    name: g.name ?? null,
    title,
    tags,
    creator: g.creator ?? null,
    creator_verified: g.creator_verified ?? null,
    genre: g.genre_l1 ?? null,
    subgenre: g.genre_l2 ?? null,
    max_players: g.max_players ?? null,
    created: g.created ?? null,
    updated: g.updated ?? null,
    horror: !!g.horror,
    horror_score: g.horror_score ?? 0,
    horror_reasons: g.horror_reasons ?? [],
    emerging: em ? em[0] : null,
    emerging_reasons: em ? em[1] : [],
    spark,
    spark_ev: sparkEv,
    players: m.players,
    players_ts: m._lastTs !== null ? pyIso(m._lastTs * 60000) : null,
    typical: m.typical,
    avg_7d: m.avg_7d,
    growth_24h: m.growth_24h,
    growth_7d: m.growth_7d,
    trend: m.trend,
    spike_now: m.spike_now,
    event_days: m.event_days,
    peak: m.peak,
    peak_date: m.peak_date,
    visits: m.visits,
    visits_day: m.visits_day,
    visits_growth: m.visits_growth,
    favorites: m.favorites,
    like_ratio: m.like_ratio,
    votes: m.votes,
    age_days: m.age_days,
    updated_days: m.updated_days,
    first_seen_days: m.first_seen_days,
    fresh: m.fresh,
    new_week: m.new_week,
    days_tracked: m.days_tracked,
    samples_today: m.samples_today,
    status: m.status,
    momentum: m.momentum,
    roblox_sorts: g.sorts || {},
  };
}
