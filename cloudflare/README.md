# Roblox Tracker en Cloudflare (plan gratis)

Un solo Worker (`roblox-tracker`) con D1, R2 y un Workflow (`roblox-sampler`) que muestrea cada hora.
La interfaz entre piezas está en [`CONTRACT.md`](CONTRACT.md).

| Fichero | Qué hace |
|---|---|
| `wrangler.toml` | Bindings `DB` (D1), `BUCKET` (R2), `SAMPLER` (Workflow), cron `0 * * * *` (cada hora en punto, UTC), dominio |
| `schema.sql` | Esquema D1 (idempotente) |
| `src/index.js` | `fetch` (web, API, admin) y `scheduled` (crea la instancia del Workflow) |
| `src/sampler.js` | `class Sampler extends WorkflowEntrypoint`: el muestreo por pasos, el radar y la elección de los juegos seguidos |
| `src/sources.js` | Clientes de Rolimons, Explore, Search, Games, Votes, place→universe, iconos |
| `src/db.js` | SQL: inserciones (`json_each`), cierre diario, `hist_agg`, export por trozos, historial, import |
| `scripts/migrate_from_git.py` | Sube los datos actuales del repo (git o carpeta) a D1 por `/api/admin/import` |
| `test/` | `dev.sh`/`sync.sh` (servidor local), `cpu_steps.mjs` (CPU por paso), `bench_rolimons.mjs`, `cf_loader.mjs` |

## Desarrollo y pruebas en local

```sh
cd cloudflare
npm install                       # solo wrangler (devDependency)
test/dev.sh --port 8787           # wrangler dev --local sobre una copia en test/.build (estado en test/.state)
                                  # ADMIN_TOKEN local = "test-admin"; si falta algún módulo de otro equipo,
                                  # se puede poner un stub en test/stubs/ (se copia solo si no existe en src/)
test/sync.sh                      # tras editar src/: copia a test/.build (wrangler recarga solo)

# Esquema en el D1 local
(cd test/.build && ../../node_modules/.bin/wrangler d1 execute roblox-tracker --local --persist-to ../.state --file=schema.sql)

# Migración desde la rama main (git show origin/main:data/…)
python3 scripts/migrate_from_git.py --url http://127.0.0.1:8787 --token test-admin            # --dry-run para contar

# Lanzar un muestreo completo contra las APIs reales y ver el estado
curl -X POST -H "Authorization: Bearer test-admin" http://127.0.0.1:8787/api/admin/run -d '{}'
curl -H "Authorization: Bearer test-admin" "http://127.0.0.1:8787/api/admin/status?id=<id>&counts=1"
# El cron: curl "http://127.0.0.1:8787/cdn-cgi/handler/scheduled?cron=0+*/3+*+*+*"

# Reglas de host: workers.dev solo responde /api/admin/*
curl -H "Host: roblox-tracker.x.workers.dev" http://127.0.0.1:8787/api/export     # → 404

# CPU de cada paso (Node, procesos en frío, --single-threaded) con respuestas reales guardadas
node test/cpu_steps.mjs <carpeta_fixtures> 7
node --single-threaded test/bench_rolimons.mjs [rolimons.json]
```

Fixtures de `cpu_steps.mjs`: `games_pages.json` y `votes_pages.json` (20 respuestas de 50 juegos),
`explore_pages.json`, `search_pages.json`, `rolimons.json`, `ids.json`, `part-<i>.json` (partes del export,
`wrangler r2 object get roblox-tracker/tmp/export/part-<i>.json --local …`) y `telegram.json`.

## Despliegue (lo hace el coordinador)

```sh
cd cloudflare
npx wrangler d1 create roblox-tracker          # copiar database_id a wrangler.toml
npx wrangler r2 bucket create roblox-tracker   # (ya existe)
npx wrangler d1 execute roblox-tracker --remote --file=schema.sql
npx wrangler secret put ADMIN_TOKEN            # y TELEGRAM_TOKEN, TELEGRAM_CHAT_ID
npx wrangler deploy
npx wrangler r2 object put roblox-tracker/site/dashboard.html --file public/dashboard.html --remote
npx wrangler r2 object put roblox-tracker/site/favicon.svg --file ../favicon.svg --remote
ADMIN_TOKEN=… python3 scripts/migrate_from_git.py --url https://roblox-tracker.<cuenta>.workers.dev
```

Si se despliega por la API sin wrangler: `npx wrangler deploy --dry-run --outdir dist` deja en
`dist/index.js` un único módulo ES con todo (incluidos los textos de `/config.js`, `/metrics.js` y
`/horror.js`); se sube ese fichero como `main_module` con los bindings y el workflow de `wrangler.toml`.

## Decisiones

**Módulos para el navegador** (`/config.js`, `/metrics.js`, `/horror.js`): se importan como texto con
`import src from "./metrics.js" with { type: "text" }`. esbuild (el empaquetador de wrangler) lo resuelve y
mete el código como string en el mismo bundle, así que el Worker y la web usan siempre la misma versión y
no hay ficheros aparte que subir. (Con `.sql` no vale: wrangler trata los `.sql` como módulo aparte, por eso
el esquema no se incrusta y se aplica con `wrangler d1 execute`.)

**50 peticiones externas por invocación.** Comprobado en producción: los pasos de una instancia del
Workflow comparten invocación, y ni `step.sleep` ni los reintentos reinician la cuenta. Por eso el
muestreo va en **ejecuciones encadenadas**: cada instancia gasta como mucho 46 peticiones (`Budget` de la
invocación y un `SubBudget` por paso) y, cuando no le queda para la siguiente fase, crea la instancia
`<base>-s<N>` con la fase y el cursor por los que seguir. Las listas intermedias van en R2 (`tmp/run/`) y
se borran al terminar. Los pasos son idempotentes (`INSERT OR IGNORE`, UPSERT con
`WHERE … IS NOT excluded…`), así que un reintento no duplica nada.

**Trabajo en SQLite, no en el Worker.** Las filas viajan como un solo parámetro JSON (`json_each(?)`),
los agregados (mediana con `ROW_NUMBER()`) y los JSON (`json_object`, `json_group_array`) los hace D1.

**Export por trozos.** En régimen el export pesa ~2,3 MB; solo decodificar esa respuesta de D1 costaría
~13 ms. Se genera por rangos de universe_id (~250 juegos exportados cada uno) que se guardan en R2 y se unen
con un `FixedLengthStream` sin pasar por JS. Telegram usa `data/telegram.json` (solo los candidatos, con
cabeceras exactas calculadas con `telegramScanText` + `pickCandidates` de `telegram.js` en pasos de 50
juegos).

## CPU por paso (medida)

Node 22, `--single-threaded`, un proceso nuevo por medida (como un isolate frío; con el isolate caliente es
bastante menos), mediana de 7, con respuestas reales. Solo cuenta lo que en Workers es CPU: decodificar y
parsear respuestas, calcular y serializar (esperar a la red, D1 o R2 no cuenta).

| Paso | Qué hace en CPU | ms |
|---|---|---|
| `explore-i` | 1 página de get-sorts (~150 KB) | 1,8 |
| `explore-more` | 4 páginas de get-sort-content | 1,6 |
| `search-k` | 3 páginas de omni-search | 0,8 |
| `rolimons` | gamelist de 1 MB: decodificar + filtro por texto (regex) | 6,8 |
| `resolve-i` | 40 respuestas pequeñas | < 0,5 |
| `sample-i` (400 juegos) | 8 respuestas de la Games API (~560 KB) | 4,9 |
| `sample-i` con meta (50 juegos) | 1 respuesta + votos + `classifyHorror` de 50 | 3,9 |
| `export-i` | recibir ~330 KB de D1 (hoy) / ~680 KB (parte grande en régimen) | 3,0 / 6,2 |
| `export-join` | cabecera; las partes van en stream | 0,1 |
| `tg-scan-i-j` (50 juegos) | decodificar la parte + `telegramScanText` (régimen; con 100 juegos ~9–13) | ~4 |
| `tg-reduce` | `pickCandidates` (~1.000 filas) + ~80 juegos de D1 | 2,4 |
| `telegram` | `runTelegram` sin mensajes / con alertas o diario | 6,2 / 11–14 |

Filtro de Rolimons (1,05 MB, 7.602 juegos → 2.127): `JSON.parse` + filtro 12–17 ms en frío (5,5 ms en
caliente); el escaneo por texto 3,1–3,7 ms en frío (1,3 ms en caliente).

`classifyHorror` en frío: 1 juego 3,1 ms, 50 → 4,2 ms, 100 → 8,9 ms, 250 → 9,8 ms, 500 → 14 ms. Más el
parseo de la Games API (~1,1 ms por 100 juegos), por encima de ~60 juegos por paso se pasa de 10 ms: por eso
`META_CHUNK = 50` (≈ 55 pasos en la primera pasada del día; el límite es 1.024).

El paso `telegram` se pasa de 10 ms cuando envía mensajes (alertas, diario, semanal): pasa como mucho unas
pocas veces al día y Cloudflare tolera excesos ocasionales. Sin mensajes, ~6 ms.

## D1: escrituras y lecturas

Medido en local (`meta.rows_written`/`rows_read`, que en D1 cuenta también los índices y las tablas
temporales de las CTE):

- pasada normal: **~2.770 filas** (2.311 muestras + ~420 de search + explore/low_since);
- primera pasada del día (tras la migración): **~8.200** (muestras, ~800 fichas que cambian, ~2.000 de
  favoritos/votos, explore con juegos y puestos nuevos, places); en régimen el cierre escribe ~2.300;
- en régimen se suma el borrado de las muestras de hace 8 días (~2.300 por pasada).

Total estimado en régimen: **~45.000–48.000 filas/día** (límite 100.000; el objetivo de 45.000 queda justo).
La migración escribe ~41.700 una sola vez; volver a ejecutarla escribe 0.

Lecturas: ~215.000–245.000 por export hoy (6 trozos + telegram), ~300.000 en régimen → ~2,4 M/día de 5 M.

## Paridad con Python (comprobada)

- Cierre de `daily` del 2 oct desde las muestras importadas: 2.116/2.116 filas idénticas a las de
  tracker.py (n, mediana, media, min, max, visitas; la mediana y la media redondean los .5 al par, como
  `round()` de Python).
- Export de D1 recién migrado vs `test/make_export.py` (24 filas, corte en la última muestra): mismos 1.107
  juegos y todos los campos iguales salvo favoritos/votos de 31 juegos nuevos de hoy (Python los guardaba
  en la fila de hoy; aquí llegan con el meta diario siguiente). `buildDashboard` sobre ambos: categorías
  idénticas, 1 juego distinto de 621.
- `data/telegram.json` vs `telegramCandidates(export completo)`: mismas cabeceras y mismos candidatos, y el
  JSON de cada juego idéntico al del export.
