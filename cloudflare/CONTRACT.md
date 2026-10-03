# Roblox Tracker en Cloudflare: contrato entre piezas

Todo vive en un solo Worker, `roblox-tracker`, en el plan **gratis**. Las piezas son módulos ES
sin dependencias en `cloudflare/src/`. Lo que dice este documento es la interfaz entre ellas:
quien lo cambie, que lo actualice aquí.

## Límites del plan gratis

| Límite | Valor | Consecuencia |
|---|---|---|
| CPU por invocación (petición, cron o paso de Workflow) | **10 ms** | Esperar a la red, a D1 o a R2 **no cuenta**. Parsear JSON grande sí: el JSON de Rolimons (~1 MB) cuesta ~3,6 ms en parsear y ~6,5 ms con el filtrado. Cada lote de 50 juegos de la Games API cuesta ~0,17 ms. Calcular métricas de 2.000 juegos cuesta ~49 ms, así que **no se hace en el Worker**, salvo para unos ~150 candidatos en Telegram. |
| Peticiones externas por invocación | **50** | Las de D1, R2 y KV son internas, con un límite de 1.000. |
| Escrituras D1 | 100.000 filas/día | Objetivo: menos de 45.000 (ver "Presupuesto de escrituras"). |
| Lecturas D1 | 5 M filas/día | |
| Cron Triggers por cuenta | 5 | Ya hay 2 en uso. Este Worker usa **1** (`17 */3 * * *`). |

Roblox: la Games API acepta **50 ids como máximo** por llamada (con 100 da el error "Too many universe IDs").
La Search API, si se le pide mucho seguido, devuelve 200 con resultados vacíos: hay que espaciar las búsquedas.

## Módulos y responsables

| Fichero | Qué hace | Responsable |
|---|---|---|
| `src/config.js` | Configuración compartida (no tocar sin avisar) | coordinador |
| `src/index.js` | `fetch` (web y API) y `scheduled` (lanza el Workflow) | backend |
| `src/sampler.js` | `class Sampler extends WorkflowEntrypoint`: el muestreo por pasos | backend |
| `src/sources.js` | Clientes de Rolimons, Explore, Search, Games, Votes, Universe y Thumbnails | backend |
| `src/db.js` + `schema.sql` | Esquema D1, inserciones por lotes, agregados SQL y export | backend |
| `src/metrics.js` | Port de `analytics.py` + `export_dashboard.py`: `buildDashboard()` | métricas |
| `public/dashboard.html` | La web: usa `buildDashboard()` en el navegador | métricas |
| `src/horror.js` | Port de la clasificación de horror y de `clean_title` | telegram |
| `src/telegram.js` | Port de `notifier.py`: decide qué enviar y lo envía | telegram |
| `wrangler.toml` | Configuración de despliegue | backend |

## Esquema D1 (`schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS games (
  universe_id INTEGER PRIMARY KEY,
  place_id INTEGER,
  name TEXT,
  creator TEXT,
  creator_verified INTEGER,      -- 0/1
  created TEXT,                  -- ISO de Roblox
  updated TEXT,
  genre TEXT,                    -- género antiguo (lo elige el creador; existe "Horror")
  genre_l1 TEXT,
  genre_l2 TEXT,
  max_players INTEGER,
  first_seen TEXT,               -- ISO "AAAA-MM-DDTHH:MMZ"
  horror INTEGER,                -- 0/1, calculado con la descripción (que no se guarda)
  horror_score INTEGER,
  horror_reasons TEXT,           -- JSON array de strings
  sources TEXT,                  -- JSON array: "rolimons", "explore", "search:<query>"
  tracked INTEGER DEFAULT 1,     -- 1 = se muestrea en cada pasada
  low_since TEXT,                -- fecha desde la que está por debajo de TRACK_MIN_PLAYERS
  meta_date TEXT                 -- último día en que se refrescaron meta + horror + votos
);
CREATE TABLE IF NOT EXISTS places (place_id INTEGER PRIMARY KEY, universe_id INTEGER);  -- caché Rolimons
CREATE TABLE IF NOT EXISTS samples (
  universe_id INTEGER, ts INTEGER,   -- ts = minutos desde epoch UTC
  playing INTEGER, visits INTEGER,
  PRIMARY KEY (universe_id, ts)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS samples_ts ON samples(ts);
CREATE TABLE IF NOT EXISTS daily (
  universe_id INTEGER, date TEXT,    -- "AAAA-MM-DD" UTC
  n INTEGER, median INTEGER, mean INTEGER, min INTEGER, max INTEGER,
  visits INTEGER, favorites INTEGER, up INTEGER, down INTEGER,
  PRIMARY KEY (universe_id, date)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sort_hits (    -- en qué listas oficiales de Roblox sale cada juego
  universe_id INTEGER, date TEXT, sort_id TEXT, rank INTEGER,
  PRIMARY KEY (universe_id, date, sort_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);  -- Telegram, cursor de búsqueda…
```

- `daily` del **día en curso** no se escribe en cada muestreo: se calcula al vuelo desde `samples` en el
  export. El día anterior se cierra (INSERT … ON CONFLICT DO UPDATE) en el primer muestreo del día siguiente.
  La mediana se calcula en SQL con funciones de ventana (`ROW_NUMBER() OVER (PARTITION BY …)`).
- `favorites`, `up` y `down` se guardan una vez al día, en el paso "meta diario".

## Presupuesto de escrituras D1 (por día)

| Qué | Filas |
|---|---|
| Muestras: ~2.100 juegos × 8 | ~17.000 |
| Borrado de muestras de más de `SAMPLE_RETENTION_DAYS` | ~17.000 |
| Cierre de `daily` | ~2.100 |
| Meta, horror y votos diarios | ~2.100 |
| `sort_hits` y juegos nuevos | ~1.500 |
| **Total** | **~40.000** |

## El muestreo (Workflow `Sampler`, lanzado por el cron cada 3 h)

Cada `step.do` tiene que caber en **10 ms de CPU y 50 peticiones externas**. Si en el plan gratis el límite de
50 resulta ser por invocación y no por paso, hay que separar los pasos pesados con
`step.sleep("…", "1 second")`. Hay que verificarlo en local o en la documentación.

1. **explore**: `apis.roblox.com/explore-api/v1/get-sorts` (con paginación `sortsPageToken`) y
   `get-sort-content` para las listas con `nextPageToken` (~9 llamadas). Se insertan los juegos nuevos
   (`universeId`, `rootPlaceId`, `name`) y se guarda `sort_hits` del día.
2. **search**: `SEARCH_QUERIES_PER_RUN` búsquedas, por turnos (cursor en `state.search_cursor`), en
   `apis.roblox.com/search-api/omni-search?searchQuery=…&sessionId=<uuid>&pageType=all`, hasta
   `SEARCH_PAGES_PER_QUERY` páginas. Se insertan los juegos nuevos con ≥ TRACK_MIN_PLAYERS.
3. **rolimons** (solo en el primer muestreo de cada día UTC): se descarga
   `api.rolimons.com/games/v1/gamelist` y se filtra por ≥ TRACK_MIN_PLAYERS. Luego se resuelven los place_id
   desconocidos con `apis.roblox.com/universes/v1/places/{id}/universe`: máximo 40 por paso, varios pasos y
   tope de 200 al día. Los juegos nuevos entran como `tracked=1`.
4. **sample-N**: `SELECT universe_id FROM games WHERE tracked=1`, en trozos de **≤ 20 lotes de 50**
   (1.000 juegos) por paso. Se llama a `games.roblox.com/v1/games?universeIds=…` y se insertan `samples`
   (playing, visits).
5. **meta diario** (primer muestreo del día): por trozos, se refrescan nombre, creador, géneros, fechas y
   max_players; se calcula el horror con la descripción (`horror.js`) **sin guardarla**; se piden los votos
   (`games.roblox.com/v1/games/votes`) y los favoritos, que van a `daily` del día anterior.
6. **cierre**: se cierra `daily` del día anterior si hace falta, se borran las muestras viejas y se aplica
   `tracked=0` a los juegos que llevan `UNTRACK_AFTER_DAYS` por debajo del mínimo (salvo que hayan salido en
   explore o search en las últimas 24 h).
7. **export**: SQL → JSON (formato abajo) → R2 `data/export.json`.
8. **telegram**: `telegram.js` lee el export de R2, calcula con `metrics.js` solo los candidatos
   (prefiltro descrito abajo) y envía lo que toque.

## Formato de `/api/export` (= R2 `data/export.json`)

Lo genera `db.js` (backend) y lo consume `buildDashboard()` (métricas).

```jsonc
{
  "generated_at": "2026-10-03T03:20:11Z",
  "last_sample": "2026-10-03T03:17Z",       // ts de la última muestra, ISO al minuto
  "samples_24h": 8,                          // nº de ts distintos en las últimas 24 h
  "games": [
    {
      "id": 10563114921, "place_id": 107778070777162, "name": "Steal An Egg",
      "creator": "…", "creator_verified": true, "created": "…", "updated": "…",
      "genre": "All", "genre_l1": "Simulation", "genre_l2": "Tycoon", "max_players": 7,
      "first_seen": "2026-08-14T10:07Z",
      "horror": false, "horror_score": 0, "horror_reasons": [],
      "sorts": {"top-trending": 3, "up-and-coming": 12},   // listas de Roblox HOY (rank 1-based)
      "favorites": 6460675, "up": 3069435, "down": 250927,  // últimos conocidos
      "peak": 3475462, "peak_date": "2026-09-19",            // de toda la historia (max de daily.max)
      "days_tracked": 51,                                    // nº total de filas en daily (+ hoy)
      "first_day": "2026-08-14",                             // primera fecha en daily
      // Últimos EXPORT_DAILY_DAYS días, en orden ascendente. El último puede ser HOY (parcial, desde samples).
      "d": [["2026-10-02", 1437176, 1178609, 1695743, 2, 6312556551]],  // [date, median, min, max, n, visits]
      // Muestras de las últimas EXPORT_SAMPLE_HOURS h, ascendente: [ts_minutos_epoch, playing, visits|null]
      "s": [[29324857, 1695743, 6312556551]]
    }
  ]
}
```

**Qué juegos entran**: los que tienen muestras en las últimas 48 h y cumplen al menos una de estas:
- máximo de 24 h ≥ `CATEGORIES.general.min_players`;
- `horror=1` y máximo de 24 h ≥ `CATEGORIES.horror.min_players`;
- visits < `EMERGING.max_visits` y máximo de 24 h ≥ `EMERGING.min_players`.

Objetivo: menos de 1 MB.

## `buildDashboard(exportData, { now })` (`metrics.js`)

Devuelve **exactamente el mismo esquema que el `data/dashboard.json` actual**, el que genera
`export_dashboard.py`, para que el dashboard y Telegram apenas cambien:

```
{ updated_at, last_sample, samples_24h, track_min_players, emerging_max_visits,
  categories: { general|horror: { label, icon, min_players, ids[], emerging[], trending[],
                                  stats: { games, players, rising, falling, events, new_7d } } },
  games: { "<id>": { id, place_id, name, title, tags, creator, creator_verified, genre, subgenre,
                     max_players, created, updated, horror, horror_score, horror_reasons,
                     emerging, emerging_reasons, spark, spark_ev, players, players_ts, typical,
                     avg_7d, growth_24h, growth_7d, trend, spike_now, event_days, peak, peak_date,
                     visits, visits_day, visits_growth, favorites, like_ratio, votes, age_days,
                     updated_days, first_seen_days, fresh, new_week, days_tracked, samples_today,
                     status, momentum, roblox_sorts } } }
```

Campo nuevo: `roblox_sorts` (el `sorts` del export). Si un juego está en `EMERGING.roblox_sorts`, suma
puntos de emergente y añade el motivo "Roblox: Up-and-Coming" o "Roblox: Top Trending".

También exporta `flagEvents(values, dates)`, para el gráfico de `/api/history`, y `cleanTitle`, que se
reexporta desde `horror.js`.

## `/api/history/:id`

```jsonc
{ "d": [["2026-06-01", median, min, max, n], …],   // HISTORY_DAYS días, ascendente (incluye hoy parcial)
  "r": [["2026-10-02T15:34Z", playing], …] }      // HISTORY_SAMPLE_DAYS días de muestras
```

El dashboard calcula los días de evento con `flagEvents`.

## Rutas del Worker

- `GET /` → `public/dashboard.html` (R2 `site/dashboard.html`); `/favicon.svg`.
- `GET /config.js`, `/metrics.js` y `/horror.js` → los módulos de `src/` (los importa el navegador).
- `GET /api/export` → R2 `data/export.json` (`cache-control: max-age=60`).
- `GET /api/history/:id` → consulta D1.
- `GET /api/live`, `/api/thumbs` y `/api/game/:id` → como en `worker/worker.js` (jugadores, iconos y
  miniaturas en vivo).
- El dominio `robloxtracker.stonksstudio.com` está detrás de Cloudflare Access. `*.workers.dev` responde
  404 a todo salvo a `/api/admin/*`, que necesita `Authorization: Bearer <ADMIN_TOKEN>`: lanzar un
  muestreo, ver el estado y cargar la migración.

## Telegram: prefiltro de candidatos

`telegram.js` pasa a `buildDashboard()` un export reducido. Tiene solo los juegos que pueden salir en los
mensajes:
- emergentes posibles: visits < max_visits y típico ≥ 300 (o en `up-and-coming`);
- top 60 por crecimiento de 24 h y top 60 por típico.

Son unos 150 juegos y el cálculo cuesta ~4 ms. El estado (`alerted`, `last_daily`, `last_weekly`) se guarda
en D1 `state`, clave `telegram`. Los secrets son `TELEGRAM_TOKEN` y `TELEGRAM_CHAT_ID`.
