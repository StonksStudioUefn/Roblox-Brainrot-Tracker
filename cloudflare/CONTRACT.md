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
```

- `daily` del **día en curso** no se escribe en cada muestreo: se calcula al vuelo desde `samples` en el
  export. El día anterior se cierra (INSERT … ON CONFLICT DO UPDATE) en el primer muestreo del día siguiente.
  La mediana se calcula en SQL con funciones de ventana (`ROW_NUMBER() OVER (PARTITION BY …)`).
- `favorites`, `up` y `down` se guardan una vez al día, en el paso "meta diario".
- `state` (claves): `telegram`, `search_cursor`, `day` (último día con la 1ª pasada hecha), `closed_day`
  (último día cerrado en `daily`), `last_sample_ts`, `hist_agg` (agregados de toda la historia por juego:
  `{id: [peak, peak_date, days, first_day, favorites, up, down, last_date]}`, se actualiza al cerrar cada día),
  `last_run` y `last_partial_run` (resumen de la última pasada).

## Presupuesto de escrituras D1 (por día)

| Qué | Filas |
|---|---|
| Muestras: ~2.300 juegos con ≥ 300 jugadores × 8 (los de menos no se guardan, como en tracker.py) | ~18.500 |
| Borrado de muestras de más de `SAMPLE_RETENTION_DAYS` | ~18.500 |
| Cierre de `daily` (con favoritos y votos en la misma fila) | ~2.300 |
| Meta y horror (solo las fichas que cambian) | ~1.200 |
| `sort_hits` (explore + search) y juegos nuevos | ~2.500 |
| `low_since`, `state` | ~500 |
| **Total** | **~45.000–48.000** (medido en local: ~2.770 por pasada normal; el objetivo de 45.000 queda justo) |

Sin el índice `samples_ts` (D1 cuenta una fila más por índice): con él serían ~80.000.

## El muestreo (Workflow `Sampler`, lanzado por el cron cada 3 h)

Cada `step.do` tiene que caber en **10 ms de CPU y 50 peticiones externas**. La documentación da la CPU
"por paso" pero las peticiones "50/request" (por invocación) sin aclarar si cada paso es una invocación, y en
local no se aplican los límites. Por eso cada paso pide como mucho 45 (clase `Budget` de `sources.js`) y
**antes de cada paso con red hay un `step.sleep("…", "1 second")`** (no cuenta como paso). Tamaños y CPU
medida: ver `README.md` ("CPU por paso").

Nombres reales de los pasos: `init` → `explore-0..P` (una página de get-sorts por paso) → `explore-more`
(get-sort-content) → `search-0..2` → `search-cursor` → [`rolimons` → `resolve-0..4`] → `sample-list` →
`sample-0..M` (400 juegos; en la 1ª pasada del día 50 juegos con meta, horror y votos) → [`close`] → `maint` →
`export-plan` → `export-0..E` → `export-join` → `tg-scan-i-j` → `tg-reduce` → `telegram` → `finish`.

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
   50 juegos; `tg-reduce` junta las filas, elige los candidatos con `pickCandidates`, pide a D1 solo esos
   juegos y escribe R2 **`data/telegram.json`**: mismo formato que el export, solo los candidatos (~60–90),
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

(Admin: `POST /api/admin/run` `{daily?, skip?, only?, telegram_force?, now?}`, `GET /api/admin/status?id=&counts=1`,
`POST /api/admin/import` `{table, columns, rows}`, `POST /api/admin/rebuild` (recalcula `hist_agg` y lanza un
export), `POST /api/admin/export` (lanza un Workflow solo de export), `POST /api/admin/backfill` `{ids?}`
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

(Backend: este prefiltro se hace en los pasos `tg-scan-*`/`tg-reduce` con `telegramScanText` y
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
2. **`state.hist_agg`**: pico, fecha del pico, días, primer día y últimos favoritos/votos de toda la historia,
   mantenidos al cerrar cada día (1 fila escrita al día). Sin esto, cada export leería `daily` entera.
3. **Lecturas D1** (medidas en local con `meta.rows_read`, que cuenta también las tablas temporales de las
   CTE): ~300.000 por export en régimen (~2,4 M/día con 8 pasadas, límite 5 M).
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
  actual termina. Las fases son discover → search → rolimons → resolve → sample → finalize.
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
  la cruza con `places` y guarda `{universe_id: jugadores}` en R2
  `radar/<día>/<ts>.json` (un fichero por muestreo; 7 días).
- `samples` y votos solo de los seguidos. El meta diario (Games API) sigue siendo de
  todo el radar: ficha, horror, y jugadores y visitas de los no seguidos, que van al
  cierre por `tmp/run/<id>/votes-<i>.json` = `{v: votos de seguidos, r: {id: [playing, visits]}}`.
- Cierre del día: `closeDayStmt` (desde samples) y después `radarCloseStmt`
  (desde las lecturas del radar; mismas mediana y media). Si un juego tiene las
  dos, se queda la que tiene más lecturas.
- `select`: `select-plan` → `select-<i>` (250 juegos por paso: últimas 14 filas
  diarias + `radarScore` de `metrics.js`, ≈ 5 ms en frío) → `select-apply`
  (`chooseSelection` de `sampler.js`). Top 10 por jugadores en general y en horror,
  150 mejores candidatos general y 50 de horror (completados por jugadores si no
  hay bastantes), y los ya seguidos dentro del 150 % de su lista.
- Export: solo `sel = 1` (si aún no hay selección, todo el radar). La cabecera
  añade `radar_games` y `selected_games`. `buildDashboard` añade `categories.*.top`
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
  tiene que contarlas. Solo cubre los juegos que salen en el radar (Rolimons + `places`).
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
  (`meta.size_after`, filas y bytes por tabla, y `mayores` frente a los 500 MB de D1);
  `nombres(rutas)` → nombre de hoy de sus carpetas (`site/`, `data/`, `radar/<día>/`…).
- El Almacén cuenta las bases D1 aparte de los Durable Objects (`d1` en su medida).
- `cloudflare/tools/uploader.js`: el Worker auxiliar `roblox-uploader` (con
  `ADMIN_TOKEN`) que sube la web y los bundles de despliegue a esa carpeta.
