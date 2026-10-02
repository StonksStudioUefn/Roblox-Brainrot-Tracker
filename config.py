"""
config.py — Configuración única del tracker (la usan todos los scripts).

Aquí se ajustan umbrales, categorías, reglas de clasificación de horror y los
criterios para detectar juegos emergentes. No hace falta tocar nada más.
"""

from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data"
RAW_DIR = DATA / "raw"          # muestras intradía: data/raw/AAAA-MM-DD.csv
DAILY_DIR = DATA / "daily"      # agregados diarios: data/daily/AAAA-MM.csv
GAMES_PATH = DATA / "games.json"          # ficha de cada juego (metadatos)
DASHBOARD_PATH = DATA / "dashboard.json"  # resumen para el dashboard
HISTORY_PATH = DATA / "history.json"      # series completas (carga diferida)
STATE_PATH = DATA / "state.json"          # estado del notificador

# ─── Recolección ───────────────────────────────────────────────────────────────
# Se guardan muestras de TODOS los juegos con al menos este nº de jugadores.
# Es más bajo que el umbral de cada categoría para poder ver nacer a los
# emergentes desde abajo.
TRACK_MIN_PLAYERS = 300
RAW_RETENTION_DAYS = 35         # días de muestras intradía que se conservan
# Día en que empezó el escaneo de todo Roblox (antes solo había keywords).
# Hasta 2 días después no se marca ningún juego como "recién detectado".
SCAN_START = "2026-10-02"

# ─── Categorías (pestañas del dashboard) ───────────────────────────────────────
#   min_players → mínimo de jugadores típicos (mediana 24h) para salir en la lista
#   classifier  → "all" (todo Roblox) u "horror" (ver HORROR más abajo)
CATEGORIES = {
    "general": {
        "label": "General",
        "icon": "🎮",
        "min_players": 2_500,
        "classifier": "all",
    },
    "horror": {
        "label": "Horror",
        "icon": "👻",
        "min_players": 500,
        "classifier": "horror",
    },
}

# ─── Clasificación de horror ───────────────────────────────────────────────────
# Cada señal suma puntos; un juego es de horror si llega a HORROR["threshold"].
# Se mira el nombre, la descripción y los géneros de Roblox, así que entran
# juegos que no dicen "horror" en el título (escapar de un monstruo, sobrevivir
# a un asesino, backrooms, anomalías…).
# Las etiquetas entre corchetes del nombre ("[HAUNTED]", "[🎃 HALLOWEEN]") se
# ignoran porque suelen ser eventos temporales, salvo las de TAGS.
HORROR = {
    "threshold": 5,
    # NOMBRE · señal fuerte (4 puntos)
    "name_strong": [
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
    # NOMBRE · señal débil (1 punto)
    "name_weak": [
        "escape", "survive", "survival", "hide", "run from", "chased",
        "night", "dark", "fog", "midnight", "shadow", "abandoned",
        "hospital", "prison", "basement", "facility", "lost", "alone",
        "hunt", "blood", "evil", "trapped", "murder", "monster", "demon",
        "zombie", "scream", "story",
    ],
    # NOMBRE · restan (juegos que hablan de "escapar" pero no dan miedo)
    "name_negative": [
        "brainrot", "tsunami", "lucky block", "tycoon", "simulator", "obby",
        "tower", "race", "speed", "anime", "steal a", "steal an", "lava",
        "flood", "admin", "rng", "clicker", "keyboard",
    ],
    # Etiquetas entre corchetes que sí cuentan como señal fuerte
    "tags": ["horror", "scary", "anomaly"],
    # DESCRIPCIÓN · señal fuerte (3 puntos por palabra, tope 5)
    "desc_strong": [
        "horror", "scary", "jumpscare", "jump scare", "creepy", "terrifying",
        "nightmare", "killer", "survive the night", "don't get caught",
        "dont get caught", "hide from", "being hunted", "hunted by",
        "chased by", "paranormal", "spooky", "frightening", "backrooms",
        "entity", "entities", "anomal", "sanity",
    ],
    # DESCRIPCIÓN · señal débil (1 punto por palabra, tope 2)
    "desc_weak": [
        "monster", "creature", "demon", "zombie", "ghost", "haunted", "cursed",
        "lurk", "possessed", "escape", "survive", "dark", "flashlight",
        "run from", "chase", "abandoned", "lights out", "murderer",
    ],
    "points": {
        "name_strong": 4, "name_weak": 1, "name_negative": -3,
        "desc_strong": 3, "desc_strong_cap": 5,
        "desc_weak": 1, "desc_weak_cap": 2,
    },
    # Género antiguo de Roblox: lo elige el propio creador y existe "Horror"
    "legacy_genres": {"Horror": 5},
    # Géneros nuevos de Roblox ("género/subgénero"). Roblox no tiene "Horror"
    # en su taxonomía nueva, pero la mayoría caen en estos.
    "genres": {
        "Survival/1 vs All": 2, "Survival/Escape": 2, "Survival/": 1,
        "Adventure/Story": 1, "Adventure/Exploration": 1,
    },
    # Correcciones manuales por universe_id (tienen prioridad)
    "force_include": [],
    "force_exclude": [],
}

# ─── Juegos emergentes ─────────────────────────────────────────────────────────
# "Emergente" = poco conocido (pocas visitas totales) y empezando a petar.
EMERGING = {
    "max_visits": 30_000_000,   # más visitas que esto → ya es conocido
    "min_players": 300,         # jugadores típicos mínimos para tenerlo en cuenta
    "max_age_days": 120,        # juegos creados hace más tiempo puntúan menos
    "min_score": 45,            # puntuación (0-100) para entrar en la lista
    "max_results": 24,
}

# ─── Detección de eventos / picos ──────────────────────────────────────────────
# Un día cuenta como "evento" si su valor se sale mucho de la mediana de los
# días de alrededor; esos días NO cuentan para las medias.
EVENTS = {
    "window_days": 7,      # ventana de la mediana móvil
    "mad_k": 3.5,          # cuántas desviaciones robustas (MAD) para marcar pico
    "min_ratio": 1.6,      # y además ≥ 1.6× la mediana local
    "spike_now_ratio": 1.8,  # muestra actual ≥ 1.8× lo típico → "pico ahora"
}
