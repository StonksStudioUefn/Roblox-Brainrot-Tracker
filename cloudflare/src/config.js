/**
 * config.js — Configuración única del tracker (Worker, Workflow y navegador).
 *
 * Es un módulo ES sin dependencias: lo importan el Worker (muestreo, horror,
 * Telegram) y el dashboard (métricas), que lo descarga de /config.js.
 * Port fiel de config.py.
 */

// ─── Recolección ──────────────────────────────────────────────────────────────
export const TRACK_MIN_PLAYERS = 300;     // por debajo de esto no se toman muestras
export const UNTRACK_AFTER_DAYS = 3;      // días seguidos por debajo → deja de seguirse
export const SAMPLE_RETENTION_DAYS = 8;   // muestras intradía en D1 (el resto vive en `daily`)
export const EXPORT_DAILY_DAYS = 24;      // filas de serie diaria por juego en /api/export (últimas N filas; 24 = paridad con Python)
export const EXPORT_SAMPLE_HOURS = 48;    // horas de muestras intradía en /api/export
export const HISTORY_DAYS = 120;          // días de serie en /api/history/:id
export const HISTORY_SAMPLE_DAYS = 7;     // días de muestras en /api/history/:id

// Hasta 2 días después no se marca ningún juego como "recién detectado"
// (al empezar, todo el catálogo es nuevo para el tracker).
export const SCAN_START = "2026-10-02";

// Palabras que el buscador oficial de Roblox recorre por turnos (2–3 por muestreo)
export const SEARCH_QUERIES = [
  "horror", "killer", "jumpscare", "escape monster", "haunted", "scary",
  "backrooms", "nightmare", "anomaly", "survive the night", "creepy", "fnaf",
  "asymmetrical", "monster", "hide and seek horror", "story horror",
];
export const SEARCH_QUERIES_PER_RUN = 3;
export const SEARCH_PAGES_PER_QUERY = 3;

// ─── Categorías (pestañas del dashboard) ──────────────────────────────────────
export const CATEGORIES = {
  general: { label: "General", icon: "🎮", min_players: 2500, classifier: "all" },
  horror: { label: "Horror", icon: "👻", min_players: 500, classifier: "horror" },
};

// ─── Clasificación de horror ──────────────────────────────────────────────────
export const HORROR = {
  threshold: 5,
  name_strong: [
    "horror", "scary", "creepy", "haunted", "nightmare", "backrooms",
    "doors", "mimic", "piggy", "granny", "slender", "specimen", "asylum",
    "cursed", "ghost", "killer", "evade", "forsaken", "pressure",
    "apeirophobia", "the rake", "siren head", "jumpscare", "paranormal",
    "phobia", "exorcis", "possessed", "terror", "insanity", "anomal",
    "survive the night", "dead rails", "entity", "poppy", "rainbow friends",
    "fnaf", "freddy", "the intruder", "spooky", "dread", "flee the facility",
    "residence massacre", "nights at", "die of death", "99 nights", "scp",
    "nextbot", "slendytubbies", "the butchery", "infectious smile", "grace",
    "banban", "a quiet place", ".exe", "hello neighbor", "demonology",
  ],
  name_weak: [
    "escape", "survive", "survival", "hide", "run from", "chased",
    "night", "dark", "fog", "midnight", "shadow", "abandoned",
    "hospital", "prison", "basement", "facility", "lost", "alone",
    "hunt", "blood", "evil", "trapped", "murder", "monster", "demon",
    "zombie", "scream", "story",
  ],
  name_negative: [
    "brainrot", "tsunami", "lucky block", "tycoon", "simulator", "obby",
    "tower", "race", "speed", "anime", "steal a", "steal an", "lava",
    "flood", "admin", "rng", "clicker", "keyboard",
  ],
  tags: ["horror", "scary", "anomaly"],
  desc_strong: [
    "horror", "scary", "jumpscare", "jump scare", "creepy", "terrifying",
    "nightmare", "killer", "survive the night", "don't get caught",
    "dont get caught", "hide from", "being hunted", "hunted by",
    "chased by", "paranormal", "spooky", "frightening", "backrooms",
    "entity", "entities", "anomal", "sanity",
  ],
  desc_weak: [
    "monster", "creature", "demon", "zombie", "ghost", "haunted", "cursed",
    "lurk", "possessed", "escape", "survive", "dark", "flashlight",
    "run from", "chase", "abandoned", "lights out", "murderer",
  ],
  points: {
    name_strong: 4, name_weak: 1, name_negative: -3,
    desc_strong: 3, desc_strong_cap: 5,
    desc_weak: 1, desc_weak_cap: 2,
  },
  legacy_genres: { Horror: 5 },
  genres: {
    "Survival/1 vs All": 2, "Survival/Escape": 2, "Survival/": 1,
    "Adventure/Story": 1, "Adventure/Exploration": 1,
  },
  force_include: [],
  force_exclude: [],
};

// ─── Emergentes ───────────────────────────────────────────────────────────────
export const EMERGING = {
  max_visits: 30_000_000,
  min_players: 300,
  max_age_days: 120,
  min_score: 45,
  max_results: 24,
  // Listas oficiales de Roblox que cuentan como señal de "está despegando"
  roblox_sorts: ["up-and-coming", "top-trending"],
};

// ─── Eventos / picos ──────────────────────────────────────────────────────────
export const EVENTS = {
  window_days: 7,
  mad_k: 3.5,
  min_ratio: 1.6,
  spike_now_ratio: 1.8,
};

// ─── Telegram ─────────────────────────────────────────────────────────────────
export const TELEGRAM = {
  report_hour_utc: 18,     // el resumen diario sale en el primer muestreo desde esta hora
  alert_min_score: 70,     // emergentes con esta puntuación generan alerta (una vez por juego)
  max_alerts_per_run: 5,
  list_size: 5,
  title_chars: 30,
  dashboard_url: "https://robloxtracker.stonksstudio.com/",
};
