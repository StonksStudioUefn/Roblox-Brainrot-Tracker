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
| `src/db.js` | SQL: inserciones (`json_each`), cierre diario, tabla `hist`, export por trozos, historial, import |
| `scripts/migrate_from_git.py` | Sube los datos actuales del repo (git o carpeta) a D1 por `/api/admin/import` |
| `test/` | `dev.sh`/`sync.sh` (servidor local), `cpu_steps.mjs` (CPU por paso), `bench_rolimons.mjs`, `cf_loader.mjs`, `export.bench.mjs` (filas leídas y salida del export contra un D1 local), `filas.bench.mjs` (filas de D1 de pasadas completas, con topes), `cierre.parity.mjs` y `cierre.cpu.mjs` (el cierre del día: mismo resultado que antes y su CPU) |

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
node --import ./test/cf_loader.mjs test/cierre.cpu.mjs       # close y close-radar (datos sintéticos)
```

### Pruebas (antes de juntar)

```sh
cd cloudflare
node --import ./test/cf_loader.mjs test/filas.bench.mjs todos     # filas de D1 por pasada: falla si se pasa de los topes
node --import ./test/cf_loader.mjs test/cierre.parity.mjs         # el cierre da lo mismo que las consultas de antes
node --test test/telegram.test.mjs                                # necesitan data/ en la raíz del repo (los datos del
node test/metrics.parity.mjs --quick                              #  03/10: git archive 99d2ee9 data | tar -x) y python3
node test/horror.parity.mjs                                       # descarga de la Games API (o usa su caché)
npx wrangler deploy --dry-run --outdir /tmp/dist                  # que empaqueta
```

**`test/filas.bench.mjs`** corre el Workflow `Sampler` de verdad (todas las ejecuciones encadenadas de cada
pasada) con Roblox, Rolimons y R2 simulados y un D1 local (miniflare) del tamaño de producción: 2.953 juegos,
2.797 en el radar, 242 seguidos, y según el escenario `hoy` (~4 días de muestras, 10 filas diarias por juego),
`regimen` (9 días de muestras, 30 filas diarias) o `anio` (~1 M filas diarias y ~650.000 puestos). La semilla
se hace una vez en `test/.filas/` (`--seed` la rehace) y es la base como estaba antes de la tabla `hist`
(con `state.hist_agg`), así que la primera pasada (23:00, «calentamiento») hace la migración. Luego la
pasada de las 00:00 y las de 01:00 a 03:00 (`--dia`: las 24 y la de las 00:00 del día siguiente), y
`espacio()` del Almacén. Imprime las filas por pasada y por paso (`-v`: por consulta) y **falla** si una
pasada pasa de su tope (`TOPES`, ~20 % sobre lo medido), si una consulta lee más de un 20 % (y más de
10.000 filas) en `anio` que en `regimen` (recorre `daily` o `sort_hits` enteras), si un cierre que falla
siempre repite el meta o se intenta más de `DAILY_TRIES` veces («cascada»), si dos pasadas que se cortan
antes de las tareas del día les gastan los intentos o si `maint` no borra lo que una pasada cortada hace
más de un día dejó en `tmp/run/` («cortes»), o si la primera pasada tras desplegar sobre una base con
`state.hist_agg` deja `hist` distinta de la recalculada desde `daily` o exporta sin sus datos
(«migración», con y sin el esquema aplicado). Para comparar con otra versión:
`--src=<carpeta con su src/>`, y `--salida=<carpeta>` guarda el export y `telegram.json` de cada pasada
(`cmp -r` entre versiones). `test/export.bench.mjs` acepta `--config=test/filas.wrangler.toml
--persist=<copia de test/.filas/<escenario>/semilla>` para medir solo el export sobre esa base.

Fixtures de `cpu_steps.mjs`: `games_pages.json` y `votes_pages.json` (20 respuestas de 50 juegos),
`explore_pages.json`, `search_pages.json`, `rolimons.json`, `ids.json`, `part-<i>.json` (partes del export,
`wrangler r2 object get stonks-archivos/roblox-tracker/tmp/export/part-<i>.json --local …`) y `telegram.json`.

## Despliegue (lo hace el coordinador)

**Al desplegar la rama `claude/optimizar-d1` (05/10/2026), en este orden:**

1. `npx wrangler d1 execute roblox-tracker --remote --file=schema.sql`: solo añade la tabla `hist`
   (`CREATE TABLE IF NOT EXISTS`; lo demás ya está aplicado y no cambia; no borra datos).
2. `npx wrangler deploy`.
3. Nada más: la primera pasada copia `state.hist_agg` a `hist` y borra la clave (en su paso `init`, en un
   batch: las dos cosas o ninguna; repetirla no hace nada), y lee la marca vieja `day` mientras no exista
   `meta_day`, así que el día del despliegue no repite el meta, ni el cierre, ni select ni maint (sus marcas
   ya son de hoy) y a las 00:00 los hace todos. Si el código llegara antes que el esquema, `migrateHist`
   crea la tabla. Mejor no desplegar entre las :00 y las :05 (cuando corre la pasada).
   Para comprobarlo: `GET /api/admin/status` enseña `meta_day`, `closed_day`, `maint_day` y `daily_tries`
   (y `last_run.pendiente`, si alguna tarea del día se ha quedado sin intentos), y
   `wrangler d1 execute roblox-tracker --remote --command "SELECT COUNT(*) FROM hist"` da los juegos con
   filas diarias (~3.000) y `… "SELECT COUNT(*) FROM state WHERE key = 'hist_agg'"` da 0.
4. Si una tarea del día se queda sin intentos (2 al día) y hay que repetirla hoy:
   `POST /api/admin/run {"daily": ["close"]}` (o `["select"]`, `["maint"]`, `["meta"]`); `{"daily": true}`
   las repite todas (el meta de todo el radar lee ~150.000 filas).

Desde cero:

```sh
cd cloudflare
npx wrangler d1 create roblox-tracker          # copiar database_id a wrangler.toml
# R2: el bucket común stonks-archivos (ya existe); el tracker usa su carpeta roblox-tracker/
npx wrangler d1 execute roblox-tracker --remote --file=schema.sql
npx wrangler secret put ADMIN_TOKEN            # y TELEGRAM_TOKEN, TELEGRAM_CHAT_ID
npx wrangler deploy
npx wrangler r2 object put stonks-archivos/roblox-tracker/site/dashboard.html --file public/dashboard.html --remote
npx wrangler r2 object put stonks-archivos/roblox-tracker/site/favicon.svg --file ../favicon.svg --remote
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
se borran al terminar (lo de una pasada que se corta antes, en `maint` cuando tiene más de un día). Los pasos son idempotentes (`INSERT OR IGNORE`, UPSERT con
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
| `radar-api` (~320 juegos) | 7 respuestas de la Games API (~450 KB) + leer y reescribir el fichero del radar (~48 KB) | ~4 (por debajo de `sample-i` medido en la misma máquina) |
| `sample-i` con meta (50 juegos) | 1 respuesta + votos + `classifyHorror` de 50 | 3,9 |
| `export-i` | recibir ~330 KB de D1 (hoy) / ~680 KB (parte grande en régimen) | 3,0 / 6,2 |
| `export-join` | cabecera; las partes van en stream | 0,1 |
| `tg-scan-i-j` (50 juegos) | decodificar la parte + `telegramScanText` (régimen; con 100 juegos ~9–13) | ~4 |
| `tg-reduce` | `pickCandidates` (~1.000 filas) | < 2,4 |
| `tg-pick-i` | decodificar la parte + copiar los ~70 candidatos (`pickGames`, parte de 416 KB) | ~2 |
| `telegram` | `runTelegram` sin mensajes / con alertas o diario | 6,2 / 11–14 |

Filtro de Rolimons (1,05 MB, 7.602 juegos → 2.127): `JSON.parse` + filtro 12–17 ms en frío (5,5 ms en
caliente); el escaneo por texto 3,1–3,7 ms en frío (1,3 ms en caliente).

`classifyHorror` en frío: 1 juego 3,1 ms, 50 → 4,2 ms, 100 → 8,9 ms, 250 → 9,8 ms, 500 → 14 ms. Más el
parseo de la Games API (~1,1 ms por 100 juegos), por encima de ~60 juegos por paso se pasa de 10 ms: por eso
`META_CHUNK = 50` (≈ 55 pasos en la primera pasada del día; el límite es 1.024).

El paso `telegram` se pasa de 10 ms cuando envía mensajes (alertas, diario, semanal): pasa como mucho unas
pocas veces al día y Cloudflare tolera excesos ocasionales. Sin mensajes, ~6 ms.

Cierre del día (`test/cierre.cpu.mjs`, datos sintéticos del tamaño de producción: 2.800 juegos × 8
lecturas, 56 ficheros de votos; medido el 05/10/2026 en otra máquina, compartida y ~2 veces más lenta que la
de la tabla, mediana de 11): el paso `close` de antes, que juntaba todas las lecturas con `JSON.parse`,
costaba **~32–55 ms**. Ahora `close` (votos y meta) ~4–8 ms y `close-radar-<día>-<k>` (1 de 10 partes: una
expresión regular saca del texto de los 8 ficheros los ids de su parte, y `radarDailyRows`) ~4–9 ms (mediana
6,7) la primera de la ejecución (decodifica los 8 ficheros de R2 y comprueba su forma) y ~3–6 ms (mediana
3,6) las demás, que reciben los ficheros ya leídos; en la máquina de la tabla, la mitad. Con 5 partes y sin
guardar los ficheros eran ~7–12 ms cada una.

## D1: escrituras y lecturas

Medido en local (`meta.rows_written`/`rows_read`, que en D1 cuenta también los índices y las tablas
temporales de las CTE):

- pasada normal: **~2.770 filas** (2.311 muestras + ~420 de search + explore/low_since);
- primera pasada del día (tras la migración): **~8.200** (muestras, ~800 fichas que cambian, ~2.000 de
  favoritos/votos, explore con juegos y puestos nuevos, places); en régimen el cierre escribe ~2.300;
- en régimen se suma el borrado de las muestras de hace 8 días (~2.300 por pasada).

Total estimado en régimen: **~45.000–48.000 filas/día** (límite 100.000; el objetivo de 45.000 queda justo).
La migración escribe ~41.700 una sola vez; volver a ejecutarla escribe 0.

Lecturas del export (`test/export.bench.mjs`, datos de producción del 04/10 16:00, 221 seguidos, 6.089
muestras de 48 h): **~13.700 filas por pasada** y ~5.000 más en la primera del día, cuando se rehace
`state.export_d`; antes eran ~144.000 (103.000 del trozo, 37.000 de Telegram y 3.400 del plan). Casi todo
es recorrer una vez las muestras de 48 h (~10.600 en régimen) y ordenar las del día en curso para las
medianas. En producción, la misma consulta sin `export_d` leyó 18.891 filas (18.449 en local). Escribe 2
filas al día (`export_d`).
Lo demás (espacio para el Almacén, poda, radar, lista de seguidos): ver "Lecturas fuera del export" en
`CONTRACT.md`. Para medir una consulta con datos reales, la base exportada (`wrangler d1 export`) se carga en
el D1 local y se lee `meta.rows_read`.

### Filas leídas por pasada (05/10/2026)

`test/filas.bench.mjs --dia` (24 pasadas reales + `espacio()` una vez), antes (main) → ahora:

| Escenario | Pasada de las 00:00 | Pasada normal (01:00 → 23:00) | Día | Escritas al día |
|---|---|---|---|---|
| `hoy` | 554.940 → 181.115 | 15.050 → 15.250 (21.584 a las 23:00) | 1.071.946 → 691.165 | 34.345 → 37.148 |
| `regimen` | 617.225 → 211.535 | 15.050 → 15.250 (21.584) | 1.151.897 → 721.585 | 40.395 → 43.198 |
| `anio` | 622.818 → 217.128 | 15.050 → 15.250 (21.584) | 1.157.490 → 727.178 | 43.192 → 45.995 |

El export y `telegram.json` de las 25 pasadas de cada escenario son idénticos byte a byte a los de main
(`--salida` y `diff -r`).

La pasada de las 00:00 en `regimen`, por pasos (antes → ahora): cierre 305.593 → 33.115 (`close` 18.973 +
`close-radar` 5.594 + `close-hist` 8.548), select 85.711 → 46.541, maint 82.623 → 36.537 (sin la poda de
huérfanas), relleno 44.727 → 2.176, `select-plan` 8.560 → 2.953. `espacio()` 89.245 → 60.024 (`samples`
estimada). Un cierre que falla: antes ~266.000 filas cada hora (meta, cierre, select y maint otra vez);
ahora se reintenta una vez (~16.000) y las pasadas siguientes son normales. Las escrituras suben ~2.800 al
día (las filas de `hist`). Las pasadas normales son casi todo el export (~10.700–17.000: las muestras de
48 h de los seguidos), explore (~2.900) y, cada 3 h, el radar; no cambian.

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
