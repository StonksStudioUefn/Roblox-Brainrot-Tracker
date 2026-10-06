var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/config.js with { type: 'text' }
var config_default = '/**\n * config.js \u2014 Configuraci\xF3n \xFAnica del tracker (Worker, Workflow y navegador).\n *\n * Es un m\xF3dulo ES sin dependencias: lo importan el Worker (muestreo, horror,\n * Telegram) y el dashboard (m\xE9tricas), que lo descarga de /config.js.\n * Port fiel de config.py.\n */\n\n// \u2500\u2500\u2500 Recolecci\xF3n \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nexport const TRACK_MIN_PLAYERS = 300;     // por debajo de esto no se toman muestras\nexport const UNTRACK_AFTER_DAYS = 3;      // d\xEDas seguidos por debajo \u2192 deja de seguirse\nexport const SAMPLE_RETENTION_DAYS = 8;   // muestras de cada hora en D1 (el resto vive en `daily`)\nexport const DATA_RETENTION_DAYS = 365;   // filas diarias y puestos en listas: se borran al pasar un a\xF1o\nexport const RADAR_EVERY_HOURS = 3;       // el radar (Rolimons) se lee cada 3 h: para su dato diario basta\nexport const EXPORT_DAILY_DAYS = 24;      // filas de serie diaria por juego en /api/export (\xFAltimas N filas; 24 = paridad con Python)\nexport const EXPORT_SAMPLE_HOURS = 48;    // horas de muestras intrad\xEDa en /api/export\nexport const HISTORY_DAYS = 365;          // d\xEDas de serie en /api/history/:id (semana, mes y a\xF1o de la ficha)\nexport const HISTORY_SAMPLE_DAYS = 2;     // d\xEDas de muestras en /api/history/:id (la vista "D\xEDa", por horas)\n\n// Hasta 2 d\xEDas despu\xE9s no se marca ning\xFAn juego como "reci\xE9n detectado"\n// (al empezar, todo el cat\xE1logo es nuevo para el tracker).\nexport const SCAN_START = "2026-10-02";\n\n// Palabras que el buscador oficial de Roblox recorre por turnos (1 por muestreo,\n// cada hora: cada palabra sale ~1,5 veces al d\xEDa sin forzar el l\xEDmite del buscador)\nexport const SEARCH_QUERIES = [\n  "horror", "killer", "jumpscare", "escape monster", "haunted", "scary",\n  "backrooms", "nightmare", "anomaly", "survive the night", "creepy", "fnaf",\n  "asymmetrical", "monster", "hide and seek horror", "story horror",\n];\nexport const SEARCH_QUERIES_PER_RUN = 1;\nexport const SEARCH_PAGES_PER_QUERY = 3;\n\n// \u2500\u2500\u2500 Radar y juegos seguidos \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// El radar mira en cada muestreo todos los juegos con \u2265 TRACK_MIN_PLAYERS (la\n// lista de Rolimons: 1 petici\xF3n) y guarda de cada uno un solo dato al d\xEDa.\n// Solo los juegos SEGUIDOS (elegidos una vez al d\xEDa) tienen muestras cada hora,\n// votos y salen en la web y en Telegram.\nexport const SELECTION = {\n  top: 10,                 // los que m\xE1s jugadores tienen, en cada pesta\xF1a\n  emerging_general: 150,   // mejores candidatos a emergente (todo Roblox)\n  emerging_horror: 50,     // mejores candidatos a emergente de horror\n  keep_factor: 1.5,        // un juego ya seguido sigue mientras est\xE9 en el 150 % de su lista\n};\n\n// \u2500\u2500\u2500 Categor\xEDas (pesta\xF1as del dashboard) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Con min_players = TRACK_MIN_PLAYERS cada pesta\xF1a lista todos sus juegos seguidos.\nexport const CATEGORIES = {\n  general: { label: "General", icon: "\u{1F3AE}", min_players: 300, classifier: "all" },\n  horror: { label: "Horror", icon: "\u{1F47B}", min_players: 300, classifier: "horror" },\n};\n\n// \u2500\u2500\u2500 Clasificaci\xF3n de horror \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nexport const HORROR = {\n  threshold: 5,\n  name_strong: [\n    "horror", "scary", "creepy", "haunted", "nightmare", "backrooms",\n    "doors", "mimic", "piggy", "granny", "slender", "specimen", "asylum",\n    "cursed", "ghost", "killer", "evade", "forsaken", "pressure",\n    "apeirophobia", "the rake", "siren head", "jumpscare", "paranormal",\n    "phobia", "exorcis", "possessed", "terror", "insanity", "anomal",\n    "survive the night", "dead rails", "entity", "poppy", "rainbow friends",\n    "fnaf", "freddy", "the intruder", "spooky", "dread", "flee the facility",\n    "residence massacre", "nights at", "die of death", "99 nights", "scp",\n    "nextbot", "slendytubbies", "the butchery", "infectious smile", "grace",\n    "banban", "a quiet place", ".exe", "hello neighbor", "demonology",\n  ],\n  name_weak: [\n    "escape", "survive", "survival", "hide", "run from", "chased",\n    "night", "dark", "fog", "midnight", "shadow", "abandoned",\n    "hospital", "prison", "basement", "facility", "lost", "alone",\n    "hunt", "blood", "evil", "trapped", "murder", "monster", "demon",\n    "zombie", "scream", "story",\n  ],\n  name_negative: [\n    "brainrot", "tsunami", "lucky block", "tycoon", "simulator", "obby",\n    "tower", "race", "speed", "anime", "steal a", "steal an", "lava",\n    "flood", "admin", "rng", "clicker", "keyboard",\n  ],\n  tags: ["horror", "scary", "anomaly"],\n  desc_strong: [\n    "horror", "scary", "jumpscare", "jump scare", "creepy", "terrifying",\n    "nightmare", "killer", "survive the night", "don\'t get caught",\n    "dont get caught", "hide from", "being hunted", "hunted by",\n    "chased by", "paranormal", "spooky", "frightening", "backrooms",\n    "entity", "entities", "anomal", "sanity",\n  ],\n  desc_weak: [\n    "monster", "creature", "demon", "zombie", "ghost", "haunted", "cursed",\n    "lurk", "possessed", "escape", "survive", "dark", "flashlight",\n    "run from", "chase", "abandoned", "lights out", "murderer",\n  ],\n  points: {\n    name_strong: 4, name_weak: 1, name_negative: -3,\n    desc_strong: 3, desc_strong_cap: 5,\n    desc_weak: 1, desc_weak_cap: 2,\n  },\n  legacy_genres: { Horror: 5 },\n  genres: {\n    "Survival/1 vs All": 2, "Survival/Escape": 2, "Survival/": 1,\n    "Adventure/Story": 1, "Adventure/Exploration": 1,\n  },\n  force_include: [],\n  force_exclude: [],\n};\n\n// \u2500\u2500\u2500 Emergentes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nexport const EMERGING = {\n  max_visits: 30_000_000,\n  min_players: 300,\n  max_age_days: 120,\n  min_score: 45,\n  max_results: 24,\n  // Listas oficiales de Roblox que cuentan como se\xF1al de "est\xE1 despegando"\n  roblox_sorts: ["up-and-coming", "top-trending"],\n};\n\n// \u2500\u2500\u2500 Eventos / picos \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nexport const EVENTS = {\n  window_days: 7,\n  mad_k: 3.5,\n  min_ratio: 1.6,\n  spike_now_ratio: 1.8,      // \xABPico ahora\xBB: la muestra de ahora frente a la mediana de los m\xE1ximos de 7 d\xEDas\n  spike_weekday_ratio: 1.5,  // y frente al m\xE1ximo del mismo d\xEDa de la semana de hace 1-3 semanas\n};\n\n// \u2500\u2500\u2500 Telegram \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nexport const TELEGRAM = {\n  report_hour_utc: 18,     // el resumen diario sale en el primer muestreo desde esta hora\n  alert_min_score: 70,     // emergentes con esta puntuaci\xF3n generan alerta (una vez por juego)\n  max_alerts_per_run: 5,\n  list_size: 5,\n  title_chars: 30,\n  dashboard_url: "https://robloxtracker.stonksstudio.com/",\n};\n';

// src/metrics.js with { type: 'text' }
var metrics_default = "/**\n * metrics.js \u2014 M\xE9tricas del dashboard (port de analytics.py + export_dashboard.py).\n *\n * M\xF3dulo ES sin dependencias: lo usan igual el navegador (que lo descarga de\n * /metrics.js) y el Worker (Telegram, con ~150 juegos y 10 ms de CPU).\n *\n *   buildDashboard(exportData, { now }) \u2192 mismo esquema que data/dashboard.json\n *                                          + `roblox_sorts` en cada juego\n *   flagEvents(values, dates)          \u2192 d\xEDas de evento (para /api/history)\n *   cleanTitle(name)                   \u2192 reexportado de horror.js\n *\n * Es un port FIEL: mismas f\xF3rmulas, umbrales (config.js), redondeos (el\n * `round` de Python redondea al par en los empates, ver pyRound) y orden de\n * las listas. Diferencias de entrada respecto a Python, que ve\xEDa toda la\n * historia:\n *   \xB7 la serie diaria trae solo EXPORT_DAILY_DAYS d\xEDas: los d\xEDas de evento del\n *     principio de la ventana no se pueden marcar igual y `event_days` cuenta\n *     como mucho esos d\xEDas (Python: \xFAltimos 30);\n *   \xB7 `peak`, `peak_date`, `days_tracked` y `first_day` vienen ya calculados\n *     de toda la historia;\n *   \xB7 las muestras son [ts_minutos_epoch, playing, visits] de las \xFAltimas\n *     EXPORT_SAMPLE_HOURS h (Python le\xEDa 8 d\xEDas; solo se usan 48 h).\n *\n * Rendimiento: una pasada por juego, arrays peque\xF1os, medianas con\n * ordenaci\xF3n por inserci\xF3n sobre b\xFAferes reutilizados y sin copias del\n * export. Medido con cloudflare/test/metrics.bench.mjs (Node 22, proceso\n * nuevo): 150 juegos \u2248 2,5 ms en caliente y \u2248 10 ms la primera llamada (c\xF3digo\n * a\xFAn sin optimizar); 1.000 juegos \u2248 8 ms en caliente, \u2248 25-40 ms en fr\xEDo.\n * La paridad con Python: cloudflare/test/metrics.parity.mjs.\n */\n\nimport { CATEGORIES, EMERGING, EVENTS, SCAN_START, SELECTION, TRACK_MIN_PLAYERS } from './config.js';\nimport { cleanTitle } from './horror.js';\n\nexport { cleanTitle };\n\nconst ACTIVE_DAYS = 2;        // sin muestras en 2 d\xEDas \u2192 fuera de las listas\nconst SPARK_DAYS = 21;        // puntos del minigr\xE1fico\nconst EVENT_DAYS_WINDOW = 30; // `event_days` = d\xEDas de evento de los \xFAltimos 30\nconst TRENDING_MAX = 12;\n\n// Se\xF1al de Roblox para los emergentes. Estar en una lista oficial es una se\xF1al\n// externa de que el juego despega, independiente de nuestras muestras:\n//   \xB7 up-and-coming (juegos nuevos que crecen): +15, lo mismo que un 75 % del\n//     peso del crecimiento propio (25) o que ser un juego de un mes (\u224815/20);\n//   \xB7 top-trending (crecimiento reciente, tambi\xE9n de juegos grandes, aunque esos\n//     ya los quita max_visits): +10.\n// No se suman entre s\xED (cuenta la mayor). Nuestros datos mandan: la lista solo\n// vale como \"est\xE1 creciendo\" para la condici\xF3n de entrada cuando a\xFAn no hay con\n// qu\xE9 medir (tendencia, 24 h y 7 d en null, p. ej. juegos reci\xE9n descubiertos);\n// si las medimos y no crecen, no entra. Tampoco salva a un juego en ca\xEDda\n// (status down/down2) ni a uno con muchas visitas o pocos jugadores. Su motivo\n// va el primero para que no lo corte el l\xEDmite de 4 motivos. La puntuaci\xF3n se\n// recorta a 100 (sin la se\xF1al el m\xE1ximo ya era 100).\n// Con las listas del 03/10/2026 (cloudflare/test/metrics.parity.mjs --sorts):\n// general pasa de 12 a 20 emergentes (8 juegos con 31-44 puntos que ya crec\xEDan).\nexport const ROBLOX_SORT_POINTS = { 'up-and-coming': 15, 'top-trending': 10 };\nconst ROBLOX_SORT_LABELS = { 'up-and-coming': 'Roblox: Up-and-Coming', 'top-trending': 'Roblox: Top Trending' };\n\nconst MIN = 60e6;             // microsegundos por minuto\nconst DAY_US = 86400e6;\nconst DAY_MS = 864e5;\n\n// \u2500\u2500\u2500 Redondeo como Python \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n/** round(x) de Python: entero m\xE1s cercano y, en el empate exacto .5, el par. */\nfunction pyRound0(x) {\n  const f = Math.floor(x), d = x - f;           // exacto para |x| < 2^52\n  if (d < 0.5) return f;\n  if (d > 0.5) return f + 1;\n  return f % 2 === 0 ? f : f + 1;\n}\n\nconst P10 = [1, 10, 100, 1000];\n/**\n * round(x, nd) de Python. Python redondea el valor binario EXACTO (por eso\n * round(2.675, 2) = 2.67) y solo hay empate si x\xB72^(nd+1) es un entero impar\n * (p. ej. 0.25, 0.75 con nd=1); entonces va al par.\n */\nfunction pyRound(x, nd) {\n  const p = P10[nd], y = x * p;\n  const f = Math.floor(y), d = y - f;\n  // Lejos de .5 el error de y\xB710^nd no cambia el resultado: camino r\xE1pido.\n  if (Math.abs(d - 0.5) > 1e-6 && Math.abs(y) < 1e9) return (d < 0.5 ? f : f + 1) / p;\n  const q = x * 2 ** (nd + 1);                  // exacto (potencia de 2)\n  if (Number.isInteger(q) && q % 2 !== 0) return (f % 2 === 0 ? f : f + 1) / p;  // empate: y es exacto\n  return Number(x.toFixed(nd));                 // toFixed usa el valor exacto\n}\n\n/** f\"{x:.0f}\" de Python. */\nconst fmt0 = x => String(pyRound0(x));\n\n// \u2500\u2500\u2500 Utilidades \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nconst clip = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));\n\nfunction pct(nw, old) {\n  if (nw == null || !old) return null;\n  return pyRound((nw - old) * 100 / old, 1);\n}\n\n// B\xFAfer reutilizado para las medianas (las listas son peque\xF1as: \u2264 28 slopes,\n// \u2264 6 vecinos, las muestras de 24 h\u2026). Ordenaci\xF3n por inserci\xF3n in situ.\nlet BUF = new Float64Array(64);\nfunction bufFor(n) {\n  if (BUF.length < n) BUF = new Float64Array(Math.max(n, BUF.length * 2));\n  return BUF;\n}\n/** Mediana de buf[0..n) (lo ordena). Igual que statistics.median. */\nfunction medianBuf(buf, n) {\n  for (let i = 1; i < n; i++) {\n    const v = buf[i];\n    let j = i - 1;\n    while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; }\n    buf[j + 1] = v;\n  }\n  const h = n >> 1;\n  return n % 2 ? buf[h] : (buf[h - 1] + buf[h]) / 2;\n}\n/** Mediana de arr[lo..hi) sin tocar arr; atajo para \u2264 3 (el caso de flagEvents). */\nfunction medianRange(arr, lo, hi) {\n  const n = hi - lo;\n  if (n === 1) return arr[lo];\n  if (n === 2) return (arr[lo] + arr[lo + 1]) / 2;\n  if (n === 3) {\n    const a = arr[lo], b = arr[lo + 1], c = arr[lo + 2];\n    return a > b ? (b > c ? b : a > c ? c : a) : (a > c ? a : b > c ? c : b);\n  }\n  const buf = bufFor(n);\n  for (let i = 0; i < n; i++) buf[i] = arr[lo + i];\n  return medianBuf(buf, n);\n}\n\n/** \"AAAA-MM-DD\" \u2192 n\xBA de d\xEDa desde epoch. */\nfunction dayNum(s) {\n  return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS;\n}\nfunction isoDate(dn) {\n  return new Date(dn * DAY_MS).toISOString().slice(0, 10);\n}\n\n/**\n * ISO de Roblox \u2192 microsegundos desde epoch (entero exacto) o null, como\n * parse_ts (datetime.fromisoformat, que trunca la fracci\xF3n a microsegundos).\n * Date.parse acepta \"\u2026THH:MMZ\" y fracciones de m\xE1s de 3 cifras (las trunca a\n * ms); los d\xEDgitos 4-6 se a\xF1aden a mano. Es mucho m\xE1s barato que una regex\n * cuando el c\xF3digo a\xFAn no est\xE1 optimizado (isolate fr\xEDo).\n */\nfunction isoUs(s) {\n  if (!s) return null;\n  const ms = Date.parse(s);\n  if (ms !== ms) return null;\n  const dot = s.indexOf('.', 19);\n  if (dot < 0) return ms * 1000;\n  let us = 0, i = dot + 1;\n  while (i < dot + 4 && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) i++;\n  if (i < dot + 4) return ms * 1000;            // \u2264 3 cifras: ya est\xE1n en ms\n  for (let k = 0; k < 3; k++, i++) {\n    const c = s.charCodeAt(i) - 48;\n    if (!(c >= 0 && c <= 9)) { for (; k < 3; k++) us *= 10; break; }\n    us = us * 10 + c;\n  }\n  return ms * 1000 + us;\n}\n\nfunction toUs(now) {\n  if (now == null) return Date.now() * 1000;\n  if (now instanceof Date) return now.getTime() * 1000;\n  if (typeof now === 'number') return now * 1000;          // ms, como Date.now()\n  const us = isoUs(String(now));\n  if (us == null) throw new Error('now inv\xE1lido: ' + now);\n  return us;\n}\n\n// datetime.isoformat() de Python para un instante UTC\nconst pyIso = ms => new Date(ms).toISOString().slice(0, 19) + '+00:00';\n\n// \u2500\u2500\u2500 Series y eventos \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n/**\n * Marca d\xEDas de evento (picos que se salen de su entorno y luego bajan).\n * Compara con los d\xEDas de antes Y de despu\xE9s, descuenta el d\xEDa de la semana\n * (mismo d\xEDa de hace 7 y 14 d\xEDas) y nunca marca el \xFAltimo d\xEDa.\n * `values`: medianas diarias; `dates`: \"AAAA-MM-DD\" ascendente.\n */\nexport function flagEvents(values, dates) {\n  return flagCore(values, dates.map(dayNum));\n}\n\n/**\n * `dn`: n\xBA de d\xEDa de cada valor. Los vecinos son los 3 de cada lado que est\xE9n\n * a 7 d\xEDas o menos: con huecos, un juego no se compara con d\xEDas de hace meses.\n */\nfunction flagCore(values, dn) {\n  const n = values.length, w = Math.floor(EVENTS.window_days / 2), gap = EVENTS.window_days;\n  const minRatio = EVENTS.min_ratio, madK = EVENTS.mad_k;\n  const flags = new Array(n).fill(false);\n  const b = bufFor(2 * w + 2);\n  for (let i = 0; i < n; i++) {\n    let lo = Math.max(0, i - w), hi = Math.min(n, i + 1 + w);\n    while (lo < i && dn[i] - dn[lo] > gap) lo++;\n    while (hi > i + 1 && dn[hi - 1] - dn[i] > gap) hi--;\n    const nb = i - lo, na = hi - i - 1;\n    if (nb < 2 || na === 0) continue;\n    const base = Math.max(medianRange(values, lo, i), medianRange(values, i + 1, hi));\n    const v = values[i];\n    if (!(v > base * minRatio)) continue;          // corta antes de calcular la MAD\n    let k = 0;\n    for (let j = lo; j < hi; j++) if (j !== i) b[k++] = values[j];\n    const m = medianBuf(b, k);\n    for (let j = 0; j < k; j++) b[j] = Math.abs(b[j] - m);\n    const mad = Math.max(medianBuf(b, k) * 1.4826, m * 0.05);\n    if (!((v - base) > madK * mad)) continue;\n    // \xBFSe explica por el d\xEDa de la semana?\n    let maxSame = null;\n    for (const back of [7, 14]) {\n      const target = dn[i] - back;\n      for (let j = i - 1; j >= 0 && dn[j] >= target; j--) {\n        if (dn[j] === target) {\n          const x = values[j];\n          if (x && (maxSame === null || x > maxSame)) maxSame = x;\n          break;\n        }\n      }\n    }\n    flags[i] = !(maxSame !== null && v < maxSame * minRatio);\n  }\n  return flags;\n}\n\nconst TX = new Float64Array(8), TY = new Float64Array(8), LAST8 = new Float64Array(8), LAST8X = new Float64Array(8);\nconst MAX7 = new Float64Array(8), SAME = new Float64Array(4);\n\n/** Crecimiento diario t\xEDpico (%) por Theil\u2013Sen sobre vals[0..k) en los d\xEDas xs[0..k) (k \u2264 8). */\nfunction theilSen(vals, xs, k) {\n  let n = 0;\n  for (let i = 0; i < k; i++) {\n    const v = vals[i];\n    if (v && v > 0) { TX[n] = xs[i]; TY[n] = Math.log(v); n++; }\n  }\n  if (n < 4) return null;\n  const b = bufFor(n * (n - 1) / 2);\n  let m = 0;\n  for (let a = 0; a < n; a++) for (let c = a + 1; c < n; c++) b[m++] = (TY[c] - TY[a]) / (TX[c] - TX[a]);\n  return pyRound((Math.exp(medianBuf(b, m)) - 1) * 100, 1);\n}\n\n// \u2500\u2500\u2500 M\xE9tricas por juego \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// `g` es un juego del export. Las ventanas van por FECHA, contadas hacia atr\xE1s\n// desde ayer (el \xFAltimo d\xEDa cerrado): el d\xEDa de hoy est\xE1 a medias y solo cuenta\n// para \xABahora\xBB y las 24 h (por las muestras).\nfunction gameMetrics(g, ctx) {\n  const d = g.d || [], s = g.s || [];\n  const n = d.length;\n  const values = new Array(n), dn = new Array(n);\n  for (let i = 0; i < n; i++) { values[i] = d[i][1]; dn[i] = dayNum(d[i][0]); }\n  const events = flagCore(values, dn);\n  let nc = n;                                       // filas de d\xEDas cerrados: [0, nc)\n  while (nc > 0 && dn[nc - 1] >= ctx.today) nc--;\n  const D = ctx.today - 1;                          // ayer: el \xFAltimo d\xEDa cerrado\n\n  // Muestras (ascendentes seg\xFAn el contrato)\n  const ns = s.length;\n  const lastTs = ns ? s[ns - 1][0] : null;           // minutos\n  const nowPlayers = ns ? s[ns - 1][1] : (n ? values[n - 1] : 0);\n  const ref = lastTs ?? ctx.nowMin;\n\n  // Jugadores t\xEDpicos: mediana de las \xFAltimas 24 h; y las 24 h anteriores\n  const b = bufFor(ns);\n  let n24 = 0;\n  for (let i = 0; i < ns; i++) { const t = s[i][0]; if (t >= ref - 1440 && t < ref + 1) b[n24++] = s[i][1]; }\n  let typical = n24 ? medianBuf(b, n24) : null;\n  // Sin muestras: el \xFAltimo d\xEDa cerrado (o el de hoy si no hay otro)\n  const tIdx = nc ? nc - 1 : n - 1;\n  if (n24 < 2) typical = n ? values[tIdx] : nowPlayers;\n  let nprev = 0;\n  for (let i = 0; i < ns; i++) { const t = s[i][0]; if (t >= ref - 2880 && t < ref - 1440) b[nprev++] = s[i][1]; }\n  let prev = nprev ? medianBuf(b, nprev) : null;\n  if (nprev < 2) {\n    prev = null;\n    // sin muestras de ayer: el \xFAltimo d\xEDa \"limpio\" cerrado anterior al que da el t\xEDpico (\u2264 7 d\xEDas antes)\n    const from = n24 < 2 ? tIdx - 1 : nc - 1;\n    const anchor = n24 < 2 && tIdx >= 0 ? dn[tIdx] : D + 1;\n    for (let i = from; i >= 0 && anchor - dn[i] <= 7; i--) if (!events[i]) { prev = values[i]; break; }\n  }\n  const growth24 = pct(typical, prev);\n\n  // Una pasada hacia atr\xE1s por los d\xEDas cerrados; k = D \u2212 d\xEDa + 1 (1 = ayer):\n  //   7 d\xEDas = k 1..7, recent3 = k 1..3, week_ago = k 7..10 y k 1..8 para la\n  //   tendencia, todos sin d\xEDas de evento; los m\xE1ximos de k 1..7 y del mismo\n  //   d\xEDa de la semana de hace 1-3 semanas para el pico; d\xEDas de evento de los\n  //   \xFAltimos 30; las 2 \xFAltimas visitas (en todas las filas).\n  let sum7 = 0, c7 = 0, sum3 = 0, c3 = 0, sumW = 0, cW = 0, evDays = 0;\n  let n8 = 0, nmax = 0, nsame = 0, vz = -1, va = -1;\n  for (let i = n - 1; i >= 0; i--) {\n    if (va < 0 && d[i][5]) { if (vz < 0) vz = i; else va = i; }\n    if (i >= nc) continue;\n    const k = D - dn[i] + 1;\n    if (k > 30 && va >= 0) break;\n    if (events[i]) {\n      if (k <= EVENT_DAYS_WINDOW) evDays++;\n      continue;\n    }\n    const v = values[i];\n    if (k <= 7) { sum7 += v; c7++; MAX7[nmax++] = d[i][3] ?? v; }\n    if (k <= 3) { sum3 += v; c3++; }\n    if (k >= 7 && k <= 10) { sumW += v; cW++; }\n    if (k <= 8) { LAST8[n8] = v; LAST8X[n8] = dn[i]; n8++; }\n    const back = ctx.today - dn[i];\n    if (back % 7 === 0 && back <= 21 && nsame < 3) SAME[nsame++] = d[i][3] ?? v;\n  }\n  const avg7 = c7 ? pyRound0(sum7 / c7) : typical;\n  const growth7 = c3 && cW ? pct(sum3 / c3, sumW / cW) : null;\n  for (let a = 0, z = n8 - 1; a < z; a++, z--) {\n    let t = LAST8[a]; LAST8[a] = LAST8[z]; LAST8[z] = t;\n    t = LAST8X[a]; LAST8X[a] = LAST8X[z]; LAST8X[z] = t;\n  }\n  const trend = theilSen(LAST8, LAST8X, n8);\n\n  // Pico ahora: la \xFAltima muestra frente a los M\xC1XIMOS diarios (con muestras\n  // cada hora la mediana del d\xEDa queda por debajo del pico de la tarde) de los\n  // 7 d\xEDas limpios anteriores y, si los hay, del mismo d\xEDa de la semana de\n  // hace 1-3 semanas.\n  const baseMax = nmax >= 4 ? medianBuf(MAX7, nmax) : null;\n  const sameMax = nsame ? medianBuf(SAME, nsame) : null;\n  const spikeNow = !!(baseMax && nowPlayers >= baseMax * EVENTS.spike_now_ratio\n    && (sameMax === null || nowPlayers >= sameMax * EVENTS.spike_weekday_ratio));\n\n  // Visitas: actuales y ganadas en el \xFAltimo d\xEDa\n  const visits = vz >= 0 ? d[vz][5] : null;\n  let visitsDay = null;\n  let i1 = ns - 1;\n  while (i1 >= 0 && !s[i1][2]) i1--;\n  if (i1 >= 0) {\n    const t1 = s[i1][0], v1 = s[i1][2];\n    for (let i = i1 - 1; i >= 0; i--) {\n      if (s[i][2] && s[i][0] <= t1 - 1200) {      // 20 h antes como m\xEDnimo\n        visitsDay = pyRound0((v1 - s[i][2]) * 86400 / Math.max((t1 - s[i][0]) * 60, 1));\n        break;\n      }\n    }\n  }\n  if (visitsDay === null && va >= 0) {\n    const gap = (dn[vz] - dn[va]) || 1;\n    visitsDay = pyRound0((d[vz][5] - d[va][5]) / gap);\n  }\n  if (visitsDay !== null && visitsDay < 0) visitsDay = null;\n\n  const fav = g.favorites || null;\n  const up = g.up ?? null, down = g.down ?? null;\n  const likeRatio = up !== null && down !== null && up + down > 0 ? pyRound(up * 100 / (up + down), 1) : null;\n\n  const created = isoUs(g.created), updated = isoUs(g.updated), firstSeen = isoUs(g.first_seen);\n  let seen = g.first_day ? dayNum(g.first_day) : (n ? dn[0] : null);\n  if (firstSeen !== null) {\n    const fs = Math.floor(firstSeen / DAY_US);\n    if (seen === null || fs < seen) seen = fs;\n  }\n  const firstSeenDays = seen !== null ? ctx.today - seen : null;\n  // Antes de SCAN_START + 2 d\xEDas todo el cat\xE1logo es \"nuevo\"\n  const trusted = seen !== null && seen >= ctx.scanStart + 2;\n\n  const last = n ? d[n - 1] : null;\n  return {\n    players: nowPlayers,\n    _lastTs: lastTs,                    // players_ts se formatea en summary()\n    typical: typical != null ? pyRound0(typical) : null,\n    avg_7d: avg7,\n    growth_24h: growth24,\n    growth_7d: growth7,\n    trend,\n    spike_now: spikeNow,\n    event_days: evDays,\n    peak: g.peak ?? nowPlayers,\n    peak_date: g.peak_date ?? null,\n    visits,\n    visits_day: visitsDay,\n    visits_growth: visits && visitsDay ? pyRound(visitsDay * 100 / visits, 2) : null,\n    favorites: fav,\n    like_ratio: likeRatio,\n    votes: up !== null ? (up || 0) + (down || 0) : null,\n    age_days: created !== null ? Math.floor((ctx.nowUs - created) / DAY_US) : null,\n    updated_days: updated !== null ? pyRound((ctx.nowUs - updated) / 1e6 / 86400, 1) : null,\n    first_seen_days: firstSeenDays,\n    fresh: !!(trusted && firstSeenDays <= 3),\n    new_week: !!(trusted && firstSeenDays <= 7),\n    days_tracked: g.days_tracked ?? n,\n    samples_today: last && last[0] === ctx.todayIso ? last[4] : 0,\n    status: null,\n    momentum: 0,\n    _events: events,\n    _values: values,\n  };\n}\n\n// \u2500\u2500\u2500 Estado y puntuaciones \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n/** analytics.status: si 24 h y tendencia se contradicen, manda la tendencia. */\nfunction status(m) {\n  const t = m.trend;\n  let g = m.growth_24h;\n  if (g === null && t === null) return 'new';\n  g = g || 0;\n  if ((t !== null && t >= 15) || (g >= 30 && (t === null || t >= 0))) return 'hot';\n  if ((t !== null && t >= 5) || (g >= 10 && (t === null || t >= -1))) return 'up';\n  if ((t !== null && t <= -8) || (g <= -20 && (t === null || t <= 0))) return 'down2';\n  if ((t !== null && t <= -3) || (g <= -7 && (t === null || t <= 1))) return 'down';\n  return 'flat';\n}\n\nconst LOG_SIZE = Math.log10(1_000_000 / 300);\n/** analytics.momentum_score: 0-100, crecimiento sostenido ponderado por tama\xF1o. */\nfunction momentumScore(m) {\n  const t = m.trend || 0, g24 = m.growth_24h || 0, g7 = m.growth_7d || 0;\n  const size = clip(Math.log10(Math.max(m.typical || 1, 1) / 300) / LOG_SIZE);\n  let s = 35 * clip(t / 20) + 25 * clip(g24 / 50) + 20 * clip(g7 / 100) + 20 * size;\n  if (m.spike_now && t < 5) s *= 0.7;   // sube solo por un evento: cuenta menos\n  return pyRound0(s);\n}\n\nconst LOG30 = Math.log10(30);\n/** analytics.emerging + la se\xF1al de las listas de Roblox. \u2192 [score, motivos] o null. */\nfunction emerging(m, sorts) {\n  return emergingCore(m, sorts, true);\n}\n\n/**\n * strict = true: la regla de emergentes (lo que sale en la web y en Telegram).\n * strict = false: puntuaci\xF3n de CANDIDATO para elegir qu\xE9 juegos se siguen\n * (radar): la misma f\xF3rmula, pero sin corte por puntuaci\xF3n, con visitas a\xFAn\n * desconocidas (juego reci\xE9n descubierto) y, si no crece o est\xE1 bajando, a mitad.\n */\nfunction emergingCore(m, sorts, strict) {\n  const cfg = EMERGING;\n  const visits = m.visits, typical = m.typical || 0;\n  if (typical < cfg.min_players || (visits !== null && visits > cfg.max_visits)) return null;\n  if (visits === null && strict) return null;\n  const t = m.trend, g24 = m.growth_24h, g7 = m.growth_7d;\n  // Listas oficiales de Roblox (ver ROBLOX_SORT_POINTS)\n  let sRoblox = 0;\n  const rReasons = [];\n  if (sorts) {\n    for (const k of cfg.roblox_sorts || []) {\n      if (sorts[k] != null) {\n        sRoblox = Math.max(sRoblox, ROBLOX_SORT_POINTS[k] ?? 10);\n        rReasons.push(ROBLOX_SORT_LABELS[k] || 'Roblox: ' + k);\n      }\n    }\n  }\n  const growing = (t !== null && t > 0) || (g24 !== null && g24 > 0) || (g7 !== null && g7 > 0)\n    || (sRoblox > 0 && t === null && g24 === null && g7 === null);\n  const fresh = m.fresh;\n  const weak = (!growing && !fresh) || m.status === 'down' || m.status === 'down2';\n  if (weak && strict) return null;\n\n  const reasons = rReasons;\n  const vg = m.visits_growth || 0;\n  const sVisits = 30 * clip(vg / 12);\n  if (vg >= 3) reasons.push(`visitas +${fmt0(vg)}%/d\xEDa`);\n\n  const growth = Math.max(t || 0, (g24 || 0) / 2, (g7 || 0) / 5);\n  const sGrowth = 25 * clip(growth / 20);\n  if (t && t >= 5) reasons.push(`tendencia +${fmt0(t)}%/d\xEDa`);\n  else if (g24 && g24 >= 15) reasons.push(`+${fmt0(g24)}% en 24h`);\n\n  const age = m.age_days;\n  let sYoung = age !== null ? 20 * clip(1 - age / cfg.max_age_days) : 0;\n  if (age !== null && age <= 30) reasons.push(`creado hace ${age} d\xEDas`);\n  if (fresh) {\n    sYoung = Math.max(sYoung, 8);\n    reasons.push('reci\xE9n detectado');\n  }\n\n  const sSize = 15 * clip(Math.log10(typical / cfg.min_players) / LOG30);\n  const lr = m.like_ratio;\n  const sLike = 10 * clip(((lr || 0) - 75) / 20);\n  if (lr && lr >= 90) reasons.push(`${fmt0(lr)}% likes`);\n  if (visits !== null && visits < 2_000_000) reasons.push('menos de 2M visitas');\n\n  // sRoblox va al final: con 0 la suma es la misma que en Python. Sin \xE9l el\n  // m\xE1ximo ya es 100; con \xE9l se recorta a 100 para que siga siendo 0-100.\n  let score = Math.min(100, pyRound0(sVisits + sGrowth + sYoung + sSize + sLike + sRoblox));\n  if (m.spike_now && (t || 0) < 5) score = pyRound0(score * 0.8);\n  if (!strict) return [weak ? score / 2 : score, reasons];\n  if (score < cfg.min_score) return null;\n  return [score, reasons.slice(0, 4)];\n}\n\n/**\n * Radar: m\xE9tricas m\xEDnimas de un juego para elegir los que se siguen.\n * `g` como un juego del export (sin muestras basta: d con la serie diaria).\n * \u2192 [typical, candidato (0-100) | null], o null si lleva 2 d\xEDas sin datos.\n */\nexport function radarScore(g, { now } = {}) {\n  const ctx = radarCtx(now);\n  const d = g.d;\n  if (!d || !d.length || d[d.length - 1][0] < ctx.activeCut) return null;\n  const m = gameMetrics(g, ctx);\n  m.status = status(m);\n  const c = emergingCore(m, g.sorts, false);\n  return [m.typical || 0, c ? c[0] : null];\n}\n\nlet RADAR_CTX = null;\nfunction radarCtx(now) {\n  const nowUs = toUs(now);\n  if (RADAR_CTX && RADAR_CTX.nowUs === nowUs) return RADAR_CTX;\n  const today = Math.floor(nowUs / DAY_US);\n  RADAR_CTX = {\n    nowUs, nowMin: nowUs / MIN, today, todayIso: isoDate(today), scanStart: dayNum(SCAN_START),\n    activeCut: isoDate(Math.floor((nowUs - ACTIVE_DAYS * DAY_US) / DAY_US)),\n  };\n  return RADAR_CTX;\n}\n\n/**\n * Las cifras de cada juego que necesita el prefiltro de Telegram (telegram.js\n * quickRows), calculadas con las MISMAS funciones que buildDashboard: as\xED los\n * candidatos y el dashboard no pueden separarse. \u2192 [{ g, m, em }] (activos).\n */\nexport function quickMetrics(games, { now } = {}) {\n  const ctx = radarCtx(now);\n  const out = [];\n  for (const g of games || []) {\n    const d = g.d;\n    if (!d || !d.length || d[d.length - 1][0] < ctx.activeCut) continue;\n    const m = gameMetrics(g, ctx);\n    m.status = status(m);\n    m.momentum = momentumScore(m);\n    out.push({ g, m, em: emerging(m, g.sorts) });\n  }\n  return out;\n}\n\n/** \xABEn tendencia\xBB: subiendo de forma sostenida, sin ser solo un pico. */\nexport const isRising = m => (m.status === 'hot' || m.status === 'up') && (m.trend === null || m.trend > 0)\n  && !(m.spike_now && (m.trend || 0) < 5);\n\n// \u2500\u2500\u2500 Dashboard \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n/**\n * Port de export_dashboard.build() sobre el export de Cloudflare.\n * `now`: Date, ms desde epoch o ISO (por defecto, ahora).\n */\nexport function buildDashboard(exportData, { now } = {}) {\n  const nowUs = toUs(now);\n  const nowMs = Math.floor(nowUs / 1000);\n  const today = Math.floor(nowUs / DAY_US);\n  const ctx = {\n    nowUs, nowMin: nowUs / MIN, today, todayIso: isoDate(today),\n    scanStart: dayNum(SCAN_START),\n  };\n  const activeCut = isoDate(Math.floor((nowUs - ACTIVE_DAYS * DAY_US) / DAY_US));\n\n  const list = [];          // [{ g, m, horror, em, firstDay }]\n  for (const g of exportData.games || []) {\n    const d = g.d;\n    if (!d || !d.length || d[d.length - 1][0] < activeCut) continue;\n    const m = gameMetrics(g, ctx);\n    m.status = status(m);\n    m.momentum = momentumScore(m);\n    const em = emerging(m, g.sorts);\n    list.push({ g, m, horror: !!g.horror, em, firstDay: g.first_day || d[0][0] });\n  }\n\n  // Python recorre los juegos por orden de aparici\xF3n en el CSV diario: primera\n  // fecha y luego id. Como sus sort son estables, ese orden decide los empates.\n  const byOrder = (a, b) => (a.firstDay < b.firstDay ? -1 : a.firstDay > b.firstDay ? 1 : a.g.id - b.g.id);\n\n  const categories = {};\n  const used = new Set();\n  for (const [key, cfg] of Object.entries(CATEGORIES)) {\n    const belongs = x => cfg.classifier === 'all' || x.horror;\n    const ids = list.filter(x => belongs(x) && (x.m.typical || 0) >= cfg.min_players);\n    ids.sort((a, b) => ((b.m.typical || 0) - (a.m.typical || 0)) || byOrder(a, b));\n    const emerg = list.filter(x => belongs(x) && x.em);\n    emerg.sort((a, b) => (b.em[0] - a.em[0]) || byOrder(a, b));\n    emerg.length = Math.min(emerg.length, EMERGING.max_results);\n    const rising = ({ m }) => isRising(m);\n    const trending = ids.filter(rising).sort((a, b) => b.m.momentum - a.m.momentum).slice(0, TRENDING_MAX);\n    let players = 0, up = 0, down = 0, events = 0, new7 = 0;\n    for (const { m } of ids) {\n      players += m.typical || 0;\n      if (m.status === 'hot' || m.status === 'up') up++;\n      if (m.status === 'down' || m.status === 'down2') down++;\n      if (m.spike_now) events++;\n      if (m.new_week) new7++;\n    }\n    categories[key] = {\n      label: cfg.label,\n      icon: cfg.icon ?? '\u{1F3AE}',\n      min_players: cfg.min_players,\n      ids: ids.map(x => x.g.id),\n      top: ids.slice(0, SELECTION.top).map(x => x.g.id),\n      emerging: emerg.map(x => x.g.id),\n      trending: trending.map(x => x.g.id),\n      stats: { games: ids.length, players, rising: up, falling: down, events, new_7d: new7 },\n    };\n    for (const x of ids) used.add(x);\n    for (const x of emerg) used.add(x);\n  }\n\n  // Solo se resumen los juegos que salen en alguna lista (como Python)\n  const games = {};\n  for (const x of [...used].sort((a, b) => a.g.id - b.g.id)) games[String(x.g.id)] = summary(x);\n\n  return {\n    updated_at: pyIso(nowMs),\n    last_sample: exportData.last_sample ?? null,\n    samples_24h: exportData.samples_24h ?? 0,\n    track_min_players: TRACK_MIN_PLAYERS,\n    emerging_max_visits: EMERGING.max_visits,\n    categories,\n    games,\n  };\n}\n\nfunction summary({ g, m, em }) {\n  const [title, tags] = cleanTitle(g.name || '');\n  const events = m._events, values = m._values, n = values.length;\n  const from = Math.max(0, n - SPARK_DAYS);\n  const spark = values.slice(from), sparkEv = [];\n  for (let i = from; i < n; i++) if (events[i]) sparkEv.push(i - from);\n  return {\n    id: g.id,\n    place_id: g.place_id ?? null,\n    name: g.name ?? null,\n    title,\n    tags,\n    creator: g.creator ?? null,\n    creator_verified: g.creator_verified ?? null,\n    genre: g.genre_l1 ?? null,\n    subgenre: g.genre_l2 ?? null,\n    max_players: g.max_players ?? null,\n    created: g.created ?? null,\n    updated: g.updated ?? null,\n    horror: !!g.horror,\n    horror_score: g.horror_score ?? 0,\n    horror_reasons: g.horror_reasons ?? [],\n    emerging: em ? em[0] : null,\n    emerging_reasons: em ? em[1] : [],\n    spark,\n    spark_ev: sparkEv,\n    players: m.players,\n    players_ts: m._lastTs !== null ? pyIso(m._lastTs * 60000) : null,\n    typical: m.typical,\n    avg_7d: m.avg_7d,\n    growth_24h: m.growth_24h,\n    growth_7d: m.growth_7d,\n    trend: m.trend,\n    spike_now: m.spike_now,\n    event_days: m.event_days,\n    peak: m.peak,\n    peak_date: m.peak_date,\n    visits: m.visits,\n    visits_day: m.visits_day,\n    visits_growth: m.visits_growth,\n    favorites: m.favorites,\n    like_ratio: m.like_ratio,\n    votes: m.votes,\n    age_days: m.age_days,\n    updated_days: m.updated_days,\n    first_seen_days: m.first_seen_days,\n    fresh: m.fresh,\n    new_week: m.new_week,\n    days_tracked: m.days_tracked,\n    samples_today: m.samples_today,\n    status: m.status,\n    momentum: m.momentum,\n    roblox_sorts: g.sorts || {},\n  };\n}\n";

// src/horror.js with { type: 'text' }
var horror_default = '/**\n * horror.js \u2014 Clasificaci\xF3n de horror y limpieza de t\xEDtulos.\n *\n * Port fiel de analytics.py (`clean_title`, `_kw_regex`, `horror_score`,\n * `is_horror`, `_has_strong`). M\xF3dulo ES sin dependencias salvo config.js:\n * lo usan el Workflow (meta diario, con la descripci\xF3n) y el navegador.\n *\n * Diferencias de Python `re` / `str` que se cuidan aqu\xED:\n *  \xB7 Las regex con caracteres fuera del BMP llevan flag `u`, y las longitudes\n *    (`{1,30}`, `len(t) <= 12`, `len(title)`) se cuentan en code points.\n *  \xB7 `\\s` y `str.strip()` de Python no son los de JS (Python incluye\n *    \\x1c-\\x1f y \\x85; JS incluye \uFEFF): se usa la clase exacta de Python.\n *  \xB7 `str.strip(chars)` se reimplementa (JS no tiene equivalente).\n *\n * Rendimiento: cada palabra clave se busca primero con `includes` (b\xFAsqueda\n * nativa muy r\xE1pida) y solo si aparece se aplica la regex con el\n * lookbehind `(?<![a-z0-9])`. El resultado es id\xE9ntico: si la palabra no es\n * subcadena, la regex no puede coincidir.\n */\n\nimport { HORROR } from "./config.js";\n\n// \u2500\u2500\u2500 T\xEDtulos \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// Mismos rangos que EMOJI_RE de analytics.py\nconst EMOJI_SRC =\n  "[\\\\u{1F000}-\\\\u{1FAFF}\\\\u{2600}-\\\\u{27BF}\\\\u{1F1E6}-\\\\u{1F1FF}" +\n  "\\\\u{2190}-\\\\u{21FF}\\\\u{2B00}-\\\\u{2BFF}\\\\u{3000}-\\\\u{303F}" +\n  "\\\\u{FE0F}\\\\u{200D}\\\\u{20E3}\\\\u{2300}-\\\\u{23FF}]";\nconst EMOJI_RE_G = new RegExp(EMOJI_SRC, "gu");\nconst TAG_RE_G = /[\\[\\(\u3010]([^\\]\\)\u3011]{1,30})[\\]\\)\u3011]/gu;\n// Espacios de Python (str.isspace / `\\s` de re con patrones str)\nconst PY_WS = "\\\\t\\\\n\\\\v\\\\f\\\\r\\\\x1c-\\\\x20\\\\x85\\\\xa0\\\\u1680\\\\u2000-\\\\u200a\\\\u2028\\\\u2029\\\\u202f\\\\u205f\\\\u3000";\nconst PY_WS_RUN_G = new RegExp(`[${PY_WS}]+`, "g");\nconst PY_WS_SET = new Set(\n  [9, 10, 11, 12, 13, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680,\n    0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,\n    0x2028, 0x2029, 0x202f, 0x205f, 0x3000].map(c => String.fromCharCode(c)),\n);\n\n/** `str.strip(chars)` de Python; sin `chars`, quita los espacios de Python. */\nconst STRIP_SETS = new Map();\nexport function pyStrip(s, chars) {\n  let set = PY_WS_SET;\n  if (chars !== undefined) {\n    set = STRIP_SETS.get(chars);\n    if (!set) STRIP_SETS.set(chars, (set = new Set(chars)));\n  }\n  let a = 0, b = s.length;\n  // Todos los caracteres a quitar est\xE1n en el BMP: basta comparar unidades UTF-16\n  while (a < b && set.has(s[a])) a++;\n  while (b > a && set.has(s[b - 1])) b--;\n  return s.slice(a, b);\n}\n\n/** `str.rstrip()` de Python (espacios). */\nexport function pyRstrip(s) {\n  let b = s.length;\n  while (b > 0 && PY_WS_SET.has(s[b - 1])) b--;\n  return s.slice(0, b);\n}\n\n/** Longitud en code points (= `len()` de Python). */\nexport function pyLen(s) {\n  let n = 0;\n  for (let i = 0; i < s.length; i++) {\n    const c = s.charCodeAt(i);\n    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {\n      const d = s.charCodeAt(i + 1);\n      if (d >= 0xdc00 && d <= 0xdfff) i++;\n    }\n    n++;\n  }\n  return n;\n}\n\n/** \'[\u2699\uFE0FUPD 6] Anime Dice \u{1F3B2}\' \u2192 [\'Anime Dice\', [\'UPD 6\']]. */\n// Sin \'[\', \'(\' ni caracteres no ASCII no puede haber etiquetas ni emojis\nconst NEEDS_FULL_TITLE = /[\\[\\(\\u0080-\\uffff]/;\n\nexport function cleanTitle(name) {\n  name = name || "";\n  if (!NEEDS_FULL_TITLE.test(name)) {\n    const title = pyStrip(name.replace(PY_WS_RUN_G, " "), " -|:\xB7\u2022!");\n    return [title || pyStrip(name) || name, []];\n  }\n  const tags = [];\n  for (const m of name.matchAll(TAG_RE_G)) {\n    const t = pyStrip(m[1].replace(EMOJI_RE_G, ""), " -|:!");\n    if (t) tags.push(pyLen(t) <= 12 ? t.toUpperCase() : t);\n  }\n  let title = name.replace(TAG_RE_G, " ");\n  title = title.replace(EMOJI_RE_G, " ");\n  title = pyStrip(title.replace(PY_WS_RUN_G, " "), " -|:\xB7\u2022!");\n  if (!title) title = pyStrip(name.replace(EMOJI_RE_G, "")) || name;\n  return [title, tags.slice(0, 3)];\n}\n\n// \u2500\u2500\u2500 Clasificaci\xF3n de horror \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\nfunction escapeRe(w) {\n  return w.replace(/[.*+?^${}()|[\\]\\\\\\/-]/g, "\\\\$&");\n}\n\n/** Igual que `_kw_regex`: inicio de palabra obligatorio, el final puede seguir. */\nfunction kwList(words) {\n  return words.map(w => ({ w, rx: new RegExp("(?<![a-z0-9])" + escapeRe(w)) }));\n}\n\n// Las ~100 regex de referencia se compilan solo si se usan (en fr\xEDo cada\n// milisegundo de arranque cuenta)\nlet H_CACHE = null;\nconst refLists = () => {\n  if (!H_CACHE) {\n    H_CACHE = {};\n    for (const k of ["name_strong", "name_weak", "name_negative", "desc_strong", "desc_weak"]) H_CACHE[k] = kwList(HORROR[k]);\n  }\n  return H_CACHE;\n};\nconst TAGS = HORROR.tags;\nconst FORCE_IN = new Set(HORROR.force_include.map(Number));\nconst FORCE_OUT = new Set(HORROR.force_exclude.map(Number));\nconst own = (obj, k) => k != null && Object.prototype.hasOwnProperty.call(obj, k);\n\n// Referencia: lo mismo que analytics.py, palabra a palabra con su regex.\n// Se usa si alguna palabra clave no es ASCII (el esc\xE1ner r\xE1pido no vale) y en\n// las pruebas de paridad.\nconst refMatcher = {\n  first(key, text) {\n    for (const kw of refLists()[key]) if (text.includes(kw.w) && kw.rx.test(text)) return kw.w;\n    return null;\n  },\n  all(key, text) {\n    const out = [];\n    for (const kw of refLists()[key]) if (text.includes(kw.w) && kw.rx.test(text)) out.push(kw.w);\n    return out;\n  },\n};\n\n// \u2500\u2500\u2500 B\xFAsqueda r\xE1pida (resultado id\xE9ntico a las regex de una en una) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n// En vez de probar cada palabra con su regex, una sola regex con todas las\n// palabras de varias listas (en forma de \xE1rbol de prefijos) encuentra cada\n// posici\xF3n del texto en min\xFAsculas donde empieza alguna, y en esa posici\xF3n se\n// comprueba con `startsWith` qu\xE9 palabras de las que empiezan por esa letra\n// est\xE1n ah\xED. Tras cada coincidencia se sigue desde la posici\xF3n siguiente, as\xED\n// que no se pierden palabras solapadas ("being hunted" / "hunted by").\n// Es exacto: si una palabra coincide en p, la alternativa de la regex tambi\xE9n\n// coincide en p (la alternancia prueba todas las ramas).\n\nfunction trieSource(words) {\n  const root = {};\n  for (const w of words) {\n    let n = root;\n    for (const ch of w) n = n[ch] ||= {};\n    n[""] = true;\n  }\n  const emit = n => {\n    const keys = Object.keys(n).filter(k => k !== "");\n    if (!keys.length) return "";\n    const alts = keys.map(k => escapeRe(k) + emit(n[k]));\n    const body = alts.length === 1 ? alts[0] : `(?:${alts.join("|")})`;\n    return n[""] ? `(?:${body})?` : body;\n  };\n  return emit(root);\n}\n\nfunction makeScanner(keys) {\n  const lists = keys.map(k => HORROR[k]);\n  const words = [], offsets = [];\n  for (const list of lists) {\n    offsets.push(words.length);\n    words.push(...list);\n  }\n  if (words.some(w => !w)) return null;   // una palabra vac\xEDa: solo la v\xEDa de referencia\n  const byFirst = new Map();\n  words.forEach((w, i) => {\n    const c = w.charCodeAt(0);\n    if (!byFirst.has(c)) byFirst.set(c, []);\n    byFirst.get(c).push(i);\n  });\n  const finder = new RegExp("(?<![a-z0-9])" + trieSource([...new Set(words)]), "g");\n  return { keys, lists, words, offsets, byFirst, finder, marks: new Uint8Array(words.length) };\n}\n\nfunction scan(sc, text) {\n  const { words, byFirst, finder, marks } = sc;\n  marks.fill(0);\n  finder.lastIndex = 0;\n  let m;\n  while ((m = finder.exec(text)) !== null) {\n    const p = m.index;\n    const ids = byFirst.get(text.charCodeAt(p));\n    for (let k = 0; k < ids.length; k++) {\n      const id = ids[k];\n      if (marks[id] === 0 && text.startsWith(words[id], p)) marks[id] = 1;\n    }\n    finder.lastIndex = p + 1;\n  }\n}\n\nfunction scanMatcher(sc, text) {\n  scan(sc, text);\n  const { keys, lists, offsets, marks } = sc;\n  return {\n    first(key) {\n      const li = keys.indexOf(key), o = offsets[li], list = lists[li];\n      for (let i = 0; i < list.length; i++) if (marks[o + i]) return list[i];\n      return null;\n    },\n    all(key) {\n      const li = keys.indexOf(key), o = offsets[li], list = lists[li], out = [];\n      for (let i = 0; i < list.length; i++) if (marks[o + i]) out.push(list[i]);\n      return out;\n    },\n  };\n}\n\nconst NAME_SCAN = makeScanner(["name_strong", "name_weak", "name_negative"]);\nconst DESC_SCAN = makeScanner(["desc_strong", "desc_weak"]);\n\n/** Port de `horror_score` + `is_horror` (+ `_has_strong`), en una sola pasada. */\nexport function classifyHorror(game, { reference = false } = {}) {\n  const g = game || {};\n  const uid = Number(g.universe_id ?? g.id);\n  if (FORCE_IN.has(uid)) return { horror: 99 >= HORROR.threshold, score: 99, reasons: ["incluido a mano"] };\n  if (FORCE_OUT.has(uid)) return { horror: false, score: -99, reasons: ["excluido a mano"] };\n\n  const pts = HORROR.points;\n  const [title, tags] = cleanTitle(g.name || "");\n  const fast = !reference && NAME_SCAN && DESC_SCAN;\n  const name = title.toLowerCase();\n  const nm = fast ? scanMatcher(NAME_SCAN, name) : refMatcher;\n  let score = 0;\n  const reasons = [];\n\n  const tag = tags.find(t => TAGS.includes(t.toLowerCase())) ?? null;\n  const hit = nm.first("name_strong", name);\n  if (hit || tag) {\n    score += pts.name_strong;\n    reasons.push(`nombre: ${hit || tag.toLowerCase()}`);\n  }\n  let w = nm.first("name_weak", name);\n  if (w) {\n    score += pts.name_weak;\n    reasons.push(`nombre: ${w}`);\n  }\n  w = nm.first("name_negative", name);\n  if (w) {\n    score += pts.name_negative;\n    reasons.push(`resta: ${w}`);\n  }\n\n  const legacy = own(HORROR.legacy_genres, g.genre) ? HORROR.legacy_genres[g.genre] : null;\n  if (legacy) {\n    score += legacy;\n    reasons.push(`g\xE9nero del creador: ${g.genre}`);\n  }\n  const genre = `${g.genre_l1 || ""}/${g.genre_l2 || ""}`;\n  if (own(HORROR.genres, genre)) {\n    score += HORROR.genres[genre];\n    reasons.push(`g\xE9nero: ${genre.replace(/\\/+$/, "")}`);\n  }\n\n  // La descripci\xF3n, despu\xE9s del nombre (los dos esc\xE1neres reutilizan sus marcas)\n  const desc = (g.description || "").toLowerCase();\n  const dm = fast ? scanMatcher(DESC_SCAN, desc) : refMatcher;\n  const ds = dm.all("desc_strong", desc);\n  if (ds.length) {\n    score += Math.min(ds.length * pts.desc_strong, pts.desc_strong_cap);\n    reasons.push("descripci\xF3n: " + ds.slice(0, 3).join(", "));\n  }\n  const dw = dm.all("desc_weak", desc);\n  if (dw.length) {\n    score += Math.min(dw.length * pts.desc_weak, pts.desc_weak_cap);\n    if (!ds.length) reasons.push("descripci\xF3n: " + dw.slice(0, 2).join(", "));\n  }\n\n  // _has_strong: nombre fuerte, etiqueta, descripci\xF3n fuerte o g\xE9nero antiguo\n  const strong = Boolean(hit || tag || ds.length || legacy);\n  return { horror: score >= HORROR.threshold && strong, score, reasons };\n}\n';

// src/config.js
var TRACK_MIN_PLAYERS = 300;
var UNTRACK_AFTER_DAYS = 3;
var SAMPLE_RETENTION_DAYS = 8;
var DATA_RETENTION_DAYS = 365;
var RADAR_EVERY_HOURS = 3;
var EXPORT_DAILY_DAYS = 24;
var EXPORT_SAMPLE_HOURS = 48;
var HISTORY_DAYS = 365;
var HISTORY_SAMPLE_DAYS = 2;
var SCAN_START = "2026-10-02";
var SEARCH_QUERIES = [
  "horror",
  "killer",
  "jumpscare",
  "escape monster",
  "haunted",
  "scary",
  "backrooms",
  "nightmare",
  "anomaly",
  "survive the night",
  "creepy",
  "fnaf",
  "asymmetrical",
  "monster",
  "hide and seek horror",
  "story horror"
];
var SEARCH_QUERIES_PER_RUN = 1;
var SEARCH_PAGES_PER_QUERY = 3;
var SELECTION = {
  top: 10,
  // los que más jugadores tienen, en cada pestaña
  emerging_general: 150,
  // mejores candidatos a emergente (todo Roblox)
  emerging_horror: 50,
  // mejores candidatos a emergente de horror
  keep_factor: 1.5
  // un juego ya seguido sigue mientras esté en el 150 % de su lista
};
var CATEGORIES = {
  general: { label: "General", icon: "\u{1F3AE}", min_players: 300, classifier: "all" },
  horror: { label: "Horror", icon: "\u{1F47B}", min_players: 300, classifier: "horror" }
};
var HORROR = {
  threshold: 5,
  name_strong: [
    "horror",
    "scary",
    "creepy",
    "haunted",
    "nightmare",
    "backrooms",
    "doors",
    "mimic",
    "piggy",
    "granny",
    "slender",
    "specimen",
    "asylum",
    "cursed",
    "ghost",
    "killer",
    "evade",
    "forsaken",
    "pressure",
    "apeirophobia",
    "the rake",
    "siren head",
    "jumpscare",
    "paranormal",
    "phobia",
    "exorcis",
    "possessed",
    "terror",
    "insanity",
    "anomal",
    "survive the night",
    "dead rails",
    "entity",
    "poppy",
    "rainbow friends",
    "fnaf",
    "freddy",
    "the intruder",
    "spooky",
    "dread",
    "flee the facility",
    "residence massacre",
    "nights at",
    "die of death",
    "99 nights",
    "scp",
    "nextbot",
    "slendytubbies",
    "the butchery",
    "infectious smile",
    "grace",
    "banban",
    "a quiet place",
    ".exe",
    "hello neighbor",
    "demonology"
  ],
  name_weak: [
    "escape",
    "survive",
    "survival",
    "hide",
    "run from",
    "chased",
    "night",
    "dark",
    "fog",
    "midnight",
    "shadow",
    "abandoned",
    "hospital",
    "prison",
    "basement",
    "facility",
    "lost",
    "alone",
    "hunt",
    "blood",
    "evil",
    "trapped",
    "murder",
    "monster",
    "demon",
    "zombie",
    "scream",
    "story"
  ],
  name_negative: [
    "brainrot",
    "tsunami",
    "lucky block",
    "tycoon",
    "simulator",
    "obby",
    "tower",
    "race",
    "speed",
    "anime",
    "steal a",
    "steal an",
    "lava",
    "flood",
    "admin",
    "rng",
    "clicker",
    "keyboard"
  ],
  tags: ["horror", "scary", "anomaly"],
  desc_strong: [
    "horror",
    "scary",
    "jumpscare",
    "jump scare",
    "creepy",
    "terrifying",
    "nightmare",
    "killer",
    "survive the night",
    "don't get caught",
    "dont get caught",
    "hide from",
    "being hunted",
    "hunted by",
    "chased by",
    "paranormal",
    "spooky",
    "frightening",
    "backrooms",
    "entity",
    "entities",
    "anomal",
    "sanity"
  ],
  desc_weak: [
    "monster",
    "creature",
    "demon",
    "zombie",
    "ghost",
    "haunted",
    "cursed",
    "lurk",
    "possessed",
    "escape",
    "survive",
    "dark",
    "flashlight",
    "run from",
    "chase",
    "abandoned",
    "lights out",
    "murderer"
  ],
  points: {
    name_strong: 4,
    name_weak: 1,
    name_negative: -3,
    desc_strong: 3,
    desc_strong_cap: 5,
    desc_weak: 1,
    desc_weak_cap: 2
  },
  legacy_genres: { Horror: 5 },
  genres: {
    "Survival/1 vs All": 2,
    "Survival/Escape": 2,
    "Survival/": 1,
    "Adventure/Story": 1,
    "Adventure/Exploration": 1
  },
  force_include: [],
  force_exclude: []
};
var EMERGING = {
  max_visits: 3e7,
  min_players: 300,
  max_age_days: 120,
  min_score: 45,
  max_results: 24,
  // Listas oficiales de Roblox que cuentan como señal de "está despegando"
  roblox_sorts: ["up-and-coming", "top-trending"]
};
var EVENTS = {
  window_days: 7,
  mad_k: 3.5,
  min_ratio: 1.6,
  spike_now_ratio: 1.8,
  // «Pico ahora»: la muestra de ahora frente a la mediana de los máximos de 7 días
  spike_weekday_ratio: 1.5
  // y frente al máximo del mismo día de la semana de hace 1-3 semanas
};
var TELEGRAM = {
  report_hour_utc: 18,
  // el resumen diario sale en el primer muestreo desde esta hora
  alert_min_score: 70,
  // emergentes con esta puntuación generan alerta (una vez por juego)
  max_alerts_per_run: 5,
  list_size: 5,
  title_chars: 30,
  dashboard_url: "https://robloxtracker.stonksstudio.com/"
};

// src/db.js
var DAY_MIN = 1440;
var minuteOf = /* @__PURE__ */ __name((ms) => Math.floor(ms / 6e4), "minuteOf");
var isoMinute = /* @__PURE__ */ __name((ts) => new Date(ts * 6e4).toISOString().slice(0, 16) + "Z", "isoMinute");
var isoDate = /* @__PURE__ */ __name((ts) => new Date(ts * 6e4).toISOString().slice(0, 10), "isoDate");
var dayStart = /* @__PURE__ */ __name((date) => Date.parse(`${date}T00:00:00Z`) / 6e4, "dayStart");
var addDays = /* @__PURE__ */ __name((date, n) => isoDate(dayStart(date) + n * DAY_MIN), "addDays");
var MID = "SUM(CASE WHEN rn IN ((cnt + 1) / 2, (cnt + 2) / 2) THEN p END)";
var MEDIAN_SQL = `(CASE WHEN MAX(cnt) % 2 = 1 THEN ${MID}
  ELSE ${MID} / 2 + (${MID} % 2) * ((${MID} / 2) % 2) END)`;
var MEAN_SQL = `(CASE
  WHEN 2 * (SUM(p) % COUNT(*)) > COUNT(*) THEN SUM(p) / COUNT(*) + 1
  WHEN 2 * (SUM(p) % COUNT(*)) < COUNT(*) THEN SUM(p) / COUNT(*)
  ELSE SUM(p) / COUNT(*) + (SUM(p) / COUNT(*)) % 2 END)`;
var MEAN_OF = /* @__PURE__ */ __name((sum, n) => `(CASE
  WHEN 2 * (${sum} % ${n}) > ${n} THEN ${sum} / ${n} + 1
  WHEN 2 * (${sum} % ${n}) < ${n} THEN ${sum} / ${n}
  ELSE ${sum} / ${n} + (${sum} / ${n}) % 2 END)`, "MEAN_OF");
var sortedMedian = /* @__PURE__ */ __name((a, f, n) => {
  const mid = `(CASE WHEN ${n} % 2 = 1 THEN ${a} ->> (${f} + ${n} / 2) ELSE (${a} ->> (${f} + ${n} / 2 - 1)) + (${a} ->> (${f} + ${n} / 2)) END)`;
  return `(CASE WHEN ${n} % 2 = 1 THEN ${mid} ELSE ${mid} / 2 + (${mid} % 2) * ((${mid} / 2) % 2) END)`;
}, "sortedMedian");
async function getState(db, key, fallback = null) {
  const row = await db.prepare("SELECT value FROM state WHERE key = ?1").bind(key).first();
  if (!row || row.value == null) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return row.value;
  }
}
__name(getState, "getState");
function setStateStmt(db, key, value) {
  return db.prepare(
    `INSERT INTO state (key, value) VALUES (?1, ?2)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE state.value IS NOT excluded.value`
  ).bind(key, JSON.stringify(value));
}
__name(setStateStmt, "setStateStmt");
async function setState(db, key, value) {
  return setStateStmt(db, key, value).run();
}
__name(setState, "setState");
async function getStates(db, keys) {
  const { results } = await db.prepare(
    "SELECT key, value FROM state WHERE key IN (SELECT value FROM json_each(?1))"
  ).bind(JSON.stringify(keys)).all();
  const out = {};
  for (const r of results) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out;
}
__name(getStates, "getStates");
function written(res) {
  const list = Array.isArray(res) ? res : [res];
  return list.reduce((a, r) => a + (r?.meta?.rows_written || 0), 0);
}
__name(written, "written");
function upsertDiscoveredStmt(db, rows, source, firstSeen) {
  const has = "instr(COALESCE(games.sources, '[]'), json_quote(?3)) > 0";
  return db.prepare(
    `INSERT INTO games (universe_id, place_id, name, first_seen, sources, tracked)
     SELECT j.value ->> 0, j.value ->> 1, j.value ->> 2, ?2, json_array(?3), 1
     FROM json_each(?1) j WHERE (j.value ->> 0) IS NOT NULL
     ON CONFLICT (universe_id) DO UPDATE SET
       tracked = 1,
       low_since = CASE WHEN games.tracked = 0 THEN NULL ELSE games.low_since END,
       place_id = COALESCE(games.place_id, excluded.place_id),
       name = COALESCE(games.name, excluded.name),
       sources = CASE WHEN ${has} THEN games.sources
         ELSE json_insert(COALESCE(games.sources, '[]'), '$[#]', ?3) END
     WHERE games.tracked IS NOT 1
        OR (games.place_id IS NULL AND excluded.place_id IS NOT NULL)
        OR (games.name IS NULL AND excluded.name IS NOT NULL)
        OR NOT ${has}`
  ).bind(JSON.stringify(rows), firstSeen, source);
}
__name(upsertDiscoveredStmt, "upsertDiscoveredStmt");
function sortHitsStmt(db, rows, date) {
  return db.prepare(
    `INSERT INTO sort_hits (universe_id, date, sort_id, rank)
     SELECT j.value ->> 0, ?2, j.value ->> 1, j.value ->> 2 FROM json_each(?1) j
     WHERE EXISTS (SELECT 1 FROM games g WHERE g.universe_id = (j.value ->> 0))
     ON CONFLICT (universe_id, date, sort_id) DO UPDATE SET rank = excluded.rank
     WHERE excluded.rank < sort_hits.rank`
  ).bind(JSON.stringify(rows), date);
}
__name(sortHitsStmt, "sortHitsStmt");
async function unknownPlaces(db, pids) {
  const { results } = await db.prepare(
    `SELECT j.value AS pid FROM json_each(?1) j
     WHERE NOT EXISTS (SELECT 1 FROM places p WHERE p.place_id = j.value)`
  ).bind(JSON.stringify(pids)).all();
  return results.map((r) => r.pid);
}
__name(unknownPlaces, "unknownPlaces");
function retrackPlacesStmt(db, pids) {
  return db.prepare(
    `UPDATE games SET tracked = 1, low_since = NULL,
       sources = CASE
         WHEN EXISTS (SELECT 1 FROM json_each(COALESCE(sources, '[]')) s WHERE s.value = 'rolimons') THEN sources
         ELSE json_insert(COALESCE(sources, '[]'), '$[#]', 'rolimons') END
     WHERE universe_id IN (SELECT p.universe_id FROM json_each(?1) j JOIN places p ON p.place_id = j.value)
       AND (tracked IS NOT 1
            OR NOT EXISTS (SELECT 1 FROM json_each(COALESCE(sources, '[]')) s WHERE s.value = 'rolimons'))`
  ).bind(JSON.stringify(pids));
}
__name(retrackPlacesStmt, "retrackPlacesStmt");
function insertPlacesStmt(db, rows) {
  return db.prepare(
    `INSERT INTO places (place_id, universe_id)
     SELECT j.value ->> 0, j.value ->> 1 FROM json_each(?1) j WHERE true
     ON CONFLICT (place_id) DO UPDATE SET universe_id = excluded.universe_id
     WHERE places.universe_id IS NOT excluded.universe_id`
  ).bind(JSON.stringify(rows));
}
__name(insertPlacesStmt, "insertPlacesStmt");
async function trackedIds(db, { selected = false } = {}) {
  const { results } = await db.prepare(
    `SELECT universe_id AS id FROM games WHERE tracked = 1 ${selected ? "AND sel = 1" : ""} ORDER BY universe_id`
  ).all();
  return results.map((r) => r.id);
}
__name(trackedIds, "trackedIds");
async function radarPlayers(db, list, today) {
  const { map, ids } = await radarPlaces(db, today);
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const id = map.get(list[i][0]);
    if (id != null) out[id] = Math.max(out[id] ?? 0, list[i][2]);
  }
  return { players: out, missing: ids.filter((id) => out[id] === void 0) };
}
__name(radarPlayers, "radarPlayers");
async function radarPlaces(db, today) {
  const cached = await getState(db, "radar_places");
  if (cached?.day === today && Array.isArray(cached.pairs) && Array.isArray(cached.nop)) {
    const map2 = new Map(cached.pairs);
    return { map: map2, ids: [...new Set(map2.values()), ...cached.nop] };
  }
  const { results } = await db.prepare(
    `SELECT place_id AS pid, universe_id AS id FROM games WHERE tracked = 1
     UNION ALL
     SELECT pl.place_id, pl.universe_id
     FROM places pl JOIN games g ON g.universe_id = pl.universe_id WHERE g.tracked = 1`
  ).all();
  const map = /* @__PURE__ */ new Map();
  for (const r of results) if (r.pid != null) map.set(r.pid, r.id);
  const withPlace = new Set(map.values());
  const nop = [...new Set(results.filter((r) => !withPlace.has(r.id)).map((r) => r.id))];
  await setState(db, "radar_places", { day: today, pairs: [...map], nop });
  return { map, ids: [...withPlace, ...nop] };
}
__name(radarPlaces, "radarPlaces");
var radarStaleStmt = /* @__PURE__ */ __name((db, { ifChanged = false } = {}) => db.prepare(`DELETE FROM state WHERE key IN ('radar_places', 'radar_counts')${ifChanged ? " AND changes() > 0" : ""}`), "radarStaleStmt");
var radarCountsStaleStmt = /* @__PURE__ */ __name((db) => db.prepare("DELETE FROM state WHERE key = 'radar_counts' AND changes() > 0"), "radarCountsStaleStmt");
function countTryStmt(db, day, task) {
  return db.prepare(
    `INSERT INTO state (key, value) VALUES ('daily_tries', json_object('day', ?1, ?2, 1))
     ON CONFLICT (key) DO UPDATE SET value = CASE
       WHEN json_valid(state.value) AND state.value ->> '$.day' = ?1
         THEN json_set(state.value, '$.' || ?2, COALESCE(state.value ->> ('$.' || ?2), 0) + 1)
       ELSE json_object('day', ?1, ?2, 1) END`
  ).bind(day, task);
}
__name(countTryStmt, "countTryStmt");
function pyMedian(sorted) {
  const n = sorted.length;
  if (n % 2) return sorted[(n - 1) / 2];
  const s = sorted[n / 2 - 1] + sorted[n / 2], h2 = Math.trunc(s / 2);
  return h2 + s % 2 * (h2 % 2);
}
__name(pyMedian, "pyMedian");
function pyMean(sum, n) {
  const q = Math.trunc(sum / n), r2 = 2 * (sum % n);
  return r2 > n ? q + 1 : r2 < n ? q : q + q % 2;
}
__name(pyMean, "pyMean");
var idPart = /* @__PURE__ */ __name((key, parts) => key.charCodeAt(key.length - 1) % parts, "idPart");
var RADAR_TEXT = /^\{(?:"\d+":(?:-?\d+(?:\.\d+)?|null),)*"\d+":(?:-?\d+(?:\.\d+)?|null)\}$/;
function radarPrepare(texts) {
  const out = [];
  for (const text2 of texts) {
    if (RADAR_TEXT.test(text2)) out.push(text2);
    else if (text2.trim() !== "{}") out.push(JSON.parse(text2));
  }
  out.checked = true;
  return out;
}
__name(radarPrepare, "radarPrepare");
function radarReadingsPart(texts, part = 0, parts = 1) {
  const files = texts.checked ? texts : radarPrepare(texts);
  const digits = [..."0123456789"].filter((d) => idPart(d, parts) === part).join("");
  const rx = new RegExp(`"(\\d*[${digits}])":(-?\\d+(?:\\.\\d+)?)[,}]`, "g");
  const out = /* @__PURE__ */ new Map();
  const add = /* @__PURE__ */ __name((k, v) => {
    const a = out.get(k);
    if (a) a.push(v);
    else out.set(k, [v]);
  }, "add");
  for (const f of files) {
    if (typeof f !== "string") {
      for (const k in f) if (f[k] != null && idPart(k, parts) === part) add(k, f[k]);
      continue;
    }
    rx.lastIndex = 0;
    for (let m; m = rx.exec(f); ) add(m[1], +m[2]);
  }
  return out;
}
__name(radarReadingsPart, "radarReadingsPart");
function radarDailyRows(readings, meta, part = 0, parts = 1) {
  const rows = [], seen = /* @__PURE__ */ new Set();
  const mt = meta || {};
  const own2 = readings instanceof Map;
  for (const [key, vals] of own2 ? readings : Object.entries(readings || {})) {
    const ps = own2 ? vals : vals.filter((p) => p != null);
    const n = ps.length;
    if (!n) continue;
    let sum = ps[0];
    for (let i = 1; i < n; i++) {
      const x = ps[i];
      sum += x;
      let j = i - 1;
      while (j >= 0 && ps[j] > x) {
        ps[j + 1] = ps[j];
        j--;
      }
      ps[j + 1] = x;
    }
    seen.add(key);
    rows.push([Number(key), n, pyMedian(ps), pyMean(sum, n), ps[0], ps[n - 1], mt[key]?.[1] ?? null]);
  }
  for (const key in mt) {
    const p = mt[key]?.[0];
    if (p == null || seen.has(key) || idPart(key, parts) !== part) continue;
    rows.push([Number(key), 1, p, p, p, p, mt[key][1] ?? null]);
  }
  return rows;
}
__name(radarDailyRows, "radarDailyRows");
function radarCloseStmt(db, date, rows) {
  return db.prepare(
    `INSERT INTO daily (universe_id, date, n, median, mean, min, max, visits)
     SELECT j.value ->> 0, ?2, j.value ->> 1, j.value ->> 2, j.value ->> 3, j.value ->> 4, j.value ->> 5, j.value ->> 6
     FROM json_each(?1) j
     WHERE EXISTS (SELECT 1 FROM games g WHERE g.universe_id = (j.value ->> 0))
     ON CONFLICT (universe_id, date) DO UPDATE SET
       n = CASE WHEN excluded.n > daily.n THEN excluded.n ELSE daily.n END,
       median = CASE WHEN excluded.n > daily.n THEN excluded.median ELSE daily.median END,
       mean = CASE WHEN excluded.n > daily.n THEN excluded.mean ELSE daily.mean END,
       min = CASE WHEN excluded.n > daily.n THEN excluded.min ELSE daily.min END,
       max = CASE WHEN excluded.n > daily.n THEN excluded.max ELSE daily.max END,
       visits = COALESCE(daily.visits, excluded.visits)
     WHERE excluded.n > daily.n OR (daily.visits IS NULL AND excluded.visits IS NOT NULL)`
  ).bind(JSON.stringify(rows || []), date);
}
__name(radarCloseStmt, "radarCloseStmt");
async function radarSlice(db, { lo, hi, days, before, today }) {
  const { results } = await db.prepare(
    `SELECT json_array(g.universe_id, COALESCE(g.horror, 0), COALESCE(g.sel, 0), g.created, g.first_seen,
       (SELECT first_day FROM hist WHERE universe_id = g.universe_id),
       json(COALESCE((SELECT json_group_object(k.sort_id, k.rank) FROM sort_hits k
              WHERE k.universe_id = g.universe_id AND k.date = ?5 AND k.sort_id NOT LIKE 'search:%'), '{}')),
       json(COALESCE((SELECT json_group_array(json_array(r.date, r.median, r.min, r.max, r.n, r.visits)) FROM (
              SELECT date, median, min, max, n, visits FROM daily
              WHERE universe_id = g.universe_id AND date < ?4 ORDER BY date DESC LIMIT ?3) r), '[]'))) AS row
     FROM games g WHERE g.tracked = 1 AND g.universe_id BETWEEN ?1 AND ?2`
  ).bind(lo, hi, days, before, today).all();
  return results.map((r) => {
    const row = JSON.parse(r.row);
    row[7].reverse();
    return row;
  });
}
__name(radarSlice, "radarSlice");
async function radarIds(db, today) {
  const cached = await getState(db, "radar_places");
  if (cached?.day === today && Array.isArray(cached.pairs) && Array.isArray(cached.nop)) {
    return [.../* @__PURE__ */ new Set([...cached.pairs.map((p) => p[1]), ...cached.nop])];
  }
  return trackedIds(db);
}
__name(radarIds, "radarIds");
function idRanges(ids, size) {
  const sorted = [...ids].sort((a, b) => a - b);
  const los = [];
  for (let i = 0; i < sorted.length; i += size) los.push(sorted[i]);
  if (!los.length) return [[0, Number.MAX_SAFE_INTEGER]];
  los[0] = 0;
  return los.map((lo, i) => [lo, i + 1 < los.length ? los[i + 1] - 1 : Number.MAX_SAFE_INTEGER]);
}
__name(idRanges, "idRanges");
function applySelectionStmt(db, ids) {
  return db.prepare(
    `UPDATE games SET sel = (universe_id IN (SELECT value FROM json_each(?1)))
     WHERE COALESCE(sel, 0) IS NOT (universe_id IN (SELECT value FROM json_each(?1)))`
  ).bind(JSON.stringify(ids));
}
__name(applySelectionStmt, "applySelectionStmt");
async function radarCounts(db, today = isoDate(minuteOf(Date.now()))) {
  const cached = await getState(db, "radar_counts");
  if (cached?.day === today) return { radar: cached.radar, selected: cached.selected };
  const row = await db.prepare(
    "SELECT COUNT(*) AS radar, COALESCE(SUM(sel = 1), 0) AS selected FROM games WHERE tracked = 1"
  ).first();
  const out = { radar: row?.radar ?? 0, selected: row?.selected ?? 0 };
  await setState(db, "radar_counts", { day: today, ...out });
  return out;
}
__name(radarCounts, "radarCounts");
function insertSamplesStmt(db, rows, ts) {
  return db.prepare(
    `INSERT OR IGNORE INTO samples (universe_id, ts, playing, visits)
     SELECT j.value ->> 0, ?2, j.value ->> 1, j.value ->> 2 FROM json_each(?1) j`
  ).bind(JSON.stringify(rows), ts);
}
__name(insertSamplesStmt, "insertSamplesStmt");
function backfillSamplesStmt(db, text2, ts, ids) {
  return db.prepare(
    `INSERT OR IGNORE INTO samples (universe_id, ts, playing, visits)
     SELECT j.value, ?2, ?1 ->> ('$."' || j.value || '"'), NULL FROM json_each(?3) j
     WHERE (?1 ->> ('$."' || j.value || '"')) >= ?4`
  ).bind(text2, ts, JSON.stringify(ids), TRACK_MIN_PLAYERS);
}
__name(backfillSamplesStmt, "backfillSamplesStmt");
function lowSinceStmts(db, rows, today) {
  const low = [], high = [];
  for (const [id, p] of rows) (p >= TRACK_MIN_PLAYERS ? high : low).push(id);
  const out = [];
  if (low.length) out.push(db.prepare(
    `UPDATE games SET low_since = ?2
     WHERE universe_id IN (SELECT value FROM json_each(?1)) AND low_since IS NULL`
  ).bind(JSON.stringify(low), today));
  if (high.length) out.push(db.prepare(
    `UPDATE games SET low_since = NULL
     WHERE universe_id IN (SELECT value FROM json_each(?1)) AND low_since IS NOT NULL`
  ).bind(JSON.stringify(high)));
  return out;
}
__name(lowSinceStmts, "lowSinceStmts");
var META_COLS = [
  "place_id",
  "name",
  "creator",
  "creator_verified",
  "created",
  "updated",
  "genre",
  "genre_l1",
  "genre_l2",
  "max_players",
  "horror",
  "horror_score",
  "horror_reasons"
];
function updateMetaStmt(db, rows, today) {
  const set = META_COLS.map((c, i) => `${c} = COALESCE(j.value ->> ${i + 1}, games.${c})`).join(", ");
  const diff = META_COLS.map((c, i) => `(j.value ->> ${i + 1}) IS NOT NULL AND games.${c} IS NOT (j.value ->> ${i + 1})`).join(" OR ");
  return db.prepare(
    `UPDATE games SET ${set}, meta_date = ?2
     FROM json_each(?1) j
     WHERE games.universe_id = (j.value ->> 0) AND (${diff})`
  ).bind(JSON.stringify(rows), today);
}
__name(updateMetaStmt, "updateMetaStmt");
function closeDayStmt(db, date, votes) {
  const start = dayStart(date);
  return db.prepare(
    `WITH x AS MATERIALIZED (
       SELECT g.universe_id AS id, (SELECT json_array(COUNT(*), MIN(playing), MAX(playing), SUM(playing), MAX(visits),
                                                      json_group_array(playing ORDER BY playing))
                                    FROM samples s WHERE s.universe_id = g.universe_id AND s.ts >= ?1 AND s.ts < ?2) AS x
       FROM games g
       WHERE EXISTS (SELECT 1 FROM samples s WHERE s.universe_id = g.universe_id AND s.ts >= ?1 AND s.ts < ?2)
     ),
     a AS (
       SELECT id, x ->> 0 AS n, ${sortedMedian("(x -> 5)", "0", "(x ->> 0)")} AS median,
              ${MEAN_OF("(x ->> 3)", "(x ->> 0)")} AS mean, x ->> 1 AS mn, x ->> 2 AS mx, x ->> 4 AS v
       FROM x WHERE x ->> 0 > 0
     ),
     vt AS MATERIALIZED (
       SELECT CAST(key AS INTEGER) AS id, value ->> 0 AS fav, value ->> 1 AS up, value ->> 2 AS down
       FROM json_each(?4)
     )
     INSERT INTO daily (universe_id, date, n, median, mean, min, max, visits, favorites, up, down)
     SELECT a.id, ?3, a.n, a.median, a.mean, a.mn, a.mx, a.v, vt.fav, vt.up, vt.down
     FROM a LEFT JOIN vt ON vt.id = a.id WHERE true
     ON CONFLICT (universe_id, date) DO UPDATE SET
       n = excluded.n, median = excluded.median, mean = excluded.mean,
       min = excluded.min, max = excluded.max,
       visits = COALESCE(excluded.visits, daily.visits),
       favorites = COALESCE(excluded.favorites, daily.favorites),
       up = COALESCE(excluded.up, daily.up),
       down = COALESCE(excluded.down, daily.down)
     WHERE daily.n IS NOT excluded.n OR daily.median IS NOT excluded.median
        OR daily.mean IS NOT excluded.mean OR daily.min IS NOT excluded.min
        OR daily.max IS NOT excluded.max
        OR (excluded.visits IS NOT NULL AND daily.visits IS NOT excluded.visits)
        OR (excluded.favorites IS NOT NULL AND daily.favorites IS NOT excluded.favorites)
        OR (excluded.up IS NOT NULL AND daily.up IS NOT excluded.up)
        OR (excluded.down IS NOT NULL AND daily.down IS NOT excluded.down)`
  ).bind(start, start + DAY_MIN, date, JSON.stringify(votes || {}));
}
__name(closeDayStmt, "closeDayStmt");
function applyVotesStmt(db, date, votes) {
  return db.prepare(
    `UPDATE daily SET favorites = COALESCE(j.value ->> 0, favorites),
                      up = COALESCE(j.value ->> 1, up), down = COALESCE(j.value ->> 2, down)
     FROM json_each(?1) j
     WHERE daily.universe_id = CAST(j.key AS INTEGER) AND daily.date = ?2
       AND (favorites IS NOT (j.value ->> 0) OR up IS NOT (j.value ->> 1) OR down IS NOT (j.value ->> 2))`
  ).bind(JSON.stringify(votes || {}), date);
}
__name(applyVotesStmt, "applyVotesStmt");
var HIST_COLS = "universe_id, peak, peak_date, days, first_day, favorites, up, down, last_date";
function mergeHistStmt(db, date) {
  const isnew = "excluded.last_date > COALESCE(hist.last_date, '')";
  const touch = `(${isnew} OR excluded.last_date = hist.last_date)`;
  const higher = `${isnew} AND excluded.peak > COALESCE(hist.peak, -1)`;
  return db.prepare(
    `INSERT INTO hist (${HIST_COLS})
     SELECT d.universe_id, CASE WHEN d.max > -1 THEN d.max END, CASE WHEN d.max > -1 THEN d.date END, 1, d.date,
            CASE WHEN d.favorites > 0 THEN d.favorites END, d.up, d.down, d.date
     FROM games g CROSS JOIN daily d ON d.universe_id = g.universe_id AND d.date = ?1
     WHERE true
     ON CONFLICT (universe_id) DO UPDATE SET
       peak = CASE WHEN ${higher} THEN excluded.peak ELSE hist.peak END,
       peak_date = CASE WHEN ${higher} THEN excluded.peak_date ELSE hist.peak_date END,
       days = COALESCE(hist.days, 0) + (${isnew}),
       first_day = COALESCE(hist.first_day, CASE WHEN ${isnew} THEN excluded.first_day END),
       favorites = CASE WHEN ${touch} AND excluded.favorites IS NOT NULL THEN excluded.favorites ELSE hist.favorites END,
       up = CASE WHEN ${touch} AND excluded.up IS NOT NULL THEN excluded.up ELSE hist.up END,
       down = CASE WHEN ${touch} AND excluded.down IS NOT NULL THEN excluded.down ELSE hist.down END,
       last_date = CASE WHEN ${isnew} THEN excluded.last_date ELSE hist.last_date END
     WHERE ${isnew}
        OR (excluded.last_date = hist.last_date
            AND ((excluded.favorites IS NOT NULL AND excluded.favorites IS NOT hist.favorites)
              OR (excluded.up IS NOT NULL AND excluded.up IS NOT hist.up)
              OR (excluded.down IS NOT NULL AND excluded.down IS NOT hist.down)))`
  ).bind(date);
}
__name(mergeHistStmt, "mergeHistStmt");
var HIST_DDL = `CREATE TABLE IF NOT EXISTS hist (
  universe_id INTEGER PRIMARY KEY, peak INTEGER, peak_date TEXT, days INTEGER, first_day TEXT,
  favorites INTEGER, up INTEGER, down INTEGER, last_date TEXT)`;
async function migrateHist(db) {
  try {
    return await db.batch(migrateHistStmts(db));
  } catch (e) {
    if (!/no such table: hist/i.test(String(e?.message || e))) throw e;
    await db.prepare(HIST_DDL).run();
    return await db.batch(migrateHistStmts(db));
  }
}
__name(migrateHist, "migrateHist");
function migrateHistStmts(db) {
  return [
    db.prepare(
      `INSERT INTO hist (${HIST_COLS})
       SELECT CAST(key AS INTEGER), value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5, value ->> 6, value ->> 7
       FROM json_each((SELECT value FROM state WHERE key = 'hist_agg')) WHERE true
       ON CONFLICT (universe_id) DO NOTHING`
    ),
    db.prepare("DELETE FROM state WHERE key = 'hist_agg'")
  ];
}
__name(migrateHistStmts, "migrateHistStmts");
function rebuildHistStmts(db) {
  return [
    db.prepare("DELETE FROM hist"),
    db.prepare(
      `WITH a AS (
         SELECT universe_id AS id, MAX(max) AS peak, MIN(date) AS first_day, COUNT(*) AS days, MAX(date) AS last
         FROM daily GROUP BY universe_id
       ),
       pk AS (
         SELECT d.universe_id AS id, MIN(d.date) AS pd FROM daily d JOIN a ON a.id = d.universe_id AND d.max = a.peak
         GROUP BY d.universe_id
       ),
       fv AS (
         SELECT id, fav FROM (SELECT universe_id AS id, favorites AS fav,
                ROW_NUMBER() OVER (PARTITION BY universe_id ORDER BY date DESC) AS rn
                FROM daily WHERE favorites > 0) WHERE rn = 1
       ),
       vu AS (
         SELECT id, up FROM (SELECT universe_id AS id, up,
                ROW_NUMBER() OVER (PARTITION BY universe_id ORDER BY date DESC) AS rn
                FROM daily WHERE up IS NOT NULL) WHERE rn = 1
       ),
       vd AS (
         SELECT id, down FROM (SELECT universe_id AS id, down,
                ROW_NUMBER() OVER (PARTITION BY universe_id ORDER BY date DESC) AS rn
                FROM daily WHERE down IS NOT NULL) WHERE rn = 1
       )
       INSERT INTO hist (${HIST_COLS})
       SELECT a.id, a.peak, pk.pd, a.days, a.first_day, fv.fav, vu.up, vd.down, a.last
       FROM a LEFT JOIN pk ON pk.id = a.id LEFT JOIN fv ON fv.id = a.id
              LEFT JOIN vu ON vu.id = a.id LEFT JOIN vd ON vd.id = a.id
       WHERE true`
    ),
    db.prepare("DELETE FROM state WHERE key = 'hist_agg'")
  ];
}
__name(rebuildHistStmts, "rebuildHistStmts");
function pruneHistStmt(db, cutoffDate) {
  return db.prepare("DELETE FROM hist WHERE last_date < ?1").bind(cutoffDate);
}
__name(pruneHistStmt, "pruneHistStmt");
function pruneSamplesStmt(db, cutoffTs) {
  return db.prepare(
    `DELETE FROM samples WHERE ts < ?1
       AND universe_id IN (SELECT universe_id FROM games)`
  ).bind(cutoffTs);
}
__name(pruneSamplesStmt, "pruneSamplesStmt");
function pruneOldStmts(db, cutoffDate) {
  return [
    db.prepare(`DELETE FROM daily WHERE date < ?1 AND universe_id IN (SELECT universe_id FROM games)`).bind(cutoffDate),
    db.prepare(`DELETE FROM sort_hits WHERE date < ?1 AND universe_id IN (SELECT universe_id FROM games)`).bind(cutoffDate)
  ];
}
__name(pruneOldStmts, "pruneOldStmts");
function untrackStmt(db, today) {
  const limit = addDays(today, -UNTRACK_AFTER_DAYS);
  const yesterday = addDays(today, -1);
  return db.prepare(
    `UPDATE games SET tracked = 0
     WHERE tracked = 1 AND low_since IS NOT NULL AND low_since <= ?1
       AND NOT EXISTS (SELECT 1 FROM sort_hits h
                       WHERE h.universe_id = games.universe_id AND h.date >= ?2)`
  ).bind(limit, yesterday);
}
__name(untrackStmt, "untrackStmt");
async function exportPlan(db, size, { selected = false } = {}) {
  const { results } = await db.prepare(
    `SELECT universe_id AS lo FROM (
       SELECT universe_id, ROW_NUMBER() OVER (ORDER BY universe_id) - 1 AS rn FROM games
       WHERE tracked = 1 ${selected ? "AND sel = 1" : ""})
     WHERE rn % ?1 = 0 ORDER BY lo`
  ).bind(size).all();
  const los = results.map((r) => r.lo);
  if (!los.length) return [[0, Number.MAX_SAFE_INTEGER]];
  los[0] = 0;
  return los.map((lo, i) => [lo, i + 1 < los.length ? los[i + 1] - 1 : Number.MAX_SAFE_INTEGER]);
}
__name(exportPlan, "exportPlan");
async function lastSampleTs(db) {
  const v = await getState(db, "last_sample_ts");
  if (Number.isFinite(Number(v)) && v) return Number(v);
  const row = await db.prepare("SELECT MAX(ts) AS ts FROM samples").first();
  return row?.ts ?? null;
}
__name(lastSampleTs, "lastSampleTs");
var EXPORT_D_KEY = "export_d";
function dropExportCacheStmt(db) {
  return db.prepare("DELETE FROM state WHERE key = ?1").bind(EXPORT_D_KEY);
}
__name(dropExportCacheStmt, "dropExportCacheStmt");
var OPEN_DAYS = [0, 1, 2, 3];
var closedEntrySql = /* @__PURE__ */ __name((id) => `(SELECT json_array(
    (SELECT json_group_array(json_array(date, median, min, max, n, NULL) ORDER BY date) FROM (
       SELECT date, median, min, max, n FROM daily
       WHERE universe_id = ${id} AND date < ?10 ORDER BY date DESC LIMIT ?9)),
    (SELECT json_group_array(json_array(
              (SELECT COUNT(*) FROM daily dd WHERE dd.universe_id = ${id} AND dd.date >= w.lo AND dd.date < v.date),
              v.visits) ORDER BY v.date DESC)
     FROM (SELECT date, visits FROM daily
           WHERE universe_id = ${id} AND date >= w.lo AND date < ?10 AND visits IS NOT NULL
           ORDER BY date DESC LIMIT 2) v))
  FROM (SELECT COALESCE((SELECT date FROM daily WHERE universe_id = ${id} AND date < ?10
                         ORDER BY date DESC LIMIT 1 OFFSET ?9 - 1), '') AS lo) w)`, "closedEntrySql");
var SLICE_GAMES = `g0 AS (
      SELECT universe_id AS id FROM games
      WHERE ?13 IS NULL AND universe_id BETWEEN ?11 AND ?12 AND (?15 = 0 OR sel = 1)
      UNION ALL
      SELECT value FROM json_each(?13) WHERE ?13 IS NOT NULL
    )`;
async function buildExportSlice(db, { nowMs, lastTs, openDay, lo = 0, hi = Number.MAX_SAFE_INTEGER, ids = null, selected = false, filter = true }) {
  const now = minuteOf(nowMs);
  const today = isoDate(now);
  openDay = openDay && openDay < today ? openDay : today;
  lastTs = lastTs ?? now;
  const sFrom = lastTs - EXPORT_SAMPLE_HOURS * 60;
  const cut24 = lastTs - 24 * 60;
  const openTs = Math.max(dayStart(openDay), sFrom);
  const binds = [
    sFrom,
    cut24,
    CATEGORIES.general.min_players,
    CATEGORIES.horror.min_players,
    EMERGING.max_visits,
    EMERGING.min_players,
    openTs,
    today,
    EXPORT_DAILY_DAYS,
    openDay,
    lo,
    hi,
    ids ? JSON.stringify(ids) : null,
    now - 24 * 60,
    selected ? 1 : 0,
    filter ? 1 : 0,
    Math.floor(openTs / DAY_MIN),
    EXPORT_D_KEY
  ];
  const cache = !!ids;
  const K = OPEN_DAYS.map((k) => ({
    a: "(s.x -> 5)",
    f: `(s.x ->> ${6 + 3 * k})`,
    n: `(s.x ->> ${7 + 3 * k})`,
    v: `(s.x ->> ${8 + 3 * k})`,
    day: `date((?17 + ${k}) * 86400, 'unixepoch')`
  }));
  for (const k of K) {
    k.has = `(${k.n} > 0)`;
    k.mn = `(${k.a} ->> ${k.f})`;
    k.mx = `(${k.a} ->> (${k.f} + ${k.n} - 1))`;
    k.median = sortedMedian(k.a, k.f, k.n);
  }
  const days = `(${K.map((k) => k.has).join(" + ")})`;
  const vdays = `(${K.map((k) => `(${k.has} AND ${k.v} IS NOT NULL)`).join(" + ")})`;
  const pmx = `NULLIF(MAX(${K.map((k) => `CASE WHEN ${k.has} THEN ${k.mx} ELSE -1 END`).join(", ")}), -1)`;
  const sql = `
    WITH
    ${SLICE_GAMES},
    -- \xDAltima muestra con visitas (t1) y la \xFAltima \u2265 20 h anterior (t0): las
    -- \xFAnicas de "s" que llevan visitas. Hacia atr\xE1s por la clave primaria.
    g1 AS (
      SELECT id, (SELECT ts FROM samples WHERE universe_id = g0.id AND ts >= ?1 AND visits IS NOT NULL
                  ORDER BY ts DESC LIMIT 1) AS t1
      FROM g0
    ),
    g2 AS MATERIALIZED (
      SELECT id, t1, (SELECT ts FROM samples WHERE universe_id = g1.id AND ts >= ?1 AND ts <= g1.t1 - 1200
                      AND visits IS NOT NULL ORDER BY ts DESC LIMIT 1) AS t0
      FROM g1
    ),
    -- Un solo recorrido de las muestras de 48 h de cada juego:
    -- x = [\xFAltimo ts, m\xE1x 24 h, m\xE1x visitas, "s", ts de 24 h, jugadores de los
    --      d\xEDas abiertos ordenados (para las medianas), y por d\xEDa abierto k
    --      d\xF3nde empieza, cu\xE1ntas muestras tiene y su m\xE1ximo de visitas]
    a AS MATERIALIZED (
      SELECT g2.id, g2.t1, (SELECT json_array(
          MAX(ts), MAX(CASE WHEN ts >= ?2 THEN playing END), MAX(visits),
          json_group_array(json_array(ts, playing, CASE WHEN ts = g2.t1 OR ts = g2.t0 THEN visits END)),
          json_group_array(ts) FILTER (WHERE ts >= ?14),
          json_group_array(playing ORDER BY ts / 1440, playing) FILTER (WHERE ts >= ?7),
          ${OPEN_DAYS.map((k) => `COUNT(*) FILTER (WHERE ts >= ?7 AND ts / 1440 < ?17 + ${k}),
          COUNT(*) FILTER (WHERE ts >= ?7 AND ts / 1440 = ?17 + ${k}),
          MAX(visits) FILTER (WHERE ts >= ?7 AND ts / 1440 = ?17 + ${k})`).join(",\n          ")})
        FROM (SELECT ts, playing, visits FROM samples WHERE universe_id = g2.id AND ts >= ?1 ORDER BY ts)) AS x
      FROM g2
    ),
    st AS (SELECT id, t1, x, x ->> 1 AS max24, x ->> 2 AS visits FROM a WHERE x ->> 0 IS NOT NULL),
    -- hv: la fila de hist del juego, aqu\xED (MATERIALIZED) para leerla una vez
    -- por juego y no en cada uso de games_json
    sel AS MATERIALIZED (
      SELECT g.*, st.max24, st.t1, st.x,
             (SELECT json_array(peak, peak_date, days, first_day, favorites, up, down) FROM hist
              WHERE universe_id = g.universe_id) AS hv
      FROM st CROSS JOIN games g ON g.universe_id = st.id
      WHERE ?16 = 0
         OR st.max24 >= ?3
         OR (g.horror = 1 AND st.max24 >= ?4)
         OR (st.max24 >= ?6 AND COALESCE(st.visits, (SELECT d.visits FROM daily d WHERE d.universe_id = g.universe_id
               AND d.visits IS NOT NULL ORDER BY d.date DESC LIMIT 1)) < ?5)   -- sin visitas conocidas, no
    ),
    -- D\xEDas sin cerrar (pmx/pday/pdays/pfirst = pico, su d\xEDa, n\xBA de d\xEDas y el primero)
    -- y filas cerradas de daily (ce: de state.export_d o, si falta, de daily).
    -- Sin cach\xE9, MATERIALIZED: ce se usa varias veces y cada uso volver\xEDa a leer daily
    s3 AS ${cache ? "" : "MATERIALIZED "}(
      SELECT s.*, ${days} AS pdays, ${vdays} AS pvdays, ${pmx} AS pmx,
             CASE ${K.map((k) => `WHEN ${k.has} THEN ${k.day}`).join(" ")} END AS pfirst,
             COALESCE(json_extract((SELECT CASE WHEN value ->> '$.day' = ?10 THEN value END FROM state WHERE key = ?18),
                                   '$.g."' || s.universe_id || '"'),
                      ${closedEntrySql("s.universe_id")}) AS ce
      FROM sel s
    ),
    s4 AS (
      SELECT s.*, CASE ${K.map((k) => `WHEN ${k.has} AND ${k.mx} = s.pmx THEN ${k.day}`).join(" ")} END AS pday,
             MAX(0, json_array_length(s.ce -> 0) + s.pdays - ?9) AS dropn
      FROM s3 s
    ),
    games_json AS (
      SELECT s.universe_id AS id, json_object(
        'id', s.universe_id, 'place_id', s.place_id, 'name', s.name,
        'creator', s.creator,
        'creator_verified', json(CASE s.creator_verified WHEN 1 THEN 'true' WHEN 0 THEN 'false' ELSE 'null' END),
        'created', s.created, 'updated', s.updated,
        'genre', s.genre, 'genre_l1', s.genre_l1, 'genre_l2', s.genre_l2,
        'max_players', s.max_players, 'first_seen', s.first_seen,
        'horror', json(CASE WHEN s.horror = 1 THEN 'true' ELSE 'false' END),
        'horror_score', COALESCE(s.horror_score, 0),
        'horror_reasons', json(COALESCE(s.horror_reasons, '[]')),
        'sorts', json(COALESCE((SELECT json_group_object(k.sort_id, k.rank) FROM sort_hits k
                       WHERE k.universe_id = s.universe_id AND k.date = ?8 AND k.sort_id NOT LIKE 'search:%'), '{}')),
        'favorites', s.hv ->> 4, 'up', s.hv ->> 5, 'down', s.hv ->> 6,
        'peak', CASE WHEN s.pmx > COALESCE(s.hv ->> 0, -1) THEN s.pmx ELSE s.hv ->> 0 END,
        'peak_date', CASE WHEN s.pmx > COALESCE(s.hv ->> 0, -1) THEN s.pday ELSE s.hv ->> 1 END,
        'days_tracked', COALESCE(s.hv ->> 2, 0) + s.pdays,
        'first_day', COALESCE(s.hv ->> 3, s.pfirst),
        -- \xDAltimas ?9 filas: las cerradas (sin las ?dropn m\xE1s viejas) y los d\xEDas
        -- abiertos. visits solo en las 2 \xFAltimas filas que la tienen (lo \xFAnico
        -- que usa metrics.js): primero las de los d\xEDas abiertos y, si faltan, las
        -- cerradas. Las rutas '$.x' no existen en un array: json_set/json_insert/
        -- json_remove las ignoran, y as\xED cada paso es condicional sin repetir texto.
        'd', json(json_insert(json_remove(json_set(s.ce -> 0,
                 CASE WHEN s.pvdays < 2 AND json_array_length(s.ce -> 1) >= 1 AND (s.ce ->> '$[1][0][0]') >= s.dropn
                      THEN '$[' || (s.ce ->> '$[1][0][0]') || '][5]' ELSE '$.x' END, s.ce ->> '$[1][0][1]',
                 CASE WHEN s.pvdays < 1 AND json_array_length(s.ce -> 1) >= 2 AND (s.ce ->> '$[1][1][0]') >= s.dropn
                      THEN '$[' || (s.ce ->> '$[1][1][0]') || '][5]' ELSE '$.x' END, s.ce ->> '$[1][1][1]'),
               ${OPEN_DAYS.map((k) => `CASE WHEN s.dropn > ${k} THEN '$[0]' ELSE '$.x' END`).join(", ")}),
               ${K.map((k, i) => `CASE WHEN ${k.has} THEN '$[#]' ELSE '$.x' END,
                 json_array(${k.day}, ${k.median}, ${k.mn}, ${k.mx}, ${k.n},
                            CASE WHEN ${k.v} IS NOT NULL AND (${K.slice(i + 1).map((j) => `(${j.has} AND ${j.v} IS NOT NULL)`).join(" + ") || "0"}) < 2
                                 THEN ${k.v} END)`).join(",\n               ")})),
        's', json(s.x -> 3)
      ) AS gj
      FROM s4 s
    )
    SELECT
      (SELECT group_concat(gj, ',') FROM (SELECT gj FROM games_json ORDER BY id)) AS frag,
      (SELECT COUNT(*) FROM sel) AS n,
      (SELECT MAX(x ->> 0) FROM a) AS last_ts,
      (SELECT json_group_array(json(x -> 4)) FROM a WHERE x ->> 0 IS NOT NULL) AS ts24`;
  const stmts = [db.prepare(sql).bind(...binds)];
  if (cache) {
    stmts.unshift(db.prepare(`
      WITH
      ${SLICE_GAMES},
      c AS (SELECT CASE WHEN value ->> '$.day' = ?10 THEN value END AS j FROM state WHERE key = ?18),
      miss AS (SELECT id FROM g0 WHERE json_type((SELECT j FROM c), '$.g."' || id || '"') IS NULL)
      INSERT INTO state (key, value)
      SELECT ?18, json_object('day', ?10, 'g', json_patch(COALESCE((SELECT j FROM c) -> '$.g', '{}'),
                                                          json_group_object(id, json(${closedEntrySql("miss.id")}))))
      FROM miss WHERE true HAVING COUNT(*) > 0
      ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE state.value IS NOT excluded.value`).bind(...binds));
  }
  const res = await db.batch(stmts);
  const main = res[res.length - 1];
  const row = main.results?.[0] || {};
  const ts24 = [...new Set(JSON.parse(row.ts24 || "[]").flat())];
  return {
    frag: row.frag || "",
    n: row.n || 0,
    last_ts: row.last_ts ?? null,
    ts24,
    meta: {
      rows_read: res.reduce((t, r) => t + (r.meta?.rows_read || 0), 0),
      rows_written: res.reduce((t, r) => t + (r.meta?.rows_written || 0), 0)
    }
  };
}
__name(buildExportSlice, "buildExportSlice");
function exportHeader({ nowMs, lastTs, ts24, radar = null }) {
  return {
    generated_at: new Date(nowMs).toISOString().slice(0, 19) + "Z",
    last_sample: lastTs != null ? isoMinute(lastTs) : null,
    samples_24h: new Set(ts24).size,
    ...radar ? { radar_games: radar.radar, selected_games: radar.selected } : {}
  };
}
__name(exportHeader, "exportHeader");
async function history(db, id, { nowMs = Date.now(), openDay } = {}) {
  const now = minuteOf(nowMs);
  const today = isoDate(now);
  openDay = openDay && openDay < today ? openDay : today;
  const dFrom = addDays(today, -(HISTORY_DAYS - 1));
  const rFrom = now - HISTORY_SAMPLE_DAYS * DAY_MIN;
  const openTs = dayStart(openDay);
  const sql = `
    WITH pr AS (
      SELECT playing AS p, date(ts * 60, 'unixepoch') AS day,
             ROW_NUMBER() OVER (PARTITION BY date(ts * 60, 'unixepoch') ORDER BY playing) AS rn,
             COUNT(*) OVER (PARTITION BY date(ts * 60, 'unixepoch')) AS cnt
      FROM samples WHERE universe_id = ?1 AND ts >= ?4
    ),
    part AS (
      SELECT day, MAX(cnt) AS n,
             ${MEDIAN_SQL} AS median,
             ${MEAN_SQL} AS mean,
             MIN(p) AS mn, MAX(p) AS mx
      FROM pr GROUP BY day
    )
    SELECT json_object(
      -- [fecha, mediana, m\xEDn, m\xE1x, n, (hueco: la web marca ah\xED los eventos), media]
      'd', json(COALESCE((SELECT json_group_array(json(r.x)) FROM (
             SELECT json_array(date, median, min, max, n, 0, mean) AS x, date AS o FROM daily
             WHERE universe_id = ?1 AND date >= ?2 AND date < ?3
             UNION ALL SELECT json_array(day, median, mn, mx, n, 0, mean), day FROM part
             ORDER BY o) r), '[]')),
      'r', json(COALESCE((SELECT json_group_array(json(r.x)) FROM (
             SELECT json_array(strftime('%Y-%m-%dT%H:%MZ', ts * 60, 'unixepoch'), playing) AS x
             FROM samples WHERE universe_id = ?1 AND ts >= ?5 ORDER BY ts) r), '[]'))
    ) AS out,
    EXISTS (SELECT 1 FROM games WHERE universe_id = ?1) AS known`;
  const row = await db.prepare(sql).bind(id, dFrom, openDay, openTs, rFrom).first();
  if (!row?.known) return null;
  return row.out;
}
__name(history, "history");
var IMPORT_TABLES = {
  games: {
    pk: ["universe_id"],
    cols: [
      "universe_id",
      "place_id",
      "name",
      "creator",
      "creator_verified",
      "created",
      "updated",
      "genre",
      "genre_l1",
      "genre_l2",
      "max_players",
      "first_seen",
      "horror",
      "horror_score",
      "horror_reasons",
      "sources",
      "tracked",
      "low_since",
      "meta_date"
    ]
  },
  places: { pk: ["place_id"], cols: ["place_id", "universe_id"] },
  daily: {
    pk: ["universe_id", "date"],
    cols: ["universe_id", "date", "n", "median", "mean", "min", "max", "visits", "favorites", "up", "down"]
  },
  samples: { pk: ["universe_id", "ts"], cols: ["universe_id", "ts", "playing", "visits"] },
  sort_hits: { pk: ["universe_id", "date", "sort_id"], cols: ["universe_id", "date", "sort_id", "rank"] },
  state: { pk: ["key"], cols: ["key", "value"] }
};
function importStmt(db, table, columns, rows) {
  const t = IMPORT_TABLES[table];
  if (!t) throw new Error(`Tabla no permitida: ${table}`);
  for (const c of columns) if (!t.cols.includes(c)) throw new Error(`Columna no permitida: ${table}.${c}`);
  for (const k of t.pk) if (!columns.includes(k)) throw new Error(`Falta la clave ${table}.${k}`);
  const sel = columns.map((c, i) => `j.value ->> ${i}`).join(", ");
  const rest = columns.filter((c) => !t.pk.includes(c));
  const upsert = rest.length ? `DO UPDATE SET ${rest.map((c) => `${c} = excluded.${c}`).join(", ")}
       WHERE ${rest.map((c) => `${table}.${c} IS NOT excluded.${c}`).join(" OR ")}` : "DO NOTHING";
  return db.prepare(
    `INSERT INTO ${table} (${columns.join(", ")})
     SELECT ${sel} FROM json_each(?1) j WHERE true
     ON CONFLICT (${t.pk.join(", ")}) ${upsert}`
  ).bind(JSON.stringify(rows));
}
__name(importStmt, "importStmt");

// src/sources.js
var UA = "roblox-tracker/3.0 (+https://robloxtracker.stonksstudio.com)";
var URLS = {
  rolimons: "https://api.rolimons.com/games/v1/gamelist",
  sorts: "https://apis.roblox.com/explore-api/v1/get-sorts",
  sortContent: "https://apis.roblox.com/explore-api/v1/get-sort-content",
  search: "https://apis.roblox.com/search-api/omni-search",
  games: "https://games.roblox.com/v1/games",
  votes: "https://games.roblox.com/v1/games/votes",
  placeUniverse: "https://apis.roblox.com/universes/v1/places/",
  icons: "https://thumbnails.roblox.com/v1/games/icons",
  thumbs: "https://thumbnails.roblox.com/v1/games/multiget/thumbnails"
};
var GAMES_BATCH = 50;
var VOTES_BATCH = 50;
var sleep = /* @__PURE__ */ __name((ms) => new Promise((r) => setTimeout(r, ms)), "sleep");
var FETCH_TIMEOUT_MS = 2e4;
var Budget = class {
  static {
    __name(this, "Budget");
  }
  constructor(max = 45) {
    this.max = max;
    this.used = 0;
  }
  take() {
    if (this.used >= this.max) throw new BudgetError(`Presupuesto de peticiones agotado (${this.max})`);
    this.used++;
  }
  get left() {
    return this.max - this.used;
  }
};
var BudgetError = class extends Error {
  static {
    __name(this, "BudgetError");
  }
};
var SubBudget = class extends Budget {
  static {
    __name(this, "SubBudget");
  }
  constructor(parent, max) {
    super(max);
    this.parent = parent;
  }
  take() {
    if (this.used >= this.max) throw new BudgetError(`Presupuesto del paso agotado (${this.max})`);
    this.parent.take();
    this.used++;
  }
  get left() {
    return Math.min(this.max - this.used, this.parent.left);
  }
};
async function getJson(url, { budget, retries = 3, base = 800, text: text2 = false, empty, cf, timeout = FETCH_TIMEOUT_MS } = {}) {
  let last = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (budget && budget.left <= 0) break;
    budget?.take();
    try {
      const init = { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(timeout) };
      if (cf) init.cf = cf;
      const r = await fetch(url, init);
      if (r.ok) {
        const data = text2 ? await r.text() : await r.json();
        if (!empty || !empty(data)) return data;
        last = "vac\xEDa";
      } else {
        await r.body?.cancel?.();
        last = r.status;
        if (r.status >= 400 && r.status < 500 && r.status !== 429) return null;
        const ra = Number(r.headers.get("retry-after"));
        if (ra > 0 && ra < 30) {
          await sleep(ra * 1e3);
          continue;
        }
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
__name(getJson, "getJson");
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = /* @__PURE__ */ __name(async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }, "worker");
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
__name(pool, "pool");
function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
__name(chunks, "chunks");
function filterRolimons(text2, minPlayers = 300) {
  const rx = playersRegex(minPlayers);
  const out = [];
  let m;
  while (m = rx.exec(text2)) {
    const e = m.index;
    let bs = 0;
    for (let k = e - 1; text2.charCodeAt(k) === 92; k--) bs++;
    if (bs & 1) continue;
    const q = text2.lastIndexOf('":["', e);
    if (q < 0) continue;
    const pq = text2.lastIndexOf('"', q - 1);
    const pid = text2.slice(pq + 1, q);
    if (!/^\d{1,20}$/.test(pid)) continue;
    let name = text2.slice(q + 4, e);
    if (name.includes("\\")) {
      try {
        name = JSON.parse(`"${name}"`);
      } catch {
      }
    }
    const players = Number(m[1]);
    if (players >= minPlayers) out.push([Number(pid), name, players]);
  }
  return out;
}
__name(filterRolimons, "filterRolimons");
function playersRegex(min) {
  const digits = String(Math.max(1, Math.floor(min))).length;
  const lead = String(min)[0];
  const same = `[${lead}-9]\\d{${digits - 1}}`;
  const more = `[1-9]\\d{${digits},}`;
  return new RegExp(`",(${same}|${more})[,\\]]`, "g");
}
__name(playersRegex, "playersRegex");
async function fetchRolimons(budget, minPlayers) {
  const text2 = await getJson(URLS.rolimons, { budget, text: true, retries: 3, base: 2e3 });
  if (!text2 || !text2.includes('"games"')) return null;
  return filterRolimons(text2, minPlayers);
}
__name(fetchRolimons, "fetchRolimons");
function exploreParams(sessionId) {
  return `sessionId=${sessionId}&device=computer&country=all`;
}
__name(exploreParams, "exploreParams");
async function fetchSortsPage(budget, sessionId, token = null) {
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
__name(fetchSortsPage, "fetchSortsPage");
async function fetchSortContent(budget, sessionId, sortId, token, maxPages = 6) {
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
__name(fetchSortContent, "fetchSortContent");
function gameTuple(g) {
  return [g.universeId, g.rootPlaceId || null, g.name || null, g.playerCount ?? null];
}
__name(gameTuple, "gameTuple");
async function fetchSearch(budget, query, { pages = 3, gapMs = 1200 } = {}) {
  const sid = crypto.randomUUID();
  const out = [];
  let token = null;
  for (let p = 0; p < pages; p++) {
    if (p) await sleep(gapMs);
    const url = `${URLS.search}?searchQuery=${encodeURIComponent(query)}&sessionId=${sid}&pageType=all` + (token ? `&pageToken=${encodeURIComponent(token)}` : "");
    const d = await getJson(url, {
      budget,
      retries: p === 0 ? 3 : 1,
      base: 2500,
      empty: /* @__PURE__ */ __name((x) => !Array.isArray(x?.searchResults) || x.searchResults.length === 0, "empty")
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
__name(fetchSearch, "fetchSearch");
async function fetchGames(budget, ids, { concurrency = 4 } = {}) {
  const res = await pool(chunks(ids, GAMES_BATCH), concurrency, (c) => getJson(`${URLS.games}?universeIds=${c.join(",")}`, { budget, retries: 2 }));
  return collect(res);
}
__name(fetchGames, "fetchGames");
async function fetchVotes(budget, ids, { concurrency = 4 } = {}) {
  const res = await pool(chunks(ids, VOTES_BATCH), concurrency, (c) => getJson(`${URLS.votes}?universeIds=${c.join(",")}`, { budget, retries: 2 }));
  return collect(res);
}
__name(fetchVotes, "fetchVotes");
function collect(pages) {
  const data = [];
  let failed = 0;
  for (const p of pages) {
    if (p && Array.isArray(p.data)) data.push(...p.data);
    else failed++;
  }
  return { data, failed };
}
__name(collect, "collect");
async function resolvePlaces(budget, placeIds, { concurrency = 5 } = {}) {
  return pool(placeIds, concurrency, async (pid) => {
    const d = await getJson(`${URLS.placeUniverse}${pid}/universe`, { budget, retries: 1 });
    return [pid, d?.universeId || null];
  });
}
__name(resolvePlaces, "resolvePlaces");
function iconsUrl(ids, size = "150x150") {
  return `${URLS.icons}?universeIds=${ids.join(",")}&size=${size}&format=Webp&returnPolicy=PlaceHolder`;
}
__name(iconsUrl, "iconsUrl");
function thumbsUrl(ids) {
  return `${URLS.thumbs}?universeIds=${ids.join(",")}&countPerUniverse=1&size=768x432&format=Webp&defaults=true`;
}
__name(thumbsUrl, "thumbsUrl");

// src/stonks.js
import { WorkerEntrypoint } from "cloudflare:workers";
var APP = "roblox-tracker";
var PREFIX = `${APP}/`;
var D1_TOPE = 5e8;
var MAX_RUTAS = 500;
function appBucket(bucket) {
  if (!bucket || bucket.__app) return bucket;
  const k = /* @__PURE__ */ __name((key) => PREFIX + key, "k");
  const short2 = /* @__PURE__ */ __name((o) => ({
    key: o.key.slice(PREFIX.length),
    size: o.size,
    etag: o.etag,
    httpEtag: o.httpEtag,
    uploaded: o.uploaded,
    httpMetadata: o.httpMetadata,
    customMetadata: o.customMetadata
  }), "short");
  return {
    __app: true,
    get: /* @__PURE__ */ __name((key, opts) => bucket.get(k(key), opts), "get"),
    head: /* @__PURE__ */ __name((key) => bucket.head(k(key)), "head"),
    // Datos de cada archivo (ECOSISTEMA §5): la app que lo sube y cuándo
    put: /* @__PURE__ */ __name((key, value, opts = {}) => bucket.put(k(key), value, {
      ...opts,
      customMetadata: { app: APP, fecha: (/* @__PURE__ */ new Date()).toISOString(), ...opts.customMetadata || {} }
    }), "put"),
    delete: /* @__PURE__ */ __name((keys) => bucket.delete(Array.isArray(keys) ? keys.map(k) : k(keys)), "delete"),
    async list(opts = {}) {
      const r = await bucket.list({ ...opts, prefix: PREFIX + (opts.prefix || "") });
      return { ...r, objects: r.objects.map(short2), delimitedPrefixes: (r.delimitedPrefixes || []).map((p) => p.slice(PREFIX.length)) };
    }
  };
}
__name(appBucket, "appBucket");
var withApp = /* @__PURE__ */ __name((env) => env.BUCKET?.__app ? env : { ...env, BUCKET: appBucket(env.BUCKET) }, "withApp");
var sqlName = /* @__PURE__ */ __name((s) => `"${String(s).replaceAll('"', '""')}"`, "sqlName");
var ESPACIO_KEY = "espacio";
var ESPACIO_VIDA_MS = 24 * 36e5;
var MUESTRA_FILAS = 256;
async function espacioD1(db, { exacto = false } = {}) {
  const st = await db.prepare("SELECT value FROM state WHERE key = ?1").bind(ESPACIO_KEY).first().catch(() => null);
  let cache = null;
  try {
    cache = st?.value ? JSON.parse(st.value) : null;
  } catch {
  }
  let medida = !exacto && cache?.tablas && Date.now() - Date.parse(cache.medido) < ESPACIO_VIDA_MS ? cache : null;
  if (!medida) {
    medida = { medido: (/* @__PURE__ */ new Date()).toISOString(), tablas: await medirTablas(db, exacto) };
    await db.prepare(
      `INSERT INTO state (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    ).bind(ESPACIO_KEY, JSON.stringify(medida)).run().catch(() => null);
  }
  const size = Number((await db.prepare("SELECT 1").run())?.meta?.size_after) || 0;
  return {
    app: APP,
    medido: (/* @__PURE__ */ new Date()).toISOString(),
    base: { bytes: size, tablas: medida.tablas },
    mayores: [{ nombre: "Base D1 \xABroblox-tracker\xBB", bytes: size, tope: D1_TOPE }]
  };
}
__name(espacioD1, "espacioD1");
async function medirTablas(db, exacto) {
  const { results: tables } = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE 'd1\\_%' ESCAPE '\\'
     ORDER BY name`
  ).all();
  const names = tables.map((t) => t.name);
  const cols = names.length ? await db.batch(names.map((n) => db.prepare("SELECT name FROM pragma_table_info(?1)").bind(n))) : [];
  const estimadas = exacto ? {} : await estimarFilas(db, names);
  const stmts = names.map((n, i) => {
    const bytes = (cols[i]?.results || []).map((c) => `COALESCE(length(CAST(${sqlName(c.name)} AS BLOB)), 0)`).join(" + ") || "0";
    return n in estimadas ? db.prepare(`SELECT COUNT(*) AS filas, COALESCE(AVG(${bytes}), 0) AS media FROM (SELECT * FROM ${sqlName(n)} LIMIT ${MUESTRA_FILAS})`) : db.prepare(`SELECT COUNT(*) AS filas, COALESCE(SUM(${bytes}), 0) AS bytes FROM ${sqlName(n)}`);
  });
  const res = stmts.length ? await db.batch(stmts) : [];
  return names.map((n, i) => {
    const r = res[i]?.results?.[0] || {};
    if (!(n in estimadas)) return { nombre: n, filas: Number(r.filas) || 0, bytes: Number(r.bytes) || 0 };
    const filas = Math.max(estimadas[n], Number(r.filas) || 0);
    return { nombre: n, filas, bytes: Math.round(filas * (Number(r.media) || 0)) };
  }).sort((a, b) => b.bytes - a.bytes || a.nombre.localeCompare(b.nombre));
}
__name(medirTablas, "medirTablas");
async function estimarFilas(db, names) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const dia = /* @__PURE__ */ __name((n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10), "dia");
  const out = {};
  const stmts = [];
  if (names.includes("daily") && names.includes("hist")) stmts.push(["daily", db.prepare(
    `SELECT COALESCE(SUM(MAX(0, MIN(days,
       CAST(julianday(last_date) - julianday(MAX(COALESCE(first_day, ?1), ?1)) AS INTEGER) + 1))), 0) AS n
     FROM hist`
  ).bind(dia(-DATA_RETENTION_DAYS))]);
  if (names.includes("sort_hits")) stmts.push(["sort_hits", db.prepare(
    `SELECT (SELECT MIN((SELECT MIN(h.date) FROM sort_hits h WHERE h.universe_id = g.universe_id)) FROM games g) AS first,
            COALESCE(SUM(h.date = ?1), 0) AS ayer, COALESCE(SUM(h.date = ?2), 0) AS hoy
     FROM games g CROSS JOIN sort_hits h ON h.universe_id = g.universe_id AND h.date >= ?1`
  ).bind(dia(-1), today)]);
  if (names.includes("samples")) stmts.push(["samples", db.prepare(
    `SELECT (SELECT CAST(value AS INTEGER) FROM state WHERE key = 'last_sample_ts') AS last,
            (SELECT COUNT(*) FROM games g CROSS JOIN samples s ON s.universe_id = g.universe_id
               AND s.ts > (SELECT CAST(value AS INTEGER) FROM state WHERE key = 'last_sample_ts') - 1440) AS dia,
            (SELECT MIN((SELECT MIN(ts) FROM samples s WHERE s.universe_id = g.universe_id)) FROM games g) AS primera`
  )]);
  if (!stmts.length) return out;
  const res = await db.batch(stmts.map((s) => s[1]));
  stmts.forEach(([n], i) => {
    const r = res[i]?.results?.[0] || {};
    if (n === "daily") {
      if (Number(r.n) > 0) out.daily = Number(r.n);
    } else if (n === "samples") {
      const dias = r.primera != null && r.last != null ? Math.max(1, (Number(r.last) - Number(r.primera)) / 1440) : 1;
      out.samples = Math.round((Number(r.dia) || 0) * dias);
    } else {
      const dias = r.first ? Math.max(0, Math.round((Date.parse(dia(-1)) - Date.parse(r.first)) / 864e5) + 1) : 0;
      out.sort_hits = (Number(r.ayer) || 0) * Math.min(dias, DATA_RETENTION_DAYS) + (Number(r.hoy) || 0);
    }
  });
  return out;
}
__name(estimarFilas, "estimarFilas");
var DIAS = { "01": "ene", "02": "feb", "03": "mar", "04": "abr", "05": "may", "06": "jun", "07": "jul", "08": "ago", "09": "sept", "10": "oct", "11": "nov", "12": "dic" };
var fecha = /* @__PURE__ */ __name((d) => `${Number(d.slice(8, 10))} ${DIAS[d.slice(5, 7)] || d.slice(5, 7)} ${d.slice(0, 4)}`, "fecha");
var WEB = "https://robloxtracker.stonksstudio.com/";
function nombreDe(ruta) {
  const fijos = {
    "site/": { nombre: "Web del tracker", detalle: "dashboard.html", enlace: WEB },
    "data/": { nombre: "Datos de la web", detalle: "export y Telegram", enlace: WEB },
    "radar/": { nombre: "Radar", detalle: "lecturas de Rolimons, 7 d\xEDas" },
    "tmp/": { nombre: "Temporales", detalle: "se borran solos" },
    "tmp/export/": { nombre: "Partes del export" },
    "tmp/run/": { nombre: "Muestreos en marcha" }
  };
  if (fijos[ruta]) return fijos[ruta];
  let m = ruta.match(/^radar\/(\d{4}-\d{2}-\d{2})\/$/);
  if (m) return { nombre: `Radar del ${fecha(m[1])}` };
  m = ruta.match(/^tmp\/run\/([^/]+)\/$/);
  if (m) return { nombre: `Muestreo ${m[1]}` };
  return null;
}
__name(nombreDe, "nombreDe");
var Operaciones = class extends WorkerEntrypoint {
  static {
    __name(this, "Operaciones");
  }
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
};

// src/sampler.js
import { WorkflowEntrypoint } from "cloudflare:workers";

// src/horror.js
var EMOJI_SRC = "[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{1F1E6}-\\u{1F1FF}\\u{2190}-\\u{21FF}\\u{2B00}-\\u{2BFF}\\u{3000}-\\u{303F}\\u{FE0F}\\u{200D}\\u{20E3}\\u{2300}-\\u{23FF}]";
var EMOJI_RE_G = new RegExp(EMOJI_SRC, "gu");
var TAG_RE_G = /[\[\(【]([^\]\)】]{1,30})[\]\)】]/gu;
var PY_WS = "\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
var PY_WS_RUN_G = new RegExp(`[${PY_WS}]+`, "g");
var PY_WS_SET = new Set(
  [
    9,
    10,
    11,
    12,
    13,
    28,
    29,
    30,
    31,
    32,
    133,
    160,
    5760,
    8192,
    8193,
    8194,
    8195,
    8196,
    8197,
    8198,
    8199,
    8200,
    8201,
    8202,
    8232,
    8233,
    8239,
    8287,
    12288
  ].map((c) => String.fromCharCode(c))
);
var STRIP_SETS = /* @__PURE__ */ new Map();
function pyStrip(s, chars) {
  let set = PY_WS_SET;
  if (chars !== void 0) {
    set = STRIP_SETS.get(chars);
    if (!set) STRIP_SETS.set(chars, set = new Set(chars));
  }
  let a = 0, b = s.length;
  while (a < b && set.has(s[a])) a++;
  while (b > a && set.has(s[b - 1])) b--;
  return s.slice(a, b);
}
__name(pyStrip, "pyStrip");
function pyRstrip(s) {
  let b = s.length;
  while (b > 0 && PY_WS_SET.has(s[b - 1])) b--;
  return s.slice(0, b);
}
__name(pyRstrip, "pyRstrip");
function pyLen(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 55296 && c <= 56319 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 56320 && d <= 57343) i++;
    }
    n++;
  }
  return n;
}
__name(pyLen, "pyLen");
var NEEDS_FULL_TITLE = /[\[\(\u0080-\uffff]/;
function cleanTitle(name) {
  name = name || "";
  if (!NEEDS_FULL_TITLE.test(name)) {
    const title2 = pyStrip(name.replace(PY_WS_RUN_G, " "), " -|:\xB7\u2022!");
    return [title2 || pyStrip(name) || name, []];
  }
  const tags = [];
  for (const m of name.matchAll(TAG_RE_G)) {
    const t = pyStrip(m[1].replace(EMOJI_RE_G, ""), " -|:!");
    if (t) tags.push(pyLen(t) <= 12 ? t.toUpperCase() : t);
  }
  let title = name.replace(TAG_RE_G, " ");
  title = title.replace(EMOJI_RE_G, " ");
  title = pyStrip(title.replace(PY_WS_RUN_G, " "), " -|:\xB7\u2022!");
  if (!title) title = pyStrip(name.replace(EMOJI_RE_G, "")) || name;
  return [title, tags.slice(0, 3)];
}
__name(cleanTitle, "cleanTitle");
function escapeRe(w) {
  return w.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
}
__name(escapeRe, "escapeRe");
function kwList(words) {
  return words.map((w) => ({ w, rx: new RegExp("(?<![a-z0-9])" + escapeRe(w)) }));
}
__name(kwList, "kwList");
var H_CACHE = null;
var refLists = /* @__PURE__ */ __name(() => {
  if (!H_CACHE) {
    H_CACHE = {};
    for (const k of ["name_strong", "name_weak", "name_negative", "desc_strong", "desc_weak"]) H_CACHE[k] = kwList(HORROR[k]);
  }
  return H_CACHE;
}, "refLists");
var TAGS = HORROR.tags;
var FORCE_IN = new Set(HORROR.force_include.map(Number));
var FORCE_OUT = new Set(HORROR.force_exclude.map(Number));
var own = /* @__PURE__ */ __name((obj, k) => k != null && Object.prototype.hasOwnProperty.call(obj, k), "own");
var refMatcher = {
  first(key, text2) {
    for (const kw of refLists()[key]) if (text2.includes(kw.w) && kw.rx.test(text2)) return kw.w;
    return null;
  },
  all(key, text2) {
    const out = [];
    for (const kw of refLists()[key]) if (text2.includes(kw.w) && kw.rx.test(text2)) out.push(kw.w);
    return out;
  }
};
function trieSource(words) {
  const root = {};
  for (const w of words) {
    let n = root;
    for (const ch of w) n = n[ch] ||= {};
    n[""] = true;
  }
  const emit = /* @__PURE__ */ __name((n) => {
    const keys = Object.keys(n).filter((k) => k !== "");
    if (!keys.length) return "";
    const alts = keys.map((k) => escapeRe(k) + emit(n[k]));
    const body = alts.length === 1 ? alts[0] : `(?:${alts.join("|")})`;
    return n[""] ? `(?:${body})?` : body;
  }, "emit");
  return emit(root);
}
__name(trieSource, "trieSource");
function makeScanner(keys) {
  const lists = keys.map((k) => HORROR[k]);
  const words = [], offsets = [];
  for (const list of lists) {
    offsets.push(words.length);
    words.push(...list);
  }
  if (words.some((w) => !w)) return null;
  const byFirst = /* @__PURE__ */ new Map();
  words.forEach((w, i) => {
    const c = w.charCodeAt(0);
    if (!byFirst.has(c)) byFirst.set(c, []);
    byFirst.get(c).push(i);
  });
  const finder = new RegExp("(?<![a-z0-9])" + trieSource([...new Set(words)]), "g");
  return { keys, lists, words, offsets, byFirst, finder, marks: new Uint8Array(words.length) };
}
__name(makeScanner, "makeScanner");
function scan(sc, text2) {
  const { words, byFirst, finder, marks } = sc;
  marks.fill(0);
  finder.lastIndex = 0;
  let m;
  while ((m = finder.exec(text2)) !== null) {
    const p = m.index;
    const ids = byFirst.get(text2.charCodeAt(p));
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      if (marks[id] === 0 && text2.startsWith(words[id], p)) marks[id] = 1;
    }
    finder.lastIndex = p + 1;
  }
}
__name(scan, "scan");
function scanMatcher(sc, text2) {
  scan(sc, text2);
  const { keys, lists, offsets, marks } = sc;
  return {
    first(key) {
      const li = keys.indexOf(key), o = offsets[li], list = lists[li];
      for (let i = 0; i < list.length; i++) if (marks[o + i]) return list[i];
      return null;
    },
    all(key) {
      const li = keys.indexOf(key), o = offsets[li], list = lists[li], out = [];
      for (let i = 0; i < list.length; i++) if (marks[o + i]) out.push(list[i]);
      return out;
    }
  };
}
__name(scanMatcher, "scanMatcher");
var NAME_SCAN = makeScanner(["name_strong", "name_weak", "name_negative"]);
var DESC_SCAN = makeScanner(["desc_strong", "desc_weak"]);
function classifyHorror(game2, { reference = false } = {}) {
  const g = game2 || {};
  const uid = Number(g.universe_id ?? g.id);
  if (FORCE_IN.has(uid)) return { horror: 99 >= HORROR.threshold, score: 99, reasons: ["incluido a mano"] };
  if (FORCE_OUT.has(uid)) return { horror: false, score: -99, reasons: ["excluido a mano"] };
  const pts = HORROR.points;
  const [title, tags] = cleanTitle(g.name || "");
  const fast = !reference && NAME_SCAN && DESC_SCAN;
  const name = title.toLowerCase();
  const nm = fast ? scanMatcher(NAME_SCAN, name) : refMatcher;
  let score = 0;
  const reasons = [];
  const tag = tags.find((t) => TAGS.includes(t.toLowerCase())) ?? null;
  const hit = nm.first("name_strong", name);
  if (hit || tag) {
    score += pts.name_strong;
    reasons.push(`nombre: ${hit || tag.toLowerCase()}`);
  }
  let w = nm.first("name_weak", name);
  if (w) {
    score += pts.name_weak;
    reasons.push(`nombre: ${w}`);
  }
  w = nm.first("name_negative", name);
  if (w) {
    score += pts.name_negative;
    reasons.push(`resta: ${w}`);
  }
  const legacy = own(HORROR.legacy_genres, g.genre) ? HORROR.legacy_genres[g.genre] : null;
  if (legacy) {
    score += legacy;
    reasons.push(`g\xE9nero del creador: ${g.genre}`);
  }
  const genre = `${g.genre_l1 || ""}/${g.genre_l2 || ""}`;
  if (own(HORROR.genres, genre)) {
    score += HORROR.genres[genre];
    reasons.push(`g\xE9nero: ${genre.replace(/\/+$/, "")}`);
  }
  const desc = (g.description || "").toLowerCase();
  const dm = fast ? scanMatcher(DESC_SCAN, desc) : refMatcher;
  const ds = dm.all("desc_strong", desc);
  if (ds.length) {
    score += Math.min(ds.length * pts.desc_strong, pts.desc_strong_cap);
    reasons.push("descripci\xF3n: " + ds.slice(0, 3).join(", "));
  }
  const dw = dm.all("desc_weak", desc);
  if (dw.length) {
    score += Math.min(dw.length * pts.desc_weak, pts.desc_weak_cap);
    if (!ds.length) reasons.push("descripci\xF3n: " + dw.slice(0, 2).join(", "));
  }
  const strong = Boolean(hit || tag || ds.length || legacy);
  return { horror: score >= HORROR.threshold && strong, score, reasons };
}
__name(classifyHorror, "classifyHorror");

// src/metrics.js
var ACTIVE_DAYS = 2;
var SPARK_DAYS = 21;
var EVENT_DAYS_WINDOW = 30;
var TRENDING_MAX = 12;
var ROBLOX_SORT_POINTS = { "up-and-coming": 15, "top-trending": 10 };
var ROBLOX_SORT_LABELS = { "up-and-coming": "Roblox: Up-and-Coming", "top-trending": "Roblox: Top Trending" };
var MIN = 6e7;
var DAY_US = 864e8;
var DAY_MS = 864e5;
function pyRound0(x) {
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
__name(pyRound0, "pyRound0");
var P10 = [1, 10, 100, 1e3];
function pyRound(x, nd) {
  const p = P10[nd], y = x * p;
  const f = Math.floor(y), d = y - f;
  if (Math.abs(d - 0.5) > 1e-6 && Math.abs(y) < 1e9) return (d < 0.5 ? f : f + 1) / p;
  const q = x * 2 ** (nd + 1);
  if (Number.isInteger(q) && q % 2 !== 0) return (f % 2 === 0 ? f : f + 1) / p;
  return Number(x.toFixed(nd));
}
__name(pyRound, "pyRound");
var fmt0 = /* @__PURE__ */ __name((x) => String(pyRound0(x)), "fmt0");
var clip = /* @__PURE__ */ __name((x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x)), "clip");
function pct(nw, old) {
  if (nw == null || !old) return null;
  return pyRound((nw - old) * 100 / old, 1);
}
__name(pct, "pct");
var BUF = new Float64Array(64);
function bufFor(n) {
  if (BUF.length < n) BUF = new Float64Array(Math.max(n, BUF.length * 2));
  return BUF;
}
__name(bufFor, "bufFor");
function medianBuf(buf, n) {
  for (let i = 1; i < n; i++) {
    const v = buf[i];
    let j = i - 1;
    while (j >= 0 && buf[j] > v) {
      buf[j + 1] = buf[j];
      j--;
    }
    buf[j + 1] = v;
  }
  const h2 = n >> 1;
  return n % 2 ? buf[h2] : (buf[h2 - 1] + buf[h2]) / 2;
}
__name(medianBuf, "medianBuf");
function medianRange(arr, lo, hi) {
  const n = hi - lo;
  if (n === 1) return arr[lo];
  if (n === 2) return (arr[lo] + arr[lo + 1]) / 2;
  if (n === 3) {
    const a = arr[lo], b = arr[lo + 1], c = arr[lo + 2];
    return a > b ? b > c ? b : a > c ? c : a : a > c ? a : b > c ? c : b;
  }
  const buf = bufFor(n);
  for (let i = 0; i < n; i++) buf[i] = arr[lo + i];
  return medianBuf(buf, n);
}
__name(medianRange, "medianRange");
function dayNum(s) {
  return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY_MS;
}
__name(dayNum, "dayNum");
function isoDate2(dn) {
  return new Date(dn * DAY_MS).toISOString().slice(0, 10);
}
__name(isoDate2, "isoDate");
function isoUs(s) {
  if (!s) return null;
  const ms = Date.parse(s);
  if (ms !== ms) return null;
  const dot = s.indexOf(".", 19);
  if (dot < 0) return ms * 1e3;
  let us = 0, i = dot + 1;
  while (i < dot + 4 && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) i++;
  if (i < dot + 4) return ms * 1e3;
  for (let k = 0; k < 3; k++, i++) {
    const c = s.charCodeAt(i) - 48;
    if (!(c >= 0 && c <= 9)) {
      for (; k < 3; k++) us *= 10;
      break;
    }
    us = us * 10 + c;
  }
  return ms * 1e3 + us;
}
__name(isoUs, "isoUs");
function toUs(now) {
  if (now == null) return Date.now() * 1e3;
  if (now instanceof Date) return now.getTime() * 1e3;
  if (typeof now === "number") return now * 1e3;
  const us = isoUs(String(now));
  if (us == null) throw new Error("now inv\xE1lido: " + now);
  return us;
}
__name(toUs, "toUs");
var pyIso = /* @__PURE__ */ __name((ms) => new Date(ms).toISOString().slice(0, 19) + "+00:00", "pyIso");
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
    if (!(v > base * minRatio)) continue;
    let k = 0;
    for (let j = lo; j < hi; j++) if (j !== i) b[k++] = values[j];
    const m = medianBuf(b, k);
    for (let j = 0; j < k; j++) b[j] = Math.abs(b[j] - m);
    const mad = Math.max(medianBuf(b, k) * 1.4826, m * 0.05);
    if (!(v - base > madK * mad)) continue;
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
__name(flagCore, "flagCore");
var TX = new Float64Array(8);
var TY = new Float64Array(8);
var LAST8 = new Float64Array(8);
var LAST8X = new Float64Array(8);
var MAX7 = new Float64Array(8);
var SAME = new Float64Array(4);
function theilSen(vals, xs, k) {
  let n = 0;
  for (let i = 0; i < k; i++) {
    const v = vals[i];
    if (v && v > 0) {
      TX[n] = xs[i];
      TY[n] = Math.log(v);
      n++;
    }
  }
  if (n < 4) return null;
  const b = bufFor(n * (n - 1) / 2);
  let m = 0;
  for (let a = 0; a < n; a++) for (let c = a + 1; c < n; c++) b[m++] = (TY[c] - TY[a]) / (TX[c] - TX[a]);
  return pyRound((Math.exp(medianBuf(b, m)) - 1) * 100, 1);
}
__name(theilSen, "theilSen");
function gameMetrics(g, ctx) {
  const d = g.d || [], s = g.s || [];
  const n = d.length;
  const values = new Array(n), dn = new Array(n);
  for (let i = 0; i < n; i++) {
    values[i] = d[i][1];
    dn[i] = dayNum(d[i][0]);
  }
  const events = flagCore(values, dn);
  let nc = n;
  while (nc > 0 && dn[nc - 1] >= ctx.today) nc--;
  const D = ctx.today - 1;
  const ns = s.length;
  const lastTs = ns ? s[ns - 1][0] : null;
  const nowPlayers = ns ? s[ns - 1][1] : n ? values[n - 1] : 0;
  const ref = lastTs ?? ctx.nowMin;
  const b = bufFor(ns);
  let n24 = 0;
  for (let i = 0; i < ns; i++) {
    const t = s[i][0];
    if (t >= ref - 1440 && t < ref + 1) b[n24++] = s[i][1];
  }
  let typical = n24 ? medianBuf(b, n24) : null;
  const tIdx = nc ? nc - 1 : n - 1;
  if (n24 < 2) typical = n ? values[tIdx] : nowPlayers;
  let nprev = 0;
  for (let i = 0; i < ns; i++) {
    const t = s[i][0];
    if (t >= ref - 2880 && t < ref - 1440) b[nprev++] = s[i][1];
  }
  let prev = nprev ? medianBuf(b, nprev) : null;
  if (nprev < 2) {
    prev = null;
    const from = n24 < 2 ? tIdx - 1 : nc - 1;
    const anchor = n24 < 2 && tIdx >= 0 ? dn[tIdx] : D + 1;
    for (let i = from; i >= 0 && anchor - dn[i] <= 7; i--) if (!events[i]) {
      prev = values[i];
      break;
    }
  }
  const growth24 = pct(typical, prev);
  let sum7 = 0, c7 = 0, sum3 = 0, c3 = 0, sumW = 0, cW = 0, evDays = 0;
  let n8 = 0, nmax = 0, nsame = 0, vz = -1, va = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (va < 0 && d[i][5]) {
      if (vz < 0) vz = i;
      else va = i;
    }
    if (i >= nc) continue;
    const k = D - dn[i] + 1;
    if (k > 30 && va >= 0) break;
    if (events[i]) {
      if (k <= EVENT_DAYS_WINDOW) evDays++;
      continue;
    }
    const v = values[i];
    if (k <= 7) {
      sum7 += v;
      c7++;
      MAX7[nmax++] = d[i][3] ?? v;
    }
    if (k <= 3) {
      sum3 += v;
      c3++;
    }
    if (k >= 7 && k <= 10) {
      sumW += v;
      cW++;
    }
    if (k <= 8) {
      LAST8[n8] = v;
      LAST8X[n8] = dn[i];
      n8++;
    }
    const back = ctx.today - dn[i];
    if (back % 7 === 0 && back <= 21 && nsame < 3) SAME[nsame++] = d[i][3] ?? v;
  }
  const avg7 = c7 ? pyRound0(sum7 / c7) : typical;
  const growth7 = c3 && cW ? pct(sum3 / c3, sumW / cW) : null;
  for (let a = 0, z = n8 - 1; a < z; a++, z--) {
    let t = LAST8[a];
    LAST8[a] = LAST8[z];
    LAST8[z] = t;
    t = LAST8X[a];
    LAST8X[a] = LAST8X[z];
    LAST8X[z] = t;
  }
  const trend = theilSen(LAST8, LAST8X, n8);
  const baseMax = nmax >= 4 ? medianBuf(MAX7, nmax) : null;
  const sameMax = nsame ? medianBuf(SAME, nsame) : null;
  const spikeNow = !!(baseMax && nowPlayers >= baseMax * EVENTS.spike_now_ratio && (sameMax === null || nowPlayers >= sameMax * EVENTS.spike_weekday_ratio));
  const visits = vz >= 0 ? d[vz][5] : null;
  let visitsDay = null;
  let i1 = ns - 1;
  while (i1 >= 0 && !s[i1][2]) i1--;
  if (i1 >= 0) {
    const t1 = s[i1][0], v1 = s[i1][2];
    for (let i = i1 - 1; i >= 0; i--) {
      if (s[i][2] && s[i][0] <= t1 - 1200) {
        visitsDay = pyRound0((v1 - s[i][2]) * 86400 / Math.max((t1 - s[i][0]) * 60, 1));
        break;
      }
    }
  }
  if (visitsDay === null && va >= 0) {
    const gap = dn[vz] - dn[va] || 1;
    visitsDay = pyRound0((d[vz][5] - d[va][5]) / gap);
  }
  if (visitsDay !== null && visitsDay < 0) visitsDay = null;
  const fav = g.favorites || null;
  const up = g.up ?? null, down = g.down ?? null;
  const likeRatio = up !== null && down !== null && up + down > 0 ? pyRound(up * 100 / (up + down), 1) : null;
  const created = isoUs(g.created), updated = isoUs(g.updated), firstSeen = isoUs(g.first_seen);
  let seen = g.first_day ? dayNum(g.first_day) : n ? dn[0] : null;
  if (firstSeen !== null) {
    const fs = Math.floor(firstSeen / DAY_US);
    if (seen === null || fs < seen) seen = fs;
  }
  const firstSeenDays = seen !== null ? ctx.today - seen : null;
  const trusted = seen !== null && seen >= ctx.scanStart + 2;
  const last = n ? d[n - 1] : null;
  return {
    players: nowPlayers,
    _lastTs: lastTs,
    // players_ts se formatea en summary()
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
    _values: values
  };
}
__name(gameMetrics, "gameMetrics");
function status(m) {
  const t = m.trend;
  let g = m.growth_24h;
  if (g === null && t === null) return "new";
  g = g || 0;
  if (t !== null && t >= 15 || g >= 30 && (t === null || t >= 0)) return "hot";
  if (t !== null && t >= 5 || g >= 10 && (t === null || t >= -1)) return "up";
  if (t !== null && t <= -8 || g <= -20 && (t === null || t <= 0)) return "down2";
  if (t !== null && t <= -3 || g <= -7 && (t === null || t <= 1)) return "down";
  return "flat";
}
__name(status, "status");
var LOG_SIZE = Math.log10(1e6 / 300);
function momentumScore(m) {
  const t = m.trend || 0, g24 = m.growth_24h || 0, g7 = m.growth_7d || 0;
  const size = clip(Math.log10(Math.max(m.typical || 1, 1) / 300) / LOG_SIZE);
  let s = 35 * clip(t / 20) + 25 * clip(g24 / 50) + 20 * clip(g7 / 100) + 20 * size;
  if (m.spike_now && t < 5) s *= 0.7;
  return pyRound0(s);
}
__name(momentumScore, "momentumScore");
var LOG30 = Math.log10(30);
function emerging(m, sorts) {
  return emergingCore(m, sorts, true);
}
__name(emerging, "emerging");
function emergingCore(m, sorts, strict) {
  const cfg = EMERGING;
  const visits = m.visits, typical = m.typical || 0;
  if (typical < cfg.min_players || visits !== null && visits > cfg.max_visits) return null;
  if (visits === null && strict) return null;
  const t = m.trend, g24 = m.growth_24h, g7 = m.growth_7d;
  let sRoblox = 0;
  const rReasons = [];
  if (sorts) {
    for (const k of cfg.roblox_sorts || []) {
      if (sorts[k] != null) {
        sRoblox = Math.max(sRoblox, ROBLOX_SORT_POINTS[k] ?? 10);
        rReasons.push(ROBLOX_SORT_LABELS[k] || "Roblox: " + k);
      }
    }
  }
  const growing = t !== null && t > 0 || g24 !== null && g24 > 0 || g7 !== null && g7 > 0 || sRoblox > 0 && t === null && g24 === null && g7 === null;
  const fresh = m.fresh;
  const weak = !growing && !fresh || m.status === "down" || m.status === "down2";
  if (weak && strict) return null;
  const reasons = rReasons;
  const vg = m.visits_growth || 0;
  const sVisits = 30 * clip(vg / 12);
  if (vg >= 3) reasons.push(`visitas +${fmt0(vg)}%/d\xEDa`);
  const growth2 = Math.max(t || 0, (g24 || 0) / 2, (g7 || 0) / 5);
  const sGrowth = 25 * clip(growth2 / 20);
  if (t && t >= 5) reasons.push(`tendencia +${fmt0(t)}%/d\xEDa`);
  else if (g24 && g24 >= 15) reasons.push(`+${fmt0(g24)}% en 24h`);
  const age = m.age_days;
  let sYoung = age !== null ? 20 * clip(1 - age / cfg.max_age_days) : 0;
  if (age !== null && age <= 30) reasons.push(`creado hace ${age} d\xEDas`);
  if (fresh) {
    sYoung = Math.max(sYoung, 8);
    reasons.push("reci\xE9n detectado");
  }
  const sSize = 15 * clip(Math.log10(typical / cfg.min_players) / LOG30);
  const lr = m.like_ratio;
  const sLike = 10 * clip(((lr || 0) - 75) / 20);
  if (lr && lr >= 90) reasons.push(`${fmt0(lr)}% likes`);
  if (visits !== null && visits < 2e6) reasons.push("menos de 2M visitas");
  let score = Math.min(100, pyRound0(sVisits + sGrowth + sYoung + sSize + sLike + sRoblox));
  if (m.spike_now && (t || 0) < 5) score = pyRound0(score * 0.8);
  if (!strict) return [weak ? score / 2 : score, reasons];
  if (score < cfg.min_score) return null;
  return [score, reasons.slice(0, 4)];
}
__name(emergingCore, "emergingCore");
function radarScore(g, { now } = {}) {
  const ctx = radarCtx(now);
  const d = g.d;
  if (!d || !d.length || d[d.length - 1][0] < ctx.activeCut) return null;
  const m = gameMetrics(g, ctx);
  m.status = status(m);
  const c = emergingCore(m, g.sorts, false);
  return [m.typical || 0, c ? c[0] : null];
}
__name(radarScore, "radarScore");
var RADAR_CTX = null;
function radarCtx(now) {
  const nowUs = toUs(now);
  if (RADAR_CTX && RADAR_CTX.nowUs === nowUs) return RADAR_CTX;
  const today = Math.floor(nowUs / DAY_US);
  RADAR_CTX = {
    nowUs,
    nowMin: nowUs / MIN,
    today,
    todayIso: isoDate2(today),
    scanStart: dayNum(SCAN_START),
    activeCut: isoDate2(Math.floor((nowUs - ACTIVE_DAYS * DAY_US) / DAY_US))
  };
  return RADAR_CTX;
}
__name(radarCtx, "radarCtx");
function quickMetrics(games, { now } = {}) {
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
__name(quickMetrics, "quickMetrics");
var isRising = /* @__PURE__ */ __name((m) => (m.status === "hot" || m.status === "up") && (m.trend === null || m.trend > 0) && !(m.spike_now && (m.trend || 0) < 5), "isRising");
function buildDashboard(exportData, { now } = {}) {
  const nowUs = toUs(now);
  const nowMs = Math.floor(nowUs / 1e3);
  const today = Math.floor(nowUs / DAY_US);
  const ctx = {
    nowUs,
    nowMin: nowUs / MIN,
    today,
    todayIso: isoDate2(today),
    scanStart: dayNum(SCAN_START)
  };
  const activeCut = isoDate2(Math.floor((nowUs - ACTIVE_DAYS * DAY_US) / DAY_US));
  const list = [];
  for (const g of exportData.games || []) {
    const d = g.d;
    if (!d || !d.length || d[d.length - 1][0] < activeCut) continue;
    const m = gameMetrics(g, ctx);
    m.status = status(m);
    m.momentum = momentumScore(m);
    const em = emerging(m, g.sorts);
    list.push({ g, m, horror: !!g.horror, em, firstDay: g.first_day || d[0][0] });
  }
  const byOrder = /* @__PURE__ */ __name((a, b) => a.firstDay < b.firstDay ? -1 : a.firstDay > b.firstDay ? 1 : a.g.id - b.g.id, "byOrder");
  const categories = {};
  const used = /* @__PURE__ */ new Set();
  for (const [key, cfg] of Object.entries(CATEGORIES)) {
    const belongs = /* @__PURE__ */ __name((x) => cfg.classifier === "all" || x.horror, "belongs");
    const ids = list.filter((x) => belongs(x) && (x.m.typical || 0) >= cfg.min_players);
    ids.sort((a, b) => (b.m.typical || 0) - (a.m.typical || 0) || byOrder(a, b));
    const emerg = list.filter((x) => belongs(x) && x.em);
    emerg.sort((a, b) => b.em[0] - a.em[0] || byOrder(a, b));
    emerg.length = Math.min(emerg.length, EMERGING.max_results);
    const rising = /* @__PURE__ */ __name(({ m }) => isRising(m), "rising");
    const trending = ids.filter(rising).sort((a, b) => b.m.momentum - a.m.momentum).slice(0, TRENDING_MAX);
    let players = 0, up = 0, down = 0, events = 0, new7 = 0;
    for (const { m } of ids) {
      players += m.typical || 0;
      if (m.status === "hot" || m.status === "up") up++;
      if (m.status === "down" || m.status === "down2") down++;
      if (m.spike_now) events++;
      if (m.new_week) new7++;
    }
    categories[key] = {
      label: cfg.label,
      icon: cfg.icon ?? "\u{1F3AE}",
      min_players: cfg.min_players,
      ids: ids.map((x) => x.g.id),
      top: ids.slice(0, SELECTION.top).map((x) => x.g.id),
      emerging: emerg.map((x) => x.g.id),
      trending: trending.map((x) => x.g.id),
      stats: { games: ids.length, players, rising: up, falling: down, events, new_7d: new7 }
    };
    for (const x of ids) used.add(x);
    for (const x of emerg) used.add(x);
  }
  const games = {};
  for (const x of [...used].sort((a, b) => a.g.id - b.g.id)) games[String(x.g.id)] = summary(x);
  return {
    updated_at: pyIso(nowMs),
    last_sample: exportData.last_sample ?? null,
    samples_24h: exportData.samples_24h ?? 0,
    track_min_players: TRACK_MIN_PLAYERS,
    emerging_max_visits: EMERGING.max_visits,
    categories,
    games
  };
}
__name(buildDashboard, "buildDashboard");
function summary({ g, m, em }) {
  const [title, tags] = cleanTitle(g.name || "");
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
    players_ts: m._lastTs !== null ? pyIso(m._lastTs * 6e4) : null,
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
    roblox_sorts: g.sorts || {}
  };
}
__name(summary, "summary");

// src/telegram.js
var TELEGRAM_MAX_FETCH = 50;
var CAPTION_LIMIT = 1024;
var STATE_KEY = "telegram";
var THUMBS_API = "https://thumbnails.roblox.com/v1/games/multiget/thumbnails";
var DAYS = ["lun", "mar", "mi\xE9", "jue", "vie", "s\xE1b", "dom"];
var DAY_MS2 = 864e5;
var DASHBOARD_URL = TELEGRAM.dashboard_url;
function h(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
__name(h, "h");
function pyFixed(x, d) {
  if (Object.is(x, -0)) return "-" + 0 .toFixed(d);
  const q = x * 2 ** (d + 1);
  if (Number.isInteger(q) && q % 2 !== 0 && Math.abs(q) < 2 ** 52) {
    const y = x * 10 ** d, f = Math.floor(y);
    const n = f % 2 === 0 ? f : f + 1;
    const s = (n / 10 ** d).toFixed(d);
    return x < 0 && !s.startsWith("-") ? "-" + s : s;
  }
  return x.toFixed(d);
}
__name(pyFixed, "pyFixed");
function num(n) {
  if (n === null || n === void 0) return "\u2014";
  for (const [div, suf] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
    if (n >= div) {
      const v = n / div;
      return (v >= 100 ? pyFixed(v, 0) : pyFixed(v, 1)) + suf;
    }
  }
  return String(Math.trunc(n));
}
__name(num, "num");
function pct2(p) {
  if (p === null || p === void 0) return "\u2014";
  const s = pyFixed(p, 0);
  return (s.startsWith("-") ? s : "+" + s) + "%";
}
__name(pct2, "pct");
function short(title) {
  title = title || "?";
  if (pyLen(title) <= TELEGRAM.title_chars) return title;
  return pyRstrip(Array.from(title).slice(0, TELEGRAM.title_chars - 1).join("")) + "\u2026";
}
__name(short, "short");
var pyStr = /* @__PURE__ */ __name((v) => v === null || v === void 0 ? "None" : v === true ? "True" : v === false ? "False" : String(v), "pyStr");
var gameLink = /* @__PURE__ */ __name((g) => `<a href="https://www.roblox.com/games/${pyStr(g.place_id)}">${h(short(g.title))}</a>`, "gameLink");
var cardLink = /* @__PURE__ */ __name((key, g, text2) => `<a href="${DASHBOARD_URL}#cat=${key}&amp;game=${pyStr(g.id)}">${text2}</a>`, "cardLink");
function growth(g, arrow = false) {
  const t = g.trend ?? null, g24 = g.growth_24h ?? null;
  let value, unit;
  if (t !== null && (Math.abs(t) >= 2 || g24 === null)) [value, unit] = [t, "/d\xEDa"];
  else if (g24 !== null) [value, unit] = [g24, " 24h"];
  else return "\u23F3 midiendo";
  const icon = arrow ? value >= 0 ? "\u{1F4C8} " : "\u{1F4C9} " : "";
  return `${icon}${pct2(value)}${unit}`;
}
__name(growth, "growth");
function entry(i, g, extra = [], medals = true) {
  const mark = medals ? { 1: "\u{1F947}", 2: "\u{1F948}", 3: "\u{1F949}" }[i] ?? `${i}.` : `${i}.`;
  const stats = [`\u{1F465} ${num(g.typical)}`, growth(g), ...extra].join(" \xB7 ");
  const flag = g.spike_now ? " \u{1F389}" : "";
  return `${mark} ${gameLink(g)}${flag}
      \u2514 ${stats}`;
}
__name(entry, "entry");
function todayLabel(now) {
  const d = toDate(now);
  const dd = String(d.getUTCDate()).padStart(2, "0"), mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${DAYS[(d.getUTCDay() + 6) % 7]} ${dd}/${mm}`;
}
__name(todayLabel, "todayLabel");
function dailyReport(key, cat, games, now) {
  const s = cat.stats, n = TELEGRAM.list_size;
  const emerging2 = cat.emerging.slice(0, n).map((u) => games[String(u)]);
  const shown = new Set(emerging2.map((g) => g.id));
  const trending = cat.trending.map((u) => games[String(u)]).filter((g) => !shown.has(g.id)).slice(0, n);
  const lines = [
    `${cat.icon} <b>${h(cat.label.toUpperCase())}</b> \xB7 ${todayLabel(now)}`,
    // Sin cifras fiables de suben/bajan (export reducido sin ellas) se omiten:
    // mejor nada que un número contado solo sobre los candidatos
    s.rising == null || s.falling == null ? `<i>${s.games} juegos</i>` : `<i>${s.games} juegos \xB7 \u{1F4C8} ${s.rising} suben \xB7 \u{1F4C9} ${s.falling} bajan</i>`
  ];
  if (emerging2.length) {
    lines.push("", "\u{1F331} <b>Emergentes</b>");
    emerging2.forEach((g, i) => lines.push(entry(i + 1, g, [`\u2B50${g.emerging}`])));
  }
  if (trending.length) {
    lines.push("", "\u{1F525} <b>En tendencia</b>");
    trending.forEach((g, i) => lines.push(entry(i + 1, g, [], false)));
  }
  if (!emerging2.length && !trending.length) lines.push("", "Hoy no hay nada despegando. \u{1F634}");
  lines.push("", `\u{1F4CA} <a href="${DASHBOARD_URL}#cat=${key}">Abrir dashboard</a>`);
  const top = emerging2[0] || trending[0] || null;
  return [lines.join("\n"), top?.id ?? null];
}
__name(dailyReport, "dailyReport");
function weeklyReport(key, cat, games, now) {
  const listed = cat.ids.map((u) => games[String(u)]).filter((g) => g.growth_7d !== null && g.growth_7d !== void 0);
  const up = [...listed].sort((a, b) => b.growth_7d - a.growth_7d).slice(0, TELEGRAM.list_size);
  const down = listed.filter((g) => g.growth_7d < 0).sort((a, b) => a.growth_7d - b.growth_7d).slice(0, 3);
  const lines = [
    `\u{1F4C5} ${cat.icon} <b>${h(cat.label.toUpperCase())} \xB7 LA SEMANA</b>`,
    `<i>hasta el ${todayLabel(now)}</i>`,
    "",
    "\u{1F680} <b>Lo que m\xE1s ha crecido</b>",
    ...up.map((g, i) => entry(i + 1, g, [`7d ${pct2(g.growth_7d)}`]))
  ];
  if (down.length) {
    lines.push(
      "",
      "\u{1F9CA} <b>Lo que m\xE1s ha ca\xEDdo</b>",
      ...down.map((g, i) => entry(i + 1, g, [`7d ${pct2(g.growth_7d)}`], false))
    );
  }
  lines.push("", `\u{1F4CA} <a href="${DASHBOARD_URL}#cat=${key}">Abrir dashboard</a>`);
  return [lines.join("\n"), up[0]?.id ?? null];
}
__name(weeklyReport, "weeklyReport");
function alertMessage(key, cat, g) {
  const creator = h(g.creator || "\u2014") + (g.creator_verified ? " \u2714" : "");
  const genre = h(g.subgenre || g.genre || "");
  const lines = [
    `\u{1F331} <b>NUEVO EMERGENTE</b> \xB7 ${cat.icon} ${h(cat.label)}`,
    "",
    `<b>${h(g.title)}</b>`,
    `<i>${creator}${genre ? " \xB7 " + genre : ""}</i>`,
    "",
    `\u{1F465} <b>${num(g.typical)}</b> jugadores`,
    growth(g, true) + (growth(g).endsWith("/d\xEDa") && g.growth_24h != null ? ` \xB7 ${pct2(g.growth_24h)} en 24h` : ""),
    `\u{1F441} ${num(g.visits)} visitas` + (g.visits_day ? ` \xB7 +${num(g.visits_day)}/d\xEDa` : "")
  ];
  const extra = [];
  if (g.like_ratio != null) extra.push(`\u{1F44D} ${pyFixed(g.like_ratio, 0)}%`);
  if (g.age_days != null) extra.push(`\u{1F5D3} creado hace ${g.age_days} d\xEDas`);
  if (extra.length) lines.push(extra.join(" \xB7 "));
  lines.push(
    "",
    `\u2B50 <b>${g.emerging}/100</b> \u2014 <i>${h((g.emerging_reasons || []).join(", "))}</i>`,
    "",
    `\u25B6\uFE0F <a href="https://www.roblox.com/games/${pyStr(g.place_id)}">Jugar</a>   \xB7   \u{1F4CA} ${cardLink(key, g, "Ver ficha")}`
  );
  return [lines.join("\n"), g.id ?? null];
}
__name(alertMessage, "alertMessage");
function visibleLen(message) {
  const text2 = message.replace(/<[^>]+>/g, "").replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (m, dec, hex, name) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[name];
  });
  return pyLen(text2);
}
__name(visibleLen, "visibleLen");
function toDate(now) {
  if (now instanceof Date) return now;
  if (now === null || now === void 0) return /* @__PURE__ */ new Date();
  return new Date(typeof now === "number" ? now : String(now));
}
__name(toDate, "toDate");
var isoDay = /* @__PURE__ */ __name((d) => d.toISOString().slice(0, 10), "isoDay");
function isoWeek(now) {
  const d = toDate(now);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow + 3);
  const year = t.getUTCFullYear();
  const week = 1 + Math.floor((t - Date.UTC(year, 0, 1)) / DAY_MS2 / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
__name(isoWeek, "isoWeek");
var PICK = {
  emerging_top: 30,
  // los N mejores emergentes de cada categoría (EMERGING.max_results + margen)
  trending_top: 18,
  // en tendencia: TRENDING_MAX (12) + margen, por categoría
  weekly_up: 8,
  // semanal: se muestran 5 y 3
  weekly_down: 6
};
var STATUS_CODE = { new: 0, flat: 1, hot: 2, up: 3, down: 4, down2: 5 };
var CATS = Object.entries(CATEGORIES);
function quickRows(games, { now } = {}) {
  const rows = [];
  for (const { g, m, em } of quickMetrics(games, { now: toDate(now) })) {
    const typ = m.typical || 0;
    let cat = 0;
    CATS.forEach(([, c], ci) => {
      if ((c.classifier === "all" || g.horror) && typ >= c.min_players) cat |= 1 << ci;
    });
    if (!cat && !em) continue;
    rows.push({
      id: g.id,
      horror: g.horror ? 1 : 0,
      typical: m.typical,
      cat,
      st: STATUS_CODE[m.status],
      rising: isRising(m) ? 1 : 0,
      momentum: m.momentum,
      g7: m.growth_7d,
      em: em ? em[0] : null
    });
  }
  return rows;
}
__name(quickRows, "quickRows");
function pickCandidates(rows) {
  const picked = /* @__PURE__ */ new Set();
  const counts = {};
  const UP = [STATUS_CODE.hot, STATUS_CODE.up], DOWN = [STATUS_CODE.down, STATUS_CODE.down2];
  CATS.forEach(([key, cfg], ci) => {
    const bit = 1 << ci;
    const ids = rows.filter((r) => r.cat & bit);
    let players = 0, rising = 0, falling = 0;
    for (const r of ids) {
      players += r.typical || 0;
      if (UP.includes(r.st)) rising++;
      if (DOWN.includes(r.st)) falling++;
    }
    counts[key] = { games: ids.length, players, rising, falling };
    const belongs = cfg.classifier === "all" ? () => true : (r) => r.horror;
    rows.filter((r) => belongs(r) && r.em !== null).sort((a, b) => b.em - a.em).slice(0, PICK.emerging_top).forEach((r) => picked.add(r.id));
    ids.filter((r) => r.rising).sort((a, b) => b.momentum - a.momentum).slice(0, PICK.trending_top).forEach((r) => picked.add(r.id));
    const w = ids.filter((r) => r.g7 !== null);
    [...w].sort((a, b) => b.g7 - a.g7).slice(0, PICK.weekly_up).forEach((r) => picked.add(r.id));
    w.filter((r) => r.g7 < 0).sort((a, b) => a.g7 - b.g7).slice(0, PICK.weekly_down).forEach((r) => picked.add(r.id));
  });
  return { counts, ids: picked };
}
__name(pickCandidates, "pickCandidates");
function telegramCandidates(exportData, { now } = {}) {
  const all = exportData.games || [];
  const { counts, ids } = pickCandidates(quickRows(all, { now: now ?? exportData.generated_at }));
  return reducedExport(exportData, all.filter((g) => ids.has(g.id)), counts, all.length);
}
__name(telegramCandidates, "telegramCandidates");
function reducedExport(head, games, counts, total) {
  return {
    generated_at: head.generated_at ?? null,
    last_sample: head.last_sample ?? null,
    samples_24h: head.samples_24h ?? 0,
    games,
    telegram: { counts, total, candidates: games.length }
  };
}
__name(reducedExport, "reducedExport");
var GAME_START = '{"id":';
function gameOffsets(text2) {
  const g = text2.indexOf('"games":[');
  if (g < 0) throw new Error("export sin games");
  const out = [];
  let i = text2.indexOf(GAME_START, g);
  while (i >= 0) {
    out.push(i);
    i = text2.indexOf("}," + GAME_START, i + 1);
    if (i >= 0) i += 2;
  }
  if (!out.length && !/"games":\[\s*\]/.test(text2)) {
    throw new Error('export con un formato inesperado: cada juego debe empezar por {"id": sin espacios');
  }
  out.push(text2.lastIndexOf("]"));
  return out;
}
__name(gameOffsets, "gameOffsets");
function exportHead(text2) {
  const pick = /* @__PURE__ */ __name((re) => {
    const m = re.exec(text2);
    return m ? JSON.parse(m[1]) : null;
  }, "pick");
  return {
    generated_at: pick(/"generated_at":("[^"]*"|null)/),
    last_sample: pick(/"last_sample":("[^"]*"|null)/),
    samples_24h: pick(/"samples_24h":(\d+|null)/) ?? 0
  };
}
__name(exportHead, "exportHead");
function parseSlice(text2, offs, a, b) {
  if (a >= b) return [];
  let end = offs[b];
  const slice = text2.slice(offs[a], end).replace(/,\s*$/, "");
  return JSON.parse("[" + slice + "]");
}
__name(parseSlice, "parseSlice");
function telegramScanText(text2, { now, part = 0, parts = 1 } = {}) {
  const offs = gameOffsets(text2), n = offs.length - 1;
  const a = Math.floor(n * part / parts), b = Math.floor(n * (part + 1) / parts);
  const games = parseSlice(text2, offs, a, b);
  return quickRows(games, { now: now ?? exportHead(text2).generated_at });
}
__name(telegramScanText, "telegramScanText");
function headerCounts(exportData) {
  if (exportData?.telegram?.counts) return exportData.telegram.counts;
  const totals = exportData?.totals;
  if (!totals || typeof totals !== "object") return null;
  const out = {};
  for (const [key, v] of Object.entries(totals)) {
    const c = typeof v === "number" ? { games: v } : { ...v || {} };
    if (c.rising == null || c.falling == null) {
      c.rising = null;
      c.falling = null;
    }
    out[key] = c;
  }
  return out;
}
__name(headerCounts, "headerCounts");
function applyCounts(dash, counts) {
  if (!counts) return;
  for (const [key, c] of Object.entries(counts)) {
    const cat = dash.categories?.[key];
    if (!cat) continue;
    const st = { ...cat.stats };
    for (const [k, v] of Object.entries(c)) if (v !== void 0) st[k] = v;
    cat.stats = st;
  }
}
__name(applyCounts, "applyCounts");
function chatFor(envChat, migrated) {
  if (envChat && migrated?.to && String(migrated.from) === String(envChat)) return String(migrated.to);
  return envChat;
}
__name(chatFor, "chatFor");
function makeClient({ env, fetchImpl, log, maxFetch, migrated }) {
  const token = env?.TELEGRAM_TOKEN;
  let chat = chatFor(env?.TELEGRAM_CHAT_ID, migrated);
  const counter = { used: 0 };
  const moved = { to: null };
  async function call(url, init, timeoutMs) {
    if (counter.used >= maxFetch) throw new Error(`tope de ${maxFetch} peticiones externas`);
    counter.used++;
    return fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  }
  __name(call, "call");
  async function thumbUrl(uid) {
    if (!uid) return null;
    try {
      const q = new URLSearchParams({
        universeIds: String(uid),
        countPerUniverse: "1",
        size: "768x432",
        format: "Jpeg",
        defaults: "true"
      });
      const r = await call(`${THUMBS_API}?${q}`, {}, 15e3);
      const j = await r.json();
      const shots = ((j?.data || [{}])[0] || {}).thumbnails || [];
      return shots.find((s) => s.state === "Completed")?.imageUrl ?? null;
    } catch {
      return null;
    }
  }
  __name(thumbUrl, "thumbUrl");
  async function post(method, body, timeoutMs, retry = true) {
    let res;
    try {
      const r = await call(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, chat_id: chat })
      }, timeoutMs);
      res = { ok: r.ok, status: r.status, text: r.ok ? "" : await r.text().catch(() => "") };
    } catch (e) {
      return { ok: false, status: 0, text: String(e?.name === "TimeoutError" ? "timeout" : e?.message || e) };
    }
    const to = res.ok ? null : migrateTo(res.text);
    if (to && retry && String(to) !== String(chat)) {
      log(`  el grupo ahora es un supergrupo: se env\xEDa al id nuevo ${to}`);
      chat = String(to);
      moved.to = chat;
      return post(method, body, timeoutMs, false);
    }
    return res;
  }
  __name(post, "post");
  async function send(message, gameId) {
    if (!token || !chat) {
      log(`--- mensaje (no enviado)${gameId ? ` \xB7 foto del juego ${gameId}` : ""} ---`);
      log(message);
      return true;
    }
    const photo = visibleLen(message) <= CAPTION_LIMIT ? await thumbUrl(gameId) : null;
    if (photo) {
      const r2 = await post("sendPhoto", { photo, caption: message, parse_mode: "HTML" }, 2e4);
      if (r2.ok) return true;
      log(`  foto rechazada (${r2.status}), se env\xEDa como texto`);
    }
    const r = await post("sendMessage", {
      text: message,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true }
    }, 15e3);
    if (!r.ok) log(`\u2717 Telegram ${r.status}: ${r.text}`);
    return r.ok;
  }
  __name(send, "send");
  return { send, counter, moved, hasCredentials: Boolean(token && chat) };
}
__name(makeClient, "makeClient");
function migrateTo(text2) {
  try {
    const id = JSON.parse(text2)?.parameters?.migrate_to_chat_id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}
__name(migrateTo, "migrateTo");
async function runTelegram({
  env,
  exportData,
  now,
  getState: getState2,
  setState: setState2,
  force,
  fetch: fetchImpl = globalThis.fetch,
  buildDashboard: buildDashboard2 = buildDashboard,
  log = /* @__PURE__ */ __name((...a) => console.log(...a), "log"),
  maxFetch = TELEGRAM_MAX_FETCH,
  quickExit = true
}) {
  const nowD = toDate(now);
  const today = isoDay(nowD), week = isoWeek(nowD), hour = nowD.getUTCHours();
  const weekday = (nowD.getUTCDay() + 6) % 7;
  const reduced = exportData?.telegram || exportData?.totals ? exportData : telegramCandidates(exportData, { now: nowD });
  const loaded = getState2 ? await getState2(STATE_KEY) : null;
  const state = loaded && typeof loaded === "object" ? structuredClone(loaded) : {};
  const before = JSON.stringify(state);
  const client = makeClient({ env, fetchImpl, log, maxFetch, migrated: state.chat_migrated });
  const result = {
    credentials: client.hasCredentials,
    alerts: 0,
    daily: null,
    weekly: null,
    messages: 0,
    candidates: reduced.games?.length ?? null,
    total: reduced.telegram?.total ?? null,
    header: headerCounts(reduced) ? reduced.telegram ? "exacta" : "totals" : "candidatos"
  };
  const dueDaily = force === "daily" || hour >= TELEGRAM.report_hour_utc && state.last_daily !== today;
  const dueWeekly = force === "weekly" || weekday === 0 && hour >= TELEGRAM.report_hour_utc && state.last_weekly !== week;
  if (quickExit && !dueDaily && !dueWeekly) {
    const alerted = state.alerted || {};
    const maybe = quickRows(reduced.games || [], { now: nowD }).some((r) => r.em !== null && r.em >= TELEGRAM.alert_min_score - 5 && !(String(r.id) in alerted));
    if (!maybe) return { ...result, skipped: "sin alertas posibles", fetches: 0 };
  }
  const dash = buildDashboard2(reduced, { now: nowD });
  applyCounts(dash, headerCounts(reduced));
  const games = dash.games, cats = dash.categories;
  const save = /* @__PURE__ */ __name(async () => {
    if (!setState2 || JSON.stringify(state) === before) return;
    if (setState2.length >= 2) await setState2(STATE_KEY, state);
    else await setState2(state);
  }, "save");
  try {
    const alerted = state.alerted ||= {};
    for (const [key, cat] of Object.entries(cats)) {
      for (const uid of cat.emerging) {
        const g = games[String(uid)];
        if (g.emerging >= TELEGRAM.alert_min_score && !(String(uid) in alerted) && result.alerts < TELEGRAM.max_alerts_per_run) {
          result.messages++;
          if (await client.send(...alertMessage(key, cat, g))) {
            alerted[String(uid)] = today;
            result.alerts++;
          }
        }
      }
    }
    if (dueDaily) {
      const ok = [];
      for (const [key, cat] of Object.entries(cats)) {
        result.messages++;
        ok.push(await client.send(...dailyReport(key, cat, games, nowD)));
      }
      result.daily = ok.every(Boolean);
      if (result.daily) state.last_daily = today;
    }
    if (dueWeekly) {
      const ok = [];
      for (const [key, cat] of Object.entries(cats)) {
        result.messages++;
        ok.push(await client.send(...weeklyReport(key, cat, games, nowD)));
      }
      result.weekly = ok.every(Boolean);
      if (result.weekly) state.last_weekly = week;
    }
  } finally {
    if (client.moved.to) {
      state.chat_migrated = { from: String(env.TELEGRAM_CHAT_ID), to: client.moved.to };
      result.chat_migrated = client.moved.to;
    }
    await save();
  }
  result.fetches = client.counter.used;
  return result;
}
__name(runTelegram, "runTelegram");

// src/sampler.js
var SAMPLE_CHUNK = 400;
var META_CHUNK = 50;
var RESOLVE_CHUNK = 40;
var RESOLVE_PER_DAY = 200;
var EXPLORE_MAX_PAGES = 8;
var EXPORT_SLICE = 500;
var TG_SCAN_GAMES = 40;
var EXPORT_KEY = "data/export.json";
var TELEGRAM_KEY = "data/telegram.json";
var PART_PREFIX = "tmp/export/part-";
var TG_PART_PREFIX = "tmp/export/tg-";
var RUN_PREFIX = "tmp/run/";
var RADAR_PREFIX = "radar/";
var RADAR_KEEP_DAYS = 7;
var RADAR_MIN_PLAYERS = 150;
var RADAR_API_MAX = 400;
var RADAR_DAYS = 14;
var SELECT_SLICE = 250;
var BACKFILL_HOURS = 48;
var BACKFILL_FILES = 16;
var BACKFILL_MAX_GAMES = 150;
var RADAR_CLOSE_PARTS = 10;
var INVOCATION_BUDGET = 46;
var SEARCH_NEED = 9;
var ROLIMONS_NEED = 4;
var SAMPLE_NEED = 12;
var META_NEED = 6;
var TELEGRAM_NEED = 30;
var DAILY_TASKS = ["meta", "close", "select", "maint"];
var DAILY_TRIES = 2;
var TASK_STEP = { meta: "sample", close: "close", select: "select", maint: "maint" };
var STEP = { retries: { limit: 3, delay: "20 seconds", backoff: "exponential" }, timeout: "10 minutes" };
var STEP_ONCE = { retries: { limit: 1, delay: "30 seconds", backoff: "constant" }, timeout: "5 minutes" };
var Sampler = class extends WorkflowEntrypoint {
  static {
    __name(this, "Sampler");
  }
  async run(event, step) {
    const env = withApp(this.env);
    const db = env.DB;
    const p = event.payload || {};
    const skip = new Set(p.skip || []);
    const only = p.only ? new Set(p.only) : null;
    const want = /* @__PURE__ */ __name((name) => !skip.has(name) && (!only || only.has(name)), "want");
    const seg = p.seg || 0;
    const base = p.base || event.instanceId;
    const tmp = `${RUN_PREFIX}${base}/`;
    const inv = new Budget(INVOCATION_BUDGET);
    const sub = /* @__PURE__ */ __name((n) => new SubBudget(inv, n), "sub");
    const summary2 = p.summary || { steps: {}, errors: [] };
    summary2.steps ||= {};
    summary2.errors ||= [];
    summary2.segments = seg + 1;
    const safe = /* @__PURE__ */ __name(async (name, fn, cfg = STEP) => {
      try {
        const r = await step.do(name, cfg, fn);
        summary2.steps[name] = r?.stats ?? r ?? null;
        return r;
      } catch (e) {
        summary2.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
        return null;
      }
    }, "safe");
    const next = /* @__PURE__ */ __name(async (phase, cursor = 0) => {
      await step.do(`next-${phase}-${cursor}`, STEP, async () => {
        const id = `${base}-s${seg + 1}`;
        try {
          await env.SAMPLER.create({ id, params: { ...p, seg: seg + 1, base, init, phase, cursor, sin_intento: [...sinIntento], summary: compact(summary2) } });
        } catch (e) {
          if (!/already exists|duplicate/i.test(String(e?.message || e))) throw e;
        }
        await setState(db, "run_current", { base, seg: seg + 1, id, phase, cursor });
        return { next: id, phase, cursor };
      });
      return { ...compact(summary2), continued_in: `${base}-s${seg + 1}` };
    }, "next");
    const init = p.init || await step.do("init", STEP, async () => {
      const ms = p.now ? Date.parse(p.now) : new Date(event.timestamp || Date.now()).getTime();
      const ts2 = minuteOf(ms);
      const today2 = isoDate(ts2);
      await migrateHist(db);
      const st = await getStates(db, ["day", "meta_day", "closed_day", "search_cursor", "sel_day", "maint_day", "daily_tries"]);
      const tries = st.daily_tries?.day === today2 ? st.daily_tries : {};
      const forced = /* @__PURE__ */ __name((t) => p.daily === true || Array.isArray(p.daily) && p.daily.includes(t), "forced");
      const due = {
        meta: (st.meta_day ?? st.day) !== today2,
        // `day`: la marca de antes de meta_day
        close: !st.closed_day || st.closed_day < addDays(today2, -1),
        select: st.sel_day !== today2,
        maint: st.maint_day !== today2
      };
      const daily2 = {}, spent = [];
      for (const t of DAILY_TASKS) {
        daily2[t] = want(TASK_STEP[t]) && (forced(t) || due[t] && (tries[t] || 0) < DAILY_TRIES);
        if (due[t] && !daily2[t] && want(TASK_STEP[t])) spent.push(t);
      }
      await setState(db, "run_current", { base, seg, id: base, phase: "discover", cursor: 0 });
      return {
        ts: ts2,
        today: today2,
        daily: daily2,
        due,
        spent,
        closedDay: st.closed_day || null,
        cursor: Number(st.search_cursor) || 0,
        session: crypto.randomUUID()
      };
    });
    const { ts, today } = init;
    const sinIntento = new Set(p.sin_intento || []);
    const daily = Object.fromEntries(DAILY_TASKS.map((t) => [t, !!init.daily[t] && !sinIntento.has(t)]));
    const firstSeen = isoMinute(ts);
    summary2.ts = firstSeen;
    summary2.first_of_day = daily.meta;
    summary2.daily = daily;
    if (init.spent?.length) summary2.pendiente = init.spent;
    const tryTask = /* @__PURE__ */ __name(async (t) => {
      if (!daily[t]) return false;
      if (!init.due[t]) return true;
      if (await safe(`try-${t}`, async () => {
        await countTryStmt(db, today, t).run();
        return { task: t };
      })) return true;
      daily[t] = false;
      sinIntento.add(t);
      summary2.sin_intento = [...sinIntento];
      if (t === "meta") summary2.first_of_day = false;
      return false;
    }, "tryTask");
    const radarDays = /* @__PURE__ */ new Map();
    const radarDay = /* @__PURE__ */ __name(async (d) => {
      if (!radarDays.has(d)) radarDays.set(d, radarPrepare(await radarTexts(env.BUCKET, d)));
      return radarDays.get(d);
    }, "radarDay");
    const order = ["discover", "search", "rolimons", "resolve", "sample", "radar-api", "finalize"];
    const at = order.indexOf(p.phase || "discover");
    const reach = /* @__PURE__ */ __name((ph) => order.indexOf(ph) >= at, "reach");
    const startCursor = /* @__PURE__ */ __name((ph) => ph === (p.phase || "discover") ? p.cursor || 0 : 0, "startCursor");
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
            offsets[sortId] = firstLen;
          }
          const res = await saveExplore(db, sorts, today, firstSeen, offsets);
          return { ...res, lists: pending.length, calls: budget.used };
        });
      }
    }
    if (reach("search") && want("search")) {
      const n = Math.min(SEARCH_QUERIES_PER_RUN, SEARCH_QUERIES.length);
      for (let k = startCursor("search"); k < n; k++) {
        if (inv.left < SEARCH_NEED) return await next("search", k);
        const query = SEARCH_QUERIES[(init.cursor + k) % SEARCH_QUERIES.length];
        const source = `search:${query}`;
        if (k) await step.sleep(`pausa search-${k}`, "3 seconds");
        await safe(`search-${k}`, async () => {
          const budget = sub(SEARCH_NEED);
          const found = await fetchSearch(budget, query, { pages: SEARCH_PAGES_PER_QUERY });
          if (!found.length) throw new Error(`Search API sin resultados para "${query}"`);
          const seen = /* @__PURE__ */ new Set();
          const rows = [], hits = [];
          found.forEach(([uid, place, name, players], i) => {
            if (seen.has(uid) || (players ?? 0) < TRACK_MIN_PLAYERS) return;
            seen.add(uid);
            rows.push([uid, place, name]);
            hits.push([uid, source, i + 1]);
          });
          const res = rows.length ? await db.batch([upsertDiscoveredStmt(db, rows, source, firstSeen), sortHitsStmt(db, hits, today)]) : [];
          return { query, results: found.length, kept: rows.length, calls: budget.used, written: written(res) };
        });
      }
      await safe("search-cursor", async () => {
        const nxt = (init.cursor + n) % SEARCH_QUERIES.length;
        await setState(db, "search_cursor", nxt);
        return { next: nxt };
      });
    }
    const places = init.daily.meta && want("rolimons");
    const radarHour = new Date(ts * 6e4).getUTCHours() % RADAR_EVERY_HOURS === 0;
    if (reach("rolimons") && want("rolimons") && (places || radarHour)) {
      if (inv.left < ROLIMONS_NEED) return await next("rolimons");
      await safe("rolimons", async () => {
        const budget = sub(ROLIMONS_NEED);
        const all = await fetchRolimons(budget, RADAR_MIN_PLAYERS);
        if (!all || !all.length) throw new Error("Rolimons no devolvi\xF3 la lista");
        const [{ players, missing }, selIds] = await Promise.all([
          radarPlayers(db, all, today),
          getState(db, "sel_ids")
        ]);
        await env.BUCKET.put(`${RADAR_PREFIX}${today}/${ts}.json`, JSON.stringify(players));
        const sel = new Set(selIds || []);
        const api = missing.filter((id) => !sel.has(id)).slice(0, RADAR_API_MAX);
        await env.BUCKET.put(`${tmp}radar-api.json`, JSON.stringify(api));
        const stats = { radar: Object.keys(players).length, missing: missing.length, api: api.length, calls: budget.used };
        if (!places) return { stats };
        const list = all.filter((r) => r[2] >= TRACK_MIN_PLAYERS);
        const pids = list.map((r) => r[0]);
        const [unknown, res] = await Promise.all([
          unknownPlaces(db, pids),
          retrackPlacesStmt(db, pids).run()
        ]);
        if (res.meta?.changes) await radarStaleStmt(db).run();
        const byPid = new Map(list.map((r) => [r[0], r]));
        const todo = unknown.map((pid) => byPid.get(pid)).sort((a, b) => b[2] - a[2]).slice(0, RESOLVE_PER_DAY).map(([pid, name]) => [pid, name]);
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
          const got = await resolvePlaces(budget, part.map((r) => r[0]));
          const names = new Map(part);
          const ok = got.filter(([, uid]) => uid);
          const res = ok.length ? await db.batch([
            insertPlacesStmt(db, ok),
            upsertDiscoveredStmt(db, ok.map(([pid, uid]) => [uid, pid, names.get(pid)]), "rolimons", firstSeen),
            radarStaleStmt(db)
          ]) : [];
          return { asked: part.length, resolved: ok.length, calls: budget.used, written: written(res) };
        });
      }
    }
    if (reach("sample") && want("sample")) {
      const list = await step.do(`sample-list-${seg}`, STEP, async () => {
        const key = `${tmp}ids.json`;
        if (p.phase === "sample") {
          const o = await env.BUCKET.get(key);
          if (o) return await o.json();
        }
        const selected = await trackedIds(db, { selected: true });
        const list2 = { ids: daily.meta || !selected.length ? await trackedIds(db) : selected, sel: selected.length ? selected : null };
        await env.BUCKET.put(key, JSON.stringify(list2));
        return list2;
      });
      if (daily.meta && p.phase !== "sample") await tryTask("meta");
      const meta = daily.meta;
      const { sel } = list;
      const ids = meta ? list.ids : sel || list.ids;
      const selSet = sel ? new Set(sel) : null;
      const size = meta ? META_CHUNK : SAMPLE_CHUNK;
      const need = meta ? META_NEED : SAMPLE_NEED;
      const parts = chunks(ids, size);
      const agg = summary2.steps.sample || { games: 0, samples: 0, failed: 0, meta: 0, calls: 0, written: 0, steps: parts.length };
      for (let i = startCursor("sample"); i < parts.length; i++) {
        if (inv.left < need) {
          summary2.steps.sample = agg;
          return await next("sample", i);
        }
        const name = `sample-${i}`;
        let r = null;
        try {
          r = await step.do(name, STEP, async () => {
            const out = await sampleChunk(db, parts[i], { ts, today, meta, budget: sub(need), sel: selSet });
            if (out.votes) {
              const r2 = Array.from({ length: RADAR_CLOSE_PARTS }, () => ({}));
              for (const id in out.radar) r2[idPart(id, RADAR_CLOSE_PARTS)][id] = out.radar[id];
              await env.BUCKET.put(`${tmp}votes-${i}.json`, JSON.stringify({ v: out.votes, r: r2 }));
            }
            return { stats: out.stats };
          });
        } catch (e) {
          summary2.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
          agg.lost = (agg.lost || 0) + 1;
        }
        for (const k of Object.keys(agg)) if (k !== "steps" && k !== "lost") agg[k] += r?.stats?.[k] || 0;
      }
      summary2.steps.sample = agg;
      if (meta && (agg.lost || 0) * 2 < parts.length) {
        await safe("meta-done", async () => {
          await db.batch([setStateStmt(db, "meta_day", today), db.prepare("DELETE FROM state WHERE key = 'day'")]);
          return { day: today };
        });
      }
    }
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
    if (inv.left < TELEGRAM_NEED && want("telegram") && p.phase !== "finalize") return await next("finalize");
    const yesterday = addDays(today, -1);
    if (want("close") && (daily.close ? await tryTask("close") : daily.meta)) {
      const plan = await safe("close", async () => {
        const votes = {}, metaParts = Array.from({ length: RADAR_CLOSE_PARTS }, () => ({}));
        if (daily.meta) {
          const listed = await env.BUCKET.list({ prefix: `${tmp}votes-` });
          for (const o of listed.objects) {
            const obj = await env.BUCKET.get(o.key);
            if (!obj) continue;
            const part = await obj.json();
            Object.assign(votes, part.v);
            part.r.forEach((m, k) => Object.assign(metaParts[k], m));
          }
        }
        const oldest = addDays(today, -SAMPLE_RETENTION_DAYS);
        let from = init.closedDay ? addDays(init.closedDay, 1) : yesterday;
        if (from < oldest) from = oldest;
        const dates = [];
        for (let d = from; d <= yesterday; d = addDays(d, 1)) dates.push(d);
        const stats = { dates, votes: Object.keys(votes).length, radar_meta: metaParts.reduce((a, m) => a + Object.keys(m).length, 0) };
        if (!dates.length) {
          const rows = metaParts.flatMap((m, k) => radarDailyRows(null, m, k, RADAR_CLOSE_PARTS));
          const res2 = await db.batch([
            applyVotesStmt(db, yesterday, votes),
            ...rows.length ? [radarCloseStmt(db, yesterday, rows)] : [],
            mergeHistStmt(db, yesterday)
          ]);
          return { ...stats, written: written(res2) };
        }
        if (stats.radar_meta) {
          await Promise.all(metaParts.map((m, k) => env.BUCKET.put(`${tmp}close-meta-${k}.json`, JSON.stringify(m))));
        }
        const res = await db.batch(dates.map((d) => closeDayStmt(db, d, d === yesterday ? votes : null)));
        return { ...stats, meta: stats.radar_meta > 0, written: written(res) };
      });
      let ok = !!plan?.dates?.length;
      for (const d of plan?.dates || []) {
        for (let k = 0; ok && k < RADAR_CLOSE_PARTS; k++) {
          ok = !!await safe(`close-radar-${d}-${k}`, async () => {
            const files = await radarDay(d);
            let rm = null;
            if (d === yesterday && plan.meta) rm = await (await env.BUCKET.get(`${tmp}close-meta-${k}.json`))?.json() ?? null;
            const rows = radarDailyRows(radarReadingsPart(files, k, RADAR_CLOSE_PARTS), rm, k, RADAR_CLOSE_PARTS);
            const res = rows.length ? await radarCloseStmt(db, d, rows).run() : null;
            return { files: files.length, rows: rows.length, written: written(res) };
          });
        }
      }
      if (ok) {
        await safe("close-hist", async () => {
          const closed = init.closedDay && init.closedDay > yesterday ? init.closedDay : yesterday;
          const res = await db.batch([...plan.dates.map((d) => mergeHistStmt(db, d)), setStateStmt(db, "closed_day", closed)]);
          return { closed, written: written(res) };
        });
      }
    }
    if (want("select") && (daily.select ? await tryTask("select") : p.select)) {
      await runSelect(env, step, ts * 6e4, today, safe, summary2);
    }
    if (want("maint") && daily.maint && await tryTask("maint")) {
      await safe("maint", async () => {
        const cutoff = ts - SAMPLE_RETENTION_DAYS * DAY_MIN;
        const oldDate = addDays(today, -DATA_RETENTION_DAYS);
        const stmts = [
          pruneSamplesStmt(db, cutoff),
          untrackStmt(db, today),
          // Las cachés del radar solo dependen de tracked aquí: justo detrás de untrack
          radarStaleStmt(db, { ifChanged: true }),
          ...pruneOldStmts(db, oldDate),
          pruneHistStmt(db, oldDate),
          setStateStmt(db, "maint_day", today)
        ];
        const res = await db.batch(stmts);
        const old = `${RADAR_PREFIX}${addDays(today, -RADAR_KEEP_DAYS)}/`;
        const listed = await env.BUCKET.list({ prefix: RADAR_PREFIX, limit: 1e3 });
        const keys = listed.objects.map((o) => o.key).filter((k) => k < old);
        if (keys.length) await env.BUCKET.delete(keys);
        const runs = await env.BUCKET.list({ prefix: RUN_PREFIX, limit: 1e3 });
        const stale = runs.objects.filter((o) => !o.key.startsWith(tmp) && o.uploaded && new Date(o.uploaded).getTime() < (ts - DAY_MIN) * 6e4).map((o) => o.key);
        if (stale.length) await env.BUCKET.delete(stale);
        const oldRows = (res[3]?.meta?.changes ?? 0) + (res[4]?.meta?.changes ?? 0);
        return {
          pruned: res[0]?.meta?.changes ?? 0,
          untracked: res[1]?.meta?.changes ?? 0,
          old_rows: oldRows,
          old_hist: res[5]?.meta?.changes ?? 0,
          radar_files: keys.length,
          tmp_files: stale.length,
          written: written(res)
        };
      });
    }
    let exported = null;
    if (want("export")) exported = await runExport(env, step, ts * 6e4, safe, summary2);
    if (want("telegram") && exported?.telegram) {
      await safe("telegram", async () => {
        const obj = await env.BUCKET.get(TELEGRAM_KEY);
        if (!obj) throw new Error("No hay data/telegram.json en R2");
        const exportData = await obj.json();
        const r = await runTelegram({
          env,
          exportData,
          now: new Date(ts * 6e4),
          getState: /* @__PURE__ */ __name((key) => getState(db, key), "getState"),
          setState: /* @__PURE__ */ __name((key, value) => setState(db, key, value), "setState"),
          force: p.telegram_force || void 0,
          maxFetch: Math.max(0, inv.left)
          // lo que queda de las 50 de esta invocación
        });
        return r ?? { ok: true };
      }, STEP_ONCE);
    }
    await step.do("finish", STEP, async () => {
      summary2.finished_at = (/* @__PURE__ */ new Date()).toISOString().slice(0, 19) + "Z";
      summary2.instance = event.instanceId || null;
      summary2.base = base;
      await setState(db, only ? "last_partial_run" : "last_run", compact(summary2));
      await setState(db, "run_current", null);
      const listed = await env.BUCKET.list({ prefix: tmp });
      if (listed.objects.length) await env.BUCKET.delete(listed.objects.map((o) => o.key));
      return { errors: summary2.errors.length, segments: seg + 1 };
    });
    return compact(summary2);
  }
};
function compact(summary2) {
  const out = { ...summary2, errors: (summary2.errors || []).slice(-30) };
  const steps = {};
  for (const [k, v] of Object.entries(summary2.steps || {})) {
    if (/^(explore-\d+|resolve-\d+|search-\d+|export-\d+|select-\d+|tg-scan-|tg-pick-|close-radar-)/.test(k)) continue;
    steps[k] = v;
  }
  out.steps = steps;
  return out;
}
__name(compact, "compact");
async function saveExplore(db, sorts, today, firstSeen, offsets = {}) {
  const games = /* @__PURE__ */ new Map();
  const hits = /* @__PURE__ */ new Map();
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
__name(saveExplore, "saveExplore");
async function sampleChunk(db, ids, { ts, today, meta, budget = new Budget(45), sel = null }) {
  const voteIds = meta ? sel ? ids.filter((id) => sel.has(id)) : ids : [];
  const [games, vts] = await Promise.all([
    fetchGames(budget, ids),
    voteIds.length ? fetchVotes(budget, voteIds) : null
  ]);
  const batches = Math.ceil(ids.length / 50);
  if (games.failed * 2 > batches || batches === 1 && games.failed) {
    throw new Error(`Games API: ${games.failed}/${batches} lotes sin respuesta`);
  }
  const { samples, low, metaRows, votes, radar } = processGames(ids, games, vts, meta, sel);
  const stmts = [];
  if (samples.length) {
    stmts.push(insertSamplesStmt(db, samples, ts));
    stmts.push(db.prepare(
      `INSERT INTO state (key, value) VALUES ('last_sample_ts', ?1)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value
       WHERE CAST(state.value AS INTEGER) < CAST(excluded.value AS INTEGER)`
    ).bind(String(ts)));
  }
  stmts.push(...lowSinceStmts(db, low, today));
  if (metaRows.length) stmts.push(updateMetaStmt(db, metaRows, today));
  const res = stmts.length ? await db.batch(stmts) : [];
  return {
    stats: { games: ids.length, samples: samples.length, failed: games.failed, meta: metaRows.length, calls: budget.used, written: written(res) },
    votes: meta ? votes : void 0,
    radar: meta ? radar : void 0
  };
}
__name(sampleChunk, "sampleChunk");
function processGames(ids, games, vts, meta, sel = null) {
  const got = /* @__PURE__ */ new Map();
  for (const g of games.data) got.set(g.id, g);
  const vmap = /* @__PURE__ */ new Map();
  if (vts) for (const v of vts.data) vmap.set(v.id, v);
  const samples = [], low = [], metaRows = [];
  const votes = {}, radar = {};
  for (const id of ids) {
    const g = got.get(id);
    if (!g) {
      if (!games.failed) low.push([id, 0]);
      continue;
    }
    const playing = g.playing || 0;
    const followed = !sel || sel.has(id);
    if (followed && playing >= TRACK_MIN_PLAYERS) samples.push([id, playing, g.visits ?? null]);
    if (!followed) radar[id] = [playing, g.visits ?? null];
    low.push([id, playing]);
    if (meta) {
      const c = g.creator || {};
      const h2 = classifyHorror({
        universe_id: id,
        name: g.name,
        description: g.description || "",
        genre: g.genre,
        genre_l1: g.genre_l1,
        genre_l2: g.genre_l2
      });
      metaRows.push([
        id,
        g.rootPlaceId ?? null,
        g.name ?? null,
        c.name ?? null,
        c.hasVerifiedBadge == null ? null : c.hasVerifiedBadge ? 1 : 0,
        g.created ?? null,
        g.updated ?? null,
        g.genre ?? null,
        g.genre_l1 ?? null,
        g.genre_l2 ?? null,
        g.maxPlayers ?? null,
        h2.horror ? 1 : 0,
        h2.score,
        JSON.stringify(h2.reasons || [])
      ]);
      const v = vmap.get(id);
      if (followed) votes[id] = [g.favoritedCount ?? null, v?.upVotes ?? null, v?.downVotes ?? null];
    }
  }
  return { samples, low, metaRows, votes, radar };
}
__name(processGames, "processGames");
async function radarTexts(bucket, date) {
  const listed = await bucket.list({ prefix: `${RADAR_PREFIX}${date}/` });
  const texts = await Promise.all(listed.objects.map(async (o) => (await bucket.get(o.key))?.text() ?? null));
  return texts.filter((t) => t != null);
}
__name(radarTexts, "radarTexts");
function chooseSelection(rows, cfg = SELECTION) {
  const byPlayers = /* @__PURE__ */ __name((a, b) => b[3] - a[3] || a[0] - b[0], "byPlayers");
  const byScore = /* @__PURE__ */ __name((a, b) => b[4] - a[4] || b[3] - a[3] || a[0] - b[0], "byScore");
  const fill = /* @__PURE__ */ __name((cands, pool2) => {
    const ids = new Set(cands.map((r) => r[0]));
    return cands.concat(pool2.filter((r) => !ids.has(r[0])));
  }, "fill");
  const all = rows.slice().sort(byPlayers), horror = all.filter((r) => r[1]);
  const lists = {
    top: [all, cfg.top],
    top_horror: [horror, cfg.top],
    emerging: [fill(rows.filter((r) => r[4] != null).sort(byScore), all.slice(cfg.top)), cfg.emerging_general],
    emerging_horror: [fill(horror.filter((r) => r[4] != null).sort(byScore), horror.slice(cfg.top)), cfg.emerging_horror]
  };
  const chosen = /* @__PURE__ */ new Set(), kept = /* @__PURE__ */ new Set(), counts = {};
  for (const [name, [list, n]] of Object.entries(lists)) {
    const keepN = Math.ceil(n * cfg.keep_factor);
    counts[name] = Math.min(n, list.length);
    for (let i = 0; i < list.length && i < keepN; i++) {
      if (i < n) chosen.add(list[i][0]);
      else if (list[i][2]) kept.add(list[i][0]);
    }
  }
  for (const id of kept) chosen.add(id);
  return { ids: [...chosen].sort((a, b) => a - b), counts: { ...counts, kept: [...kept].filter((id) => chosen.has(id)).length, total: chosen.size, radar: rows.length } };
}
__name(chooseSelection, "chooseSelection");
async function runSelect(env, step, nowMs, today, safe, summary2) {
  const db = env.DB;
  const plan = await safe("select-plan", async () => ({ ranges: idRanges(await radarIds(db, today), SELECT_SLICE) }));
  if (!plan) return null;
  const now = new Date(nowMs).toISOString();
  const rows = [];
  for (const [i, [lo, hi]] of plan.ranges.entries()) {
    try {
      rows.push(...await step.do(`select-${i}`, STEP, async () => {
        const out = [];
        for (const [id, horror, sel, created, firstSeen, firstDay, sorts, d] of await radarSlice(db, { lo, hi, days: RADAR_DAYS, before: today, today })) {
          const r = radarScore({ id, created, first_seen: firstSeen, first_day: firstDay, sorts, d, s: [] }, { now });
          if (r) out.push([id, horror ? 1 : 0, sel ? 1 : 0, r[0], r[1] == null ? null : Math.round(r[1] * 10) / 10]);
        }
        return out;
      }));
    } catch (e) {
      summary2?.errors.push(`select-${i}: ${String(e?.message || e).slice(0, 200)}`);
      return null;
    }
  }
  const applied = await safe("select-apply", async () => {
    const { ids, counts } = chooseSelection(rows);
    if (!ids.length) throw new Error("La selecci\xF3n ha salido vac\xEDa");
    const res = await db.batch([
      applySelectionStmt(db, ids),
      radarCountsStaleStmt(db),
      // solo si applySelectionStmt ha cambiado algo
      // La lista va también a state para que el export no tenga que recorrer games
      setStateStmt(db, "sel_ids", ids),
      setStateStmt(db, "sel_day", today),
      setStateStmt(db, "selection", { day: today, ...counts })
    ]);
    const was = new Map(rows.map((r) => [r[0], r]));
    const added = ids.filter((id) => !was.get(id)?.[2]).sort((a, b) => (was.get(b)?.[3] ?? 0) - (was.get(a)?.[3] ?? 0));
    return { stats: { ...counts, added: added.length, changed: res[0]?.meta?.changes ?? 0, written: written(res) }, added };
  });
  if (!applied) return null;
  if (applied.added.length) {
    await safe("select-backfill", () => backfillFromRadar(env, applied.added, minuteOf(nowMs)));
  }
  return applied.stats;
}
__name(runSelect, "runSelect");
async function backfillFromRadar(env, ids, nowTs, { maxGames = BACKFILL_MAX_GAMES } = {}) {
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
  const stmts = texts.filter(Boolean).map(([ts, text2]) => backfillSamplesStmt(env.DB, text2, ts, games));
  const res = stmts.length ? await env.DB.batch(stmts) : [];
  return { asked: ids.length, games: games.length, files: stmts.length, written: written(res) };
}
__name(backfillFromRadar, "backfillFromRadar");
async function runExport(env, step, nowMs, safe, summary2) {
  const db = env.DB;
  const plan = await safe("export-plan", async () => {
    const [lastTs2, closed, radar, selIds] = await Promise.all([
      lastSampleTs(db),
      getState(db, "closed_day"),
      radarCounts(db),
      getState(db, "sel_ids")
    ]);
    if (Array.isArray(selIds) && selIds.length) {
      const ranges2 = chunks([...selIds].sort((a, b) => a - b), EXPORT_SLICE).map((ids) => [ids[0], ids[ids.length - 1], ids]);
      return { lastTs: lastTs2, openDay: closed ? addDays(closed, 1) : isoDate(minuteOf(nowMs)), ranges: ranges2, selected: true, radar };
    }
    if (!(radar.selected > 0)) return { skipped: "sin selecci\xF3n: se queda el export de antes" };
    const ranges = await exportPlan(db, EXPORT_SLICE, { selected: true });
    return { lastTs: lastTs2, openDay: closed ? addDays(closed, 1) : isoDate(minuteOf(nowMs)), ranges, selected: true, radar };
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
          n: s.n,
          bytes: obj?.size ?? 0,
          last_ts: s.last_ts,
          ts24: s.ts24,
          rows_read: s.meta?.rows_read ?? null,
          rows_written: s.meta?.rows_written ?? null
        };
      });
    } catch (e) {
      summary2?.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
      return null;
    }
    slices.push(r);
  }
  const lastTs = slices.reduce((m, s) => s.last_ts != null && s.last_ts > (m ?? -1) ? s.last_ts : m, null) ?? plan.lastTs;
  const header = exportHeader({ nowMs, lastTs, ts24: slices.flatMap((s) => s.ts24), radar: plan.radar });
  const total = slices.reduce((a, s) => a + s.n, 0);
  const join = await safe("export-join", async () => {
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
        if (i) {
          w = writable.getWriter();
          await w.write(comma);
          w.releaseLock();
        }
        await objs[i].body.pipeTo(writable, { preventClose: true });
      }
      w = writable.getWriter();
      await w.write(tail);
      await w.close();
    })();
    const [put] = await Promise.all([
      env.BUCKET.put(EXPORT_KEY, readable, {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
        customMetadata: { generated_at: header.generated_at, games: String(total) }
      }),
      pump
    ]);
    return {
      bytes: put?.size ?? size,
      games: total,
      slices: slices.length,
      rows_read: slices.reduce((a, s) => a + (s.rows_read || 0), 0),
      rows_written: slices.reduce((a, s) => a + (s.rows_written || 0), 0)
    };
  });
  if (!join) return null;
  const nowIso = new Date(nowMs).toISOString();
  const rowParts = [];
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
        summary2?.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
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
      summary2?.errors.push(`${name}: ${String(e?.message || e).slice(0, 200)}`);
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
    const text2 = `${JSON.stringify({
      ...header,
      totals: red.counts,
      telegram: { counts: red.counts, total, candidates }
    }).slice(0, -1)},"games":[${frags.join(",")}]}`;
    const obj = await env.BUCKET.put(TELEGRAM_KEY, text2, { httpMetadata: { contentType: "application/json; charset=utf-8" } });
    return { candidates, bytes: obj?.size ?? null, rows: red.rows };
  }) : null;
  join.telegram = tg;
  if (summary2 && join) summary2.steps.export = join;
  return join;
}
__name(runExport, "runExport");
function pickGames(part, ids) {
  const want = new Set(ids);
  const text2 = `{"games":[${part}]}`;
  const offs = gameOffsets(text2), out = [];
  for (let k = 0; k < offs.length - 1; k++) {
    const p = offs[k] + 6;
    if (!want.has(Number(text2.slice(p, text2.indexOf(",", p))))) continue;
    out.push(text2.slice(offs[k], offs[k + 1]).replace(/,$/, ""));
  }
  return { frag: out.join(","), n: out.length };
}
__name(pickGames, "pickGames");

// src/index.js
var MAX_LIVE_IDS = 200;
var MAX_IMPORT_BYTES = 4e6;
var MAX_BACKFILL_IDS = 400;
var TYPES = {
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  text: "text/plain; charset=utf-8"
};
var MODULES = { "/config.js": config_default, "/metrics.js": metrics_default, "/horror.js": horror_default };
var index_default = {
  async fetch(req, env, ctx) {
    env = withApp(env);
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path.startsWith("/api/admin/")) return await admin(req, env, url);
      if (url.hostname.endsWith(".workers.dev")) return text("No encontrado", 404);
      if (req.method !== "GET" && req.method !== "HEAD") return text("M\xE9todo no permitido", 405);
      if (MODULES[path]) {
        return new Response(MODULES[path], {
          headers: { "content-type": TYPES.js, "cache-control": "public, max-age=300" }
        });
      }
      if (path === "/api/export") return await exportFile(req, env);
      if (path.startsWith("/api/history/")) return await historyRoute(env, path.split("/")[3]);
      if (path === "/api/live") return await live(url);
      if (path === "/api/thumbs") return await thumbs(url);
      if (path.startsWith("/api/game/")) return await game(path.split("/")[3]);
      return await site(env, path);
    } catch (e) {
      console.error(e);
      return json({ error: String(e?.message || e) }, 502);
    }
  },
  async scheduled(controller, env, ctx) {
    const at = new Date(controller.scheduledTime || Date.now());
    const id = `cron-${at.toISOString().slice(0, 16).replace(/[:]/g, "")}`;
    try {
      await env.SAMPLER.create({ id, params: { now: at.toISOString() } });
      console.log(`Muestreo lanzado: ${id}`);
    } catch (e) {
      console.warn(`No se lanz\xF3 ${id}: ${e?.message || e}`);
    }
  }
};
function json(data, status2 = 200, maxAge = 0) {
  return new Response(typeof data === "string" ? data : JSON.stringify(data), {
    status: status2,
    headers: { "content-type": TYPES.json, "cache-control": maxAge ? `public, max-age=${maxAge}` : "no-store" }
  });
}
__name(json, "json");
function text(body, status2 = 200) {
  return new Response(body, { status: status2, headers: { "content-type": TYPES.text } });
}
__name(text, "text");
function parseIds(url, max) {
  const ids = [...new Set((url.searchParams.get("ids") || "").split(",").map((s) => s.trim()).filter((s) => /^\d{1,20}$/.test(s)))];
  return ids.slice(0, max);
}
__name(parseIds, "parseIds");
async function getJson2(url, cacheTtl) {
  const r = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    cf: { cacheTtl, cacheEverything: true }
  });
  if (!r.ok) throw new Error(`Roblox respondi\xF3 ${r.status}`);
  return r.json();
}
__name(getJson2, "getJson");
async function site(env, path) {
  let key;
  if (path === "/" || path === "/index.html" || path === "/dashboard.html") key = "site/dashboard.html";
  else if (path === "/favicon.svg") key = "site/favicon.svg";
  else return text("No encontrado", 404);
  const obj = await env.BUCKET.get(key);
  if (!obj) return text("No encontrado", 404);
  const ext = key.split(".").pop();
  return new Response(obj.body, {
    headers: {
      "content-type": TYPES[ext] || "application/octet-stream",
      "cache-control": ext === "html" ? "no-cache" : "public, max-age=3600",
      etag: obj.httpEtag
    }
  });
}
__name(site, "site");
async function exportFile(req, env) {
  const inm = req.headers.get("if-none-match");
  const obj = await env.BUCKET.get("data/export.json", inm ? { onlyIf: { etagDoesNotMatch: inm.replace(/^W\//, "").replace(/"/g, "") } } : void 0);
  if (!obj) return json({ error: "Todav\xEDa no hay export" }, 404);
  const headers = { "content-type": TYPES.json, "cache-control": "public, max-age=60", etag: obj.httpEtag };
  if (!("body" in obj) || !obj.body) return new Response(null, { status: 304, headers });
  return new Response(obj.body, { headers });
}
__name(exportFile, "exportFile");
async function historyRoute(env, id) {
  if (!/^\d{1,20}$/.test(id || "")) return json({ error: "id no v\xE1lido" }, 400);
  const closed = await getState(env.DB, "closed_day");
  const nowMs = Date.now();
  const today = isoDate(minuteOf(nowMs));
  const openDay = closed ? new Date(Date.parse(`${closed}T00:00:00Z`) + 864e5).toISOString().slice(0, 10) : today;
  const out = await history(env.DB, Number(id), { nowMs, openDay });
  if (!out) return json({ error: "No encontrado" }, 404);
  return json(out, 200, 300);
}
__name(historyRoute, "historyRoute");
async function live(url) {
  const ids = parseIds(url, MAX_LIVE_IDS);
  if (!ids.length) return json({ error: "Faltan ids" }, 400);
  const [games, icons] = await Promise.all([
    Promise.all(chunks(ids, 50).map((c) => getJson2(`${URLS.games}?universeIds=${c.join(",")}`, 30))),
    Promise.all(chunks(ids, 100).map((c) => getJson2(iconsUrl(c), 21600).catch(() => ({ data: [] }))))
  ]);
  const out = {};
  for (const page of games) {
    for (const g of page.data || []) out[g.id] = { playing: g.playing, visits: g.visits, updated: g.updated };
  }
  for (const page of icons) {
    for (const i of page.data || []) {
      if (i.state === "Completed") (out[i.targetId] ||= {}).icon = i.imageUrl;
    }
  }
  return json({ ts: (/* @__PURE__ */ new Date()).toISOString(), games: out }, 200, 20);
}
__name(live, "live");
async function thumbs(url) {
  const ids = parseIds(url, 50);
  if (!ids.length) return json({ error: "Faltan ids" }, 400);
  const data = await getJson2(thumbsUrl(ids), 21600);
  const out = {};
  for (const t of data.data || []) {
    const shot = (t.thumbnails || []).find((s) => s.state === "Completed");
    if (shot) out[t.universeId] = shot.imageUrl;
  }
  return json(out, 200, 3600);
}
__name(thumbs, "thumbs");
async function game(id) {
  if (!/^\d{1,20}$/.test(id || "")) return json({ error: "id no v\xE1lido" }, 400);
  const [info, shot, icon] = await Promise.all([
    getJson2(`${URLS.games}?universeIds=${id}`, 30),
    getJson2(thumbsUrl([id]), 21600).catch(() => ({ data: [] })),
    getJson2(iconsUrl([id], "256x256"), 21600).catch(() => ({ data: [] }))
  ]);
  const g = (info.data || [])[0];
  if (!g) return json({ error: "No encontrado" }, 404);
  const thumb = ((shot.data || [])[0]?.thumbnails || []).find((s) => s.state === "Completed");
  const ic = (icon.data || [])[0];
  return json({
    id: g.id,
    name: g.name,
    description: g.description,
    playing: g.playing,
    visits: g.visits,
    favorites: g.favoritedCount,
    updated: g.updated,
    max_players: g.maxPlayers,
    thumb: thumb?.imageUrl || null,
    icon: ic?.state === "Completed" ? ic.imageUrl : null,
    ts: (/* @__PURE__ */ new Date()).toISOString()
  }, 200, 30);
}
__name(game, "game");
async function authorized(req, env) {
  if (!env.ADMIN_TOKEN) return false;
  const got = new TextEncoder().encode(req.headers.get("authorization") || "");
  const want = new TextEncoder().encode(`Bearer ${env.ADMIN_TOKEN}`);
  if (got.byteLength !== want.byteLength) return false;
  return crypto.subtle.timingSafeEqual(got, want);
}
__name(authorized, "authorized");
async function readBody(req) {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_IMPORT_BYTES) throw new HttpError(413, "Cuerpo demasiado grande");
  const raw = await req.text();
  if (raw.length > MAX_IMPORT_BYTES) throw new HttpError(413, "Cuerpo demasiado grande");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "JSON no v\xE1lido");
  }
}
__name(readBody, "readBody");
var HttpError = class extends Error {
  static {
    __name(this, "HttpError");
  }
  constructor(status2, msg) {
    super(msg);
    this.status = status2;
  }
};
async function admin(req, env, url) {
  if (!await authorized(req, env)) return json({ error: "No autorizado" }, 401);
  const action = url.pathname.slice("/api/admin/".length);
  try {
    if (action === "status" && req.method === "GET") return await adminStatus(env, url);
    if (action === "espacio" && req.method === "GET") return json(await espacioD1(env.DB, { exacto: !!url.searchParams.get("exacto") }));
    if (req.method !== "POST") return json({ error: "M\xE9todo no permitido" }, 405);
    if (action === "run") {
      const body = await readBody(req);
      const params = {};
      if (Array.isArray(body.daily)) params.daily = body.daily.map(String);
      else if (body.daily) params.daily = true;
      if (body.select) params.select = true;
      if (Array.isArray(body.skip)) params.skip = body.skip.map(String);
      if (body.telegram_force) params.telegram_force = String(body.telegram_force);
      if (body.now) params.now = new Date(body.now).toISOString();
      if (Array.isArray(body.only)) params.only = body.only.map(String);
      const id = `manual-${stamp()}`;
      const inst = await env.SAMPLER.create({ id, params });
      return json({ id: inst.id, params });
    }
    if (action === "import") {
      const { table, columns, rows } = await readBody(req);
      if (!Array.isArray(columns) || !Array.isArray(rows)) throw new HttpError(400, "Faltan columns/rows");
      if (!rows.length) return json({ table, rows: 0, written: 0 });
      let res;
      try {
        res = await env.DB.batch([importStmt(env.DB, table, columns, rows), ...table === "daily" ? [dropExportCacheStmt(env.DB)] : []]);
      } catch (e) {
        throw new HttpError(400, String(e?.message || e));
      }
      return json({ table, rows: rows.length, written: written(res[0]) });
    }
    if (action === "rebuild") {
      const res = await env.DB.batch([...rebuildHistStmts(env.DB), dropExportCacheStmt(env.DB)]);
      const inst = await env.SAMPLER.create({ id: `export-${stamp()}`, params: { only: ["export"] } });
      return json({ hist_written: written(res.slice(0, 2)), export_instance: inst.id });
    }
    if (action === "export") {
      const inst = await env.SAMPLER.create({ id: `export-${stamp()}`, params: { only: ["export"] } });
      return json({ export_instance: inst.id });
    }
    if (action === "backfill") {
      const body = await readBody(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isSafeInteger) : null;
      return json(await backfillFromRadar(env, ids, minuteOf(Date.now()), { maxGames: MAX_BACKFILL_IDS }));
    }
    return json({ error: "No encontrado" }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    throw e;
  }
}
__name(admin, "admin");
async function adminStatus(env, url) {
  const out = { now: (/* @__PURE__ */ new Date()).toISOString() };
  out.state = await getStates(env.DB, ["last_run", "last_partial_run", "run_current", "meta_day", "closed_day", "sel_day", "maint_day", "daily_tries", "search_cursor", "last_sample_ts", "selection"]);
  const id = url.searchParams.get("id") || out.state.run_current?.id || out.state.last_run?.instance;
  if (id) {
    try {
      out.instance = { id, ...await (await env.SAMPLER.get(id)).status() };
    } catch (e) {
      out.instance = { id, error: String(e?.message || e) };
    }
  }
  const counts = url.searchParams.get("counts");
  if (counts && counts !== "exacto") {
    const [esp, radar] = await Promise.all([espacioD1(env.DB), radarCounts(env.DB)]);
    const n = /* @__PURE__ */ __name((name) => esp.base.tablas.find((t) => t.nombre === name)?.filas ?? null, "n");
    out.counts = {
      games: { n: n("games"), tracked: radar.radar },
      places: n("places"),
      samples: n("samples"),
      daily: { n: n("daily"), last: out.state.closed_day ?? null },
      sort_hits: n("sort_hits"),
      estimado: true
    };
  } else if (counts) {
    const r = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) AS n, SUM(tracked = 1) AS tracked FROM games"),
      env.DB.prepare("SELECT COUNT(*) AS n FROM places"),
      env.DB.prepare("SELECT COUNT(*) AS n FROM samples"),
      env.DB.prepare("SELECT COUNT(*) AS n, MAX(date) AS last FROM daily"),
      env.DB.prepare("SELECT COUNT(*) AS n FROM sort_hits")
    ]);
    out.counts = {
      games: r[0].results[0],
      places: r[1].results[0].n,
      samples: r[2].results[0].n,
      daily: r[3].results[0],
      sort_hits: r[4].results[0].n
    };
  }
  const head = await env.BUCKET.head("data/export.json");
  if (head) out.export = { size: head.size, uploaded: head.uploaded, meta: head.customMetadata };
  return json(out);
}
__name(adminStatus, "adminStatus");
function stamp() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 19).replace(/[:]/g, "") + Math.random().toString(36).slice(2, 6);
}
__name(stamp, "stamp");
export {
  Operaciones,
  Sampler,
  index_default as default
};
//# sourceMappingURL=index.js.map
