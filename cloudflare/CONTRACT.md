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
| Cron Triggers por cuenta | 5 | Ya hay 2 en uso. Este Worker usa **1** (`0 */3 * * *`). |

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
-- (sin índice por ts: ver la nota 1 al final)
CREATE TABLE IF NOT EXISTS daily (
  universe_id INTEGER, date TEXT,    -- "AAAA-MM-DD" UTC
  n INTEGER, median INTEGER, mean INTEGER, min INTEGER, max INTEGER,
  visits INTEGER, favorites INTEGER, up INTEGER, down INTEGER,
  PRIMARY KEY (universe_id, date)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sort_hits (    -- listas de Roblox (sort_id) y búsquedas ("search:<query>")
  universe_id INTEGER, date TEXT, sort_id TEXT, rank INTEGER,
  PRIMARY KEY (universe_id, date, sort_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT);  -- Telegram, cursor de búsqueda…
CREATE TABLE IF NOT EXISTS hist (           -- agregados de toda la serie diaria (antes state.hist_agg)
  universe_id INTEGER PRIMARY KEY,
  peak INTEGER, peak_date TEXT, days INTEGER, first_day TEXT,
  favorites INTEGER, up INTEGER, down INTEGER, last_date TEXT
);
```

- `daily` del **día en curso** no se escribe en cada muestreo: se calcula al vuelo desde `samples` en el
  export. El día anterior se cierra (INSERT … ON CONFLICT DO UPDATE) en el primer muestreo del día siguiente.
  La mediana se calcula en SQL con funciones de ventana (`ROW_NUMBER() OVER (PARTITION BY …)`).
- `favorites`, `up` y `down` se guardan una vez al día, en el paso "meta diario".
- `state` (claves): `telegram`, `search_cursor`, `last_sample_ts`, `last_run` y `last_partial_run` (resumen
  de la última pasada). Marcas de las tareas del día (ver "Tareas del día"): `meta_day` (antes `day`, que se
  sigue leyendo si falta), `closed_day` (último día cerrado en `daily`), `sel_day`, `maint_day` y
  `daily_tries` (`{day, meta, close, select, maint}`: intentos de hoy, contados al empezar cada tarea). Cachés para leer menos (ver "Lecturas
  fuera del export"): `radar_counts`, `radar_places` y `espacio`. `hist_agg` ya no existe: era un JSON con
  todos los juegos en una fila y crecía hacia el tope de 2 MB por fila de D1; ahora es la tabla `hist`
  (la primera pasada tras desplegar pasa los datos y borra la clave).
- `hist`: pico, fecha del pico, días, primer día, últimos favoritos y votos y último día de toda la serie
  diaria de cada juego. La mantiene `close-hist` (UPSERT por juego desde el día cerrado: ~2.800 filas
  escritas al día); la leen el export y select por clave primaria; `maint` borra los juegos sin filas
  diarias desde hace `DATA_RETENTION_DAYS`.

## Presupuesto de escrituras D1 (por día)

| Qué | Filas |
|---|---|
| Muestras: ~2.300 juegos con ≥ 300 jugadores × 8 (los de menos no se guardan, como en tracker.py) | ~18.500 |
| Borrado de muestras de más de `SAMPLE_RETENTION_DAYS` | ~18.500 |
| Cierre de `daily` (con favoritos y votos en la misma fila) | ~2.300 |
| Meta y horror (solo las fichas que cambian) | ~1.200 |
| `sort_hits` (explore + search) y juegos nuevos | ~2.500 |
| `low_since`, `state` | ~500 |
| `hist` (una fila por juego del radar al cerrar el día) | ~2.800 |
| **Total** | **~45.000–50.000** (medido en local: ~2.770 por pasada normal; el objetivo de 45.000 queda justo) |

Sin el índice `samples_ts` (D1 cuenta una fila más por índice): con él serían ~80.000.

## El muestreo (Workflow `Sampler`, lanzado por el cron cada 3 h)

Cada `step.do` tiene que caber en **10 ms de CPU y 50 peticiones externas**. La documentación da la CPU
"por paso" pero las peticiones "50/request" (por invocación) sin aclarar si cada paso es una invocación, y en
local no se aplican los límites. Por eso cada paso pide como mucho 45 (clase `Budget` de `sources.js`) y
**antes de cada paso con red hay un `step.sleep("…", "1 second")`** (no cuenta como paso). Tamaños y CPU
medida: ver `README.md` ("CPU por paso").

Nombres reales de los pasos: `init` → `explore-0..P` (una página de get-sorts por paso) → `explore-more`
(get-sort-content) → `search-0..2` → `search-cursor` → [`rolimons` → `resolve-0..4`] → `sample-list` →
`sample-0..M` (400 juegos; con el meta del día 50 juegos con meta, horror y votos) → [`meta-done`] →
`radar-api` → [`close` → `close-radar-<día>-0..9` → `close-hist`] → [`select-plan` → `select-0..R` →
`select-apply` → `select-backfill`] → [`maint`] → `export-plan` → `export-0..E` → `export-join` →
`tg-scan-i-j` → `tg-reduce` → `tg-pick-i` → `tg-write` → `telegram` → `finish`. Entre corchetes, lo que no
va en todas las pasadas (las tareas del día: ver "Tareas del día y filas leídas").

1. **explore**: `apis.roblox.com/explore-api/v1/get-sorts` (con paginación `sortsPageToken`) y
   `get-sort-content` para las listas con `nextPageToken` (~9 llamadas). Se insertan los juegos nuevos
   (`universeId`, `rootPlaceId`, `name`) **con ≥ TRACK_MIN_PLAYERS** y se guarda `sort_hits` del día (mejor
   puesto del día) de los juegos que ya están en `games`.
2. **search**: `SEARCH_QUERIES_PER_RUN` búsquedas, por turnos (cursor en `state.search_cursor`), en
   `apis.roblox.com/search-api/omni-search?searchQuery=…&sessionId=<uuid>&pageType=all`, hasta
   `SEARCH_PAGES_PER_QUERY` páginas. Se insertan los juegos nuevos con ≥ TRACK_MIN_PLAYERS y su puesto va a
   `sort_hits` con `sort_id = "search:<query>"` (sirve para la excepción del untrack; el export no los muestra).
3. **rolimons** (solo en el primer muestreo de cada día UTC): se descarga
   `api.rolimons.com/games/v1/gamelist` y se filtra por ≥ TRACK_MIN_PLAYERS. Luego se resuelven los place_id
   desconocidos con `apis.roblox.com/universes/v1/places/{id}/universe`: máximo 40 por paso, varios pasos y
   tope de 200 al día. Los juegos nuevos entran como `tracked=1`.
4. **sample-N**: `SELECT universe_id FROM games WHERE tracked=1`, en trozos de **8 lotes de 50**
   (400 juegos) por paso (con 1.000, parsear 1,4 MB de la Games API ya cuesta ~12 ms). Se llama a
   `games.roblox.com/v1/games?universeIds=…` y se insertan `samples` (playing, visits) **solo con ≥
   TRACK_MIN_PLAYERS**; `low_since` se actualiza con todos.
5. **meta diario** (primer muestreo del día, dentro de los mismos pasos sample-N con trozos de 50): se refrescan nombre, creador, géneros, fechas y
   max_players; se calcula el horror con la descripción (`horror.js`) **sin guardarla**; se piden los votos
   (`games.roblox.com/v1/games/votes`) y los favoritos, que van a `daily` del día anterior.
6. **cierre**: se cierra `daily` del día anterior si hace falta, se borran las muestras viejas y se aplica
   `tracked=0` a los juegos que llevan `UNTRACK_AFTER_DAYS` por debajo del mínimo (salvo que hayan salido en
   explore o search en las últimas 24 h).
7. **export** (por trozos: recibir de D1 un JSON de ~2 MB costaría ~13 ms solo en decodificarlo):
   `export-plan` reparte los juegos en rangos de universe_id (500 seguidos por rango); cada `export-i` genera
   en SQLite los objetos de su rango y los guarda en R2 `tmp/export/part-<i>.json`; `export-join` escribe
   `data/export.json` = cabecera + partes + cierre con un `FixedLengthStream` (las partes no pasan por JS).
   Los juegos van en orden de universe_id.
8. **telegram.json**: `tg-scan-i-j` aplica `telegramScanText` (de `telegram.js`) a la parte i en trozos de
   50 juegos; `tg-reduce` junta las filas y elige los candidatos con `pickCandidates`; `tg-pick-i` copia
   sus objetos del texto de la parte i (sin parsearlos ni volver a D1) y `tg-write` escribe R2
   **`data/telegram.json`**: mismo formato que el export, solo los candidatos (~60–90),
   más `totals` y `telegram: {counts, total, candidates}` (cabeceras exactas: games, players, rising, falling
   por categoría).
9. **telegram**: lee `data/telegram.json` y llama a `runTelegram({ env, exportData, now, getState, setState,
   force })`.

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
      // Últimas EXPORT_DAILY_DAYS FILAS del juego (no días de calendario), ascendente. Las de días sin
      // cerrar (hoy, parcial) salen de samples. visits solo en las 2 últimas filas que la tienen (null en
      // el resto: es lo único que usa metrics.js).
      "d": [["2026-10-02", 1437176, 1178609, 1695743, 2, 6312556551]],  // [date, median, min, max, n, visits]
      // Muestras desde (última muestra − EXPORT_SAMPLE_HOURS h), incluida, ascendente: [ts_minutos_epoch,
      // playing, visits|null]. visits solo en la última muestra que la tiene y en la última ≥ 20 h anterior.
      "s": [[29324857, 1695743, 6312556551]]
    }
  ]
}
```

**Qué juegos entran**: los que tienen muestras en las últimas 48 h y cumplen al menos una de estas:
- máximo de 24 h ≥ `CATEGORIES.general.min_players`;
- `horror=1` y máximo de 24 h ≥ `CATEGORIES.horror.min_players`;
- visits < `EMERGING.max_visits` y máximo de 24 h ≥ `EMERGING.min_players`.

Objetivo inicial: menos de 1 MB. **No se cumple en régimen**: ~1.400 juegos × ~1,7 KB ≈ 2,3 MB
(~0,4 MB comprimido, que es lo que viaja). Por eso el export se genera por trozos y Telegram usa
`data/telegram.json`. El "máximo de 24 h" del filtro se mide desde la última muestra.

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

(Admin: `POST /api/admin/run` `{daily?, skip?, only?, telegram_force?, now?}`, `GET /api/admin/status?id=&counts=1`
(filas del desglose de `espacio()`; `counts=exacto` las cuenta recorriendo las tablas), `GET /api/admin/espacio[?exacto=1]`,
`POST /api/admin/import` `{table, columns, rows}`, `POST /api/admin/rebuild` (recalcula la tabla `hist` desde
`daily` y lanza un export), `POST /api/admin/export` (lanza un Workflow solo de export), `POST /api/admin/backfill` `{ids?}`
(muestras desde el radar de 48 h; ver «Radar y juegos seguidos»). El esquema se aplica con
`wrangler d1 execute`, no por la API.)

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

(Backend: este prefiltro se hace en los pasos `tg-scan-*`/`tg-reduce`/`tg-pick-*` con `telegramScanText` y
`pickCandidates` de `telegram.js`, y el resultado es R2 `data/telegram.json`; ver el paso 8 del muestreo.)

`telegram.js` pasa a `buildDashboard()` un export reducido. Tiene solo los juegos que pueden salir en los
mensajes:
- emergentes posibles: visits < max_visits y típico ≥ 300 (o en `up-and-coming`);
- top 60 por crecimiento de 24 h y top 60 por típico.

Son unos 150 juegos y el cálculo cuesta ~4 ms. El estado (`alerted`, `last_daily`, `last_weekly`) se guarda
en D1 `state`, clave `telegram`. Los secrets son `TELEGRAM_TOKEN` y `TELEGRAM_CHAT_ID`.

## Notas del backend (cambios respecto a la primera versión)

1. **Sin índice `samples_ts`.** D1 cuenta una fila escrita más por cada índice: con él, las muestras (insertar
   + borrar) pasaban de ~37.000 a ~74.000 filas/día. Las consultas por tiempo recorren `games` y buscan en
   `samples` por la clave primaria (`CROSS JOIN`), así que leen solo las filas necesarias.
2. **Tabla `hist`** (antes `state.hist_agg`): pico, fecha del pico, días, primer día y últimos favoritos/votos
   de toda la historia, mantenidos al cerrar cada día (~2.800 filas escritas al día; con la clave era 1 fila,
   pero crecía ~8 KB al día hacia el tope de 2 MB por fila). Sin esto, cada export leería `daily` entera.
3. **Lecturas D1**: D1 cuenta cada fila que pasa por un cursor, también las de las CTE materializadas, las
   ordenaciones, las ventanas y `json_each` (comprobado en producción el 04/10/2026: el mismo SQL da casi las
   mismas filas que en local). Con el export cada hora era el ~57 % del día. Desde el 04/10/2026 cada
   juego recorre sus muestras de 48 h una sola vez y lo demás sale de funciones JSON escalares; Telegram no
   vuelve a D1; los rangos salen de `state.sel_ids` (los seguidos, que escribe `select-apply` junto con
   `games.sel`); y las filas cerradas de `d` se calculan una vez al día en `state.export_d`
   (`{day: openDay, g: {id: entrada}}`, ~250 KB con ~220 seguidos). Las muestras no se guardan ahí, así que
   insertar muestras con fechas pasadas no lo invalida; quien reescriba filas de `daily` de días ya cerrados
   fuera del cierre tiene que borrar `export_d` (`dropExportCacheStmt`; ya lo hacen `/api/admin/import` de
   `daily` y `/api/admin/rebuild`). Medido en local con los datos del 04/10 16:00: ~13.700 filas por pasada
   (antes ~144.000), y ~5.000 más en la primera del día.
4. **Muestras < TRACK_MIN_PLAYERS no se guardan** (como en tracker.py): ahorra ~5.000 escrituras al día.
5. **`EXPORT_DAILY_DAYS = 24`** y `d` = últimas N filas por juego (paridad con Python, pedido por métricas).
   El filtro de emergentes exige visitas conocidas (de samples o, si no, la última de `daily`), como
   make_export.py. Mediana y media de `daily` redondean los .5 al par, como `round()` de Python.
6. **`data/telegram.json`** (nuevo, ver el paso 8 del muestreo).

## Nota del coordinador (03/10/2026): 50 peticiones por invocación

Comprobado en producción: en el plan gratis el límite de 50 peticiones externas es **por invocación**, y
los pasos de una instancia de Workflow comparten invocación (ni el `step.sleep` de 1 s ni los reintentos
la cambian). Error: «Too many subrequests by single Worker invocation».

Solución (`sampler.js`):
- **Cuenta común por invocación.** Cada pasada lleva un `Budget(INVOCATION_BUDGET = 46)` para toda la
  invocación. Cada paso coge su parte con `SubBudget`.
- **Pasada en varias ejecuciones encadenadas.** Antes de un paso con red se comprueba si caben sus
  peticiones. Si no caben, se crea la siguiente ejecución (`<id>-s<N>`) con `phase` y `cursor`, y la
  actual termina. Las fases son discover → search → rolimons → resolve → sample → radar-api → finalize.
- **Datos entre ejecuciones.** Las listas que necesita la siguiente ejecución (ids, places por resolver y
  votos) van a R2 `tmp/run/<id>/` y se borran en `finish`.
- **Estado.** D1 `state.run_current` dice qué ejecución va ahora; `/api/admin/status` la enseña.

Medido en producción:
- pasada normal: 3 ejecuciones;
- primera pasada del día: 6 ejecuciones y ~3,5 min;
- 0 errores.

Hay invocaciones con más de 10 ms de CPU porque suman varios pasos (hasta 168 ms), y terminan en `ok`: el
límite de CPU se aplica por paso.

## Radar y juegos seguidos (03/10/2026)

Se pasa de muestrear todo el catálogo (~2.500 juegos) a un **radar** de todo y
**~200 juegos seguidos** (`SELECTION` en `config.js`).

- `games.sel` (0/1): seguido. Lo escribe el paso `select` una vez al día, con el
  día anterior cerrado (`state.sel_day`, resumen en `state.selection`). Base anterior:
  `ALTER TABLE games ADD COLUMN sel INTEGER DEFAULT 0`.
- Radar: en cada pasada, `rolimons` lee la lista de Rolimons (≥ 150 jugadores),
  la cruza con `places` y con `games.place_id` y guarda `{universe_id: jugadores}` en R2
  `radar/<día>/<ts>.json` (un fichero por muestreo; 7 días).
- Los del radar sin lectura de Rolimons (04/10/2026, J-Z): el 04/10, 358 de 2.752, casi todos
  juegos que entraron por Explore o el buscador y que Rolimons no lista (334; otros ~25 salen con menos
  de 150 jugadores). Los que no se siguen (~320; los seguidos ya tienen muestras cada hora) los lee el
  paso `radar-api` con la Games API, después de las muestras, y van al mismo fichero (desde
  `RADAR_MIN_PLAYERS`): 7 peticiones por lectura del radar, como mucho `RADAR_API_MAX` = 400 juegos.
  La lista pasa por R2 `tmp/run/<id>/radar-api.json`. Así el cierre y el relleno de los que entran
  tienen sus lecturas cada 3 h. Si la Games API corta por ráfaga (429), se pierde esa lectura del radar
  (el paso escribe lo que ha recibido) y las muestras de los seguidos, que van antes, no se tocan.
- `samples` y votos solo de los seguidos. El meta diario (Games API) sigue siendo de
  todo el radar: ficha, horror, y jugadores y visitas de los no seguidos, que van al
  cierre por `tmp/run/<id>/votes-<i>.json` = `{v: votos de seguidos, r: [{id: [playing, visits]}, …]}`
  (`r` ya repartido en las `RADAR_CLOSE_PARTS` partes de `close-radar`; el cierre acepta también el `r`
  sin repartir de antes).
- Cierre del día: `close` (`closeDayStmt`, desde samples: todos los juegos con muestras del día, que
  un `EXISTS` por la clave primaria separa sin materializar los demás; no solo los seguidos de ahora,
  porque los que salen en un select tienen muestras de antes de salir), `close-radar-<día>-0..9`
  (`radarDailyRows` en el Worker, por partes según la última cifra del id, y `radarCloseStmt`
  con las filas ya agregadas; mismas mediana y media; los 8 ficheros del día se leen de R2 y se
  comprueban una vez por ejecución para todas las partes) y `close-hist` (`hist` y `closed_day`).
  Si un juego tiene las dos, se queda la que tiene más lecturas. Antes de tocar `hist` (`close`,
  `close-hist`, `select-plan`, `export-plan` e `init`), `migrateHist`: una ejecución encadenada que creó
  el código de antes no pasa por el `init` nuevo.
- `select`: `select-plan` → `select-<i>` (250 juegos por paso: últimas 14 filas
  diarias + `radarScore` de `metrics.js`, ≈ 5 ms en frío) → `select-apply`
  (`chooseSelection` de `sampler.js`). Top 10 por jugadores en general y en horror,
  150 mejores candidatos general y 50 de horror (completados por jugadores si no
  hay bastantes), y los ya seguidos dentro del 150 % de su lista.
- Export: solo los seguidos, de `state.sel_ids` (la última selección válida). Sin
  ninguna selección no se reexporta (antes exportaba todo el radar: ~150.000 filas
  por pasada) y se queda el export de antes. La cabecera añade `radar_games` y `selected_games`. `buildDashboard` añade `categories.*.top`
  (10 primeros por jugadores) y las dos categorías bajan `min_players` a 300.
- Admin: `POST /api/admin/run {"only":["select"],"select":true}` rehace la selección.
- Relleno de los que entran (`select-backfill`, `backfillFromRadar` de `sampler.js` +
  `backfillSamplesStmt` de `db.js`): un juego que pasa de `sel = 0` a 1 no tiene muestras
  de antes, y la vista «Día» de su ficha salía vacía hasta 24 h después. Se copian a
  `samples` las lecturas del radar de las últimas 48 h (como mucho 16 ficheros de R2) en el
  ts de cada fichero, con `visits` NULL (el radar no las tiene), desde TRACK_MIN_PLAYERS y
  con `INSERT OR IGNORE` (nunca pisa una muestra). Tope de 150 juegos (los de más
  jugadores): ≤ 2.400 filas al día, y otras tantas al podarlas. Esas filas llegan con ts
  del pasado (días ya cerrados y el día abierto): quien mantenga agregados de `samples`
  tiene que contarlas. Cubre lo que haya en los ficheros del radar (Rolimons y `radar-api`).
  `POST /api/admin/backfill {ids?}` hace lo mismo a mano (por defecto, con todos los
  seguidos; solo escribe las muestras que faltan).

## Cada hora y un año de datos (03/10/2026)

- Cron `0 * * * *`. Muestras de los seguidos cada hora; el radar (Rolimons) solo
  cada `RADAR_EVERY_HOURS` = 3 h y en la 1ª pasada del día; el buscador, 1 palabra
  por pasada (`SEARCH_QUERIES_PER_RUN` = 1).
- `DATA_RETENTION_DAYS` = 365: en la 1ª pasada del día `maint` borra `daily` y
  `sort_hits` anteriores (`pruneOldStmts`, por clave primaria juego a juego).
- `/api/history/:id`: `d` = 365 días de `[fecha, mediana, mín, máx, n, 0, media]`
  (el 0 es el hueco donde la web marca los eventos) y `r` = muestras de 2 días.
  La ficha: Día (por horas, 24 h) / Semana / Mes / Año (media + mín–máx).
- Telegram: si un envío falla con `migrate_to_chat_id` (el grupo pasó a supergrupo),
  se reintenta con el id nuevo y se guarda en `state.telegram.chat_migrated = {from, to}`;
  se usa mientras `TELEGRAM_CHAT_ID` siga siendo `from`.

## En el ecosistema STONKS (03/10/2026)

- R2: el binding `BUCKET` apunta al bucket común `stonks-archivos` y el código usa
  `appBucket()` (`src/stonks.js`), que mete todas las claves en `roblox-tracker/`.
  El resto del código sigue con claves cortas (`data/export.json`, `radar/…`).
- `export class Operaciones` (`src/stonks.js`), para el Almacén por service binding:
  `espacio()` → el `Espacio` del contrato del ecosistema con la base D1
  (`meta.size_after`, filas y bytes por tabla, y `mayores` frente a los 500 MB de D1;
  el desglose por tabla se rehace como mucho una vez al día, ver "Lecturas fuera del export");
  `nombres(rutas)` → nombre de hoy de sus carpetas (`site/`, `data/`, `radar/<día>/`…).
- El Almacén cuenta las bases D1 aparte de los Durable Objects (`d1` en su medida).
- `cloudflare/tools/uploader.js`: el Worker auxiliar `roblox-uploader` (con
  `ADMIN_TOKEN`) que sube la web y los bundles de despliegue a esa carpeta.

## Lecturas fuera del export (04/10/2026)

El plan gratis da 5 M filas leídas al día a D1; al pasarse, todas las consultas fallan hasta las 00:00 UTC.
Medido con la base de producción del 04/10 en local (`meta.rows_read`):

| Qué | Antes | Ahora |
|---|---|---|
| `espacio()` (Almacén, cada vez que se abre y la medida tiene > 10 min) | recorría todas las tablas: ~61.000 filas por llamada, ~2 M dentro de un año | 1 fila; el desglose se rehace como mucho una vez al día (~47.000 hoy, ~85.000 en régimen) |
| `status?counts=1` | ~61.000 | lo de `espacio()` |
| `maint`: poda de muestras + untrack, cada hora | ~6.000 + ~2.900 por pasada | una vez al día (`state.maint_day`): ~3.000 + 2 por muestra borrada, y 2.900 |
| `radarCounts` (cabecera del export, cada hora) | 2.935 | 1 (`state.radar_counts`, del día; lo borran select y maint) |
| `radarPlayers` (cada lectura del radar) | ~9.700 | 2 (`state.radar_places`, pares place → juego, y `state.sel_ids`; ~8.100 al rehacerlo, con `games.place_id`) |
| lista de seguidos (`sample-list`, cada hora) | 2.935 | 221 (índice parcial `games_sel`) |
| `upsertDiscoveredStmt` (cada página de explore y cada búsqueda) | ~3 por juego | ~2 por juego (`instr` en vez de `json_each` sobre `sources`) |

- **Índice parcial `games_sel`** (`ON games (universe_id) WHERE sel = 1`): solo guarda los ~200 seguidos, así
  que solo se escribe cuando un juego entra o sale de la selección (unas decenas de filas al día; crearlo
  escribe ~220). `samples` sigue sin índice por ts.
- **Muestras**: con la poda diaria duran hasta un día más que `SAMPLE_RETENTION_DAYS` (nada lee muestras tan
  viejas: el export, el cierre y el historial buscan por clave primaria desde una fecha).
- **Lo que tarda en verse**: un juego que explore añade o vuelve a seguir durante el día entra en
  `radar_games` y en las lecturas del radar al día siguiente (o antes, si se resuelven places o corre select).
- **`espacio()`**: `base.bytes` (lo que cuenta para el tope) sale en cada llamada. Del desglose, `daily` se
  estima con los días de `hist`, `sort_hits` con las filas de ayer × días + las de hoy y `samples` con las
  de las 24 h hasta la última muestra × los días desde la más vieja (antes se contaba entera: ~50.000 filas);
  las demás tablas, pequeñas, se cuentan. La forma de la respuesta no cambia.
  `GET /api/admin/espacio?exacto=1` las cuenta todas.

## Tareas del día y filas leídas (05/10/2026)

El tracker iba a ~1,03 M filas leídas al día (~1,2 M en régimen) y la pasada de las 00:00 leía ~480.000.
Medido con `test/filas.bench.mjs` (pasadas completas del Workflow sobre un D1 local del tamaño de
producción; ver README): la pasada de las 00:00 pasa de ~555.000–620.000 a ~180.000–220.000 y el día, de
~1,07–1,16 M a ~0,69–0,73 M.

- **Tareas del día** (`DAILY_TASKS` de `sampler.js`): `meta` (meta, horror y votos de todo el radar, y los
  places de Rolimons), `close`, `select` y `maint`, cada una con su marca (`meta_day`, `closed_day`,
  `sel_day`, `maint_day`) y como mucho `DAILY_TRIES` = 2 intentos al día (`daily_tries`). `init` solo
  decide cuáles tocan; el intento se cuenta en un paso `try-<tarea>` al empezar la tarea (el meta, al
  empezar sus trozos de `sample-N`): una pasada que se corta antes no gasta intentos y repetir `init` no
  cuenta dos veces. Antes había una sola marca (`day`) que escribía el cierre: si el cierre fallaba, cada
  hora se repetían el meta de todo el radar, el cierre, select y maint (~450.000 filas por hora).
  `{"daily": true}` en `/api/admin/run` las fuerza todas y `{"daily": ["close"]}` solo las de la lista.
  Una tarea pendiente sin intentos sale en `last_run.pendiente`; el cierre recoge al día siguiente los días
  que falten (hasta `SAMPLE_RETENTION_DAYS`). Si el cierre falla después del meta, al reintentarlo ya no
  tiene los votos de ese día si el paso `close` no llegó a escribirlos (se quedan los últimos conocidos en
  `hist`), ni el meta de los no seguidos para las partes de `close-radar` que faltaban.
- **Cierre** en pasos (ver "Radar y juegos seguidos"): `radarCloseStmt` ya no ordena las lecturas en SQL
  (~233.000 filas) sino que recibe las filas agregadas en el Worker (~5.600); `closeDayStmt` lee cada juego
  con muestras del día una vez con su lista ordenada (`sortedMedian`) en vez de `ROW_NUMBER()`/`COUNT()
  OVER` (~56.000 → ~19.000); `mergeHistStmt` es un UPSERT en `hist` (~28.000 → ~8.500).
- **maint**: sin la poda de muestras huérfanas (recorría `samples` entera; nada deja huérfanas: `games` no
  pierde filas y todo lo que inserta muestras sale de `games`; solo `/api/admin/import` podría), con la poda
  de `hist`, y borra las cachés del radar solo si `untrack` cambia algo (en el mismo batch, con `changes()`:
  si el paso se repite tras escribir, no se quedan sin borrar).
- **select**: los rangos salen de los ids del radar (`radarIds`: `state.radar_places` si es de hoy, o una
  pasada por `games`) en vez de `ROW_NUMBER()` sobre `games`; `radarSlice` da la vuelta a las filas diarias
  en el Worker (ordenarlas otra vez en SQL contaba cada fila dos veces): ~86.000 → ~47.000. `select-apply`
  borra `radar_counts` solo si cambia la selección (también con `changes()`, en el mismo batch; y ya no
  `radar_places`, que no depende de `sel`).
- **Relleno** (`backfillSamplesStmt`): busca en el texto del fichero solo los ids que entran, en vez de un
  `json_each` del fichero entero (~45.000 → ~2.200).
- **Export sin selección**: ver "Radar y juegos seguidos".

