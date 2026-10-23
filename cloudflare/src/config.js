// Port fiel de config.py: un cambio aquí va también allí.

export const TRACK_MIN_PLAYERS = 300;
export const UNTRACK_AFTER_DAYS = 3;
export const SAMPLE_RETENTION_DAYS = 8;
export const DATA_RETENTION_DAYS = 365;
export const RADAR_EVERY_HOURS = 3;       // para el dato diario basta
export const EXPORT_DAILY_DAYS = 24;      // 24 = paridad con Python
export const EXPORT_SAMPLE_HOURS = 48;
export const HISTORY_DAYS = 365;
export const HISTORY_SAMPLE_DAYS = 2;

// Al empezar todo el catálogo es nuevo: nadie es «recién detectado» los 2 primeros días.
export const SCAN_START = "2026-10-02";

// 1 palabra por hora: cada una ~1,5 veces al día sin forzar el límite del buscador.
export const SEARCH_QUERIES = [
  "horror", "killer", "jumpscare", "escape monster", "haunted", "scary",
  "backrooms", "nightmare", "anomaly", "survive the night", "creepy", "fnaf",
  "asymmetrical", "monster", "hide and seek horror", "story horror",
];
export const SEARCH_QUERIES_PER_RUN = 1;
export const SEARCH_PAGES_PER_QUERY = 3;

export const SELECTION = {
  top: 10,
  emerging_general: 150,
  emerging_horror: 50,
  keep_factor: 1.5,
};

// Con min_players = TRACK_MIN_PLAYERS cada pestaña lista todos sus juegos seguidos.
export const CATEGORIES = {
  general: { label: "General", icon: "🎮", min_players: TRACK_MIN_PLAYERS, classifier: "all" },
  horror: { label: "Horror", icon: "👻", min_players: TRACK_MIN_PLAYERS, classifier: "horror" },
};

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

export const EMERGING = {
  max_visits: 30_000_000,
  min_players: 300,
  max_age_days: 120,
  min_score: 45,
  max_results: 24,
  roblox_sorts: ["up-and-coming", "top-trending"],
};

export const EVENTS = {
  window_days: 7,
  mad_k: 3.5,
  min_ratio: 1.6,
  spike_now_ratio: 1.8,
  spike_weekday_ratio: 1.5,
};

// Medido 2–13/10/2026: con 70 puntos desde 300 jugadores, ~170 avisos en 12 días; así, ~1 al día.
export const TELEGRAM = {
  report_hour_utc: 18,
  alert_min_players: 40_000,
  alert_min_typical: 20_000,   // sostenido, no un pico de una hora
  alert_max_age_days: 120,     // juego nuevo, no un clásico de siempre
  max_alerts_per_run: 3,
  report_min_players: 10_000,
  list_size: 5,
  title_chars: 30,
  dashboard_url: "https://robloxtracker.stonksstudio.com/",
};
