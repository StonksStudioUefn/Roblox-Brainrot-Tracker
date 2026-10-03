# Roblox Tracker

Tracker de juegos de Roblox con dos vistas: **General** (todo Roblox) y **Horror**. Detecta qué está creciendo, qué juegos poco conocidos empiezan a despegar y separa los picos de evento del crecimiento real. Tiene un dashboard web con miniaturas, fichas de juego y avisos por Telegram.

**Dashboard:** https://robloxtracker.stonksstudio.com (privado: entra con el login de Cloudflare Access del equipo)

## Cómo funciona

```
GitHub Actions (cada 3 h)            Cloudflare
  remote.py pull  ◀──────────────▶  Worker roblox-tracker ──▶ R2 "roblox-tracker"
  tracker.py                          ├─ web y datos (robloxtracker.stonksstudio.com)
  export_dashboard.py                 └─ /api/live, /api/thumbs, /api/game → Roblox al momento
  notifier.py → Telegram
  remote.py push
```

Cada **3 horas** GitHub Actions:

1. **`remote.py pull`**: descarga los datos del bucket R2 de Cloudflare a `data/`.
2. **`tracker.py`**: descarga de Rolimons la lista de todos los juegos y se queda con los que tienen **≥300 jugadores** (unos 2.000). Completa con la API oficial de Roblox: nombre, creador, géneros, fechas, visitas, favoritos y likes. Con la descripción calcula la clasificación de horror, pero no la guarda. Añade una muestra a `data/raw/HOY.csv` y recalcula el día en `data/daily/MES.csv`.
3. **`export_dashboard.py`**: calcula métricas, eventos, emergentes y las listas de cada categoría, y genera `data/dashboard.json` y `data/history.json`.
4. **`notifier.py`**: Telegram (alertas de emergentes, resumen diario y semanal).
5. **`remote.py push`**: sube a R2 solo lo que ha cambiado, junto con la web (`dashboard.html`).

El **Worker** (`worker/worker.js`) sirve la web y los datos desde R2. También pide a Roblox en el momento lo que no se guarda: **jugadores en vivo**, iconos, miniaturas y descripciones. La web los pide al abrirse, cada ~2 min y con el botón 🔄 Actualizar. Eso no se guarda en el histórico ni manda nada a Telegram.

Toda la configuración está en **`config.py`**: umbrales, categorías, reglas de horror y criterios de emergentes.

## Métricas (y por qué no las ensucian los eventos)

| Métrica | Cómo se calcula |
|---|---|
| **Jugadores** | Mediana de las muestras de las últimas 24 h. "Ahora" es la última muestra. |
| **Valor del día** | Mediana de las ~8 muestras del día. Un pico de una hora no mueve el día. |
| **Días de evento** | Días muy por encima de su entorno (filtro de Hampel) **que luego vuelven a bajar**, descontando el efecto fin de semana (se comparan con el mismo día de la semana anterior). No cuentan para las medias. Si el salto se mantiene es crecimiento real y no se marca. |
| **24h** | Mediana de las últimas 24 h frente a la de las 24 h anteriores. |
| **7d** | Media de los 3 últimos días frente a la de hace una semana, sin días de evento. |
| **Tendencia/día** | Pendiente de Theil–Sen sobre los últimos 8 días limpios. Es robusta: un valor raro no la arrastra. |
| **🎉 Pico ahora** | La última muestra supera 1,8× lo normal: probablemente hay un evento o un update. |
| **Visitas/día** | Visitas ganadas en las últimas ~24 h. |

## Emergentes 🌱

Un juego entra en la lista si:
- tiene **menos de 30M visitas** (no es conocido todavía),
- tiene **≥300 jugadores**,
- está **creciendo** (y no bajando),
- y su puntuación (0–100) llega a 45.

La puntuación suma:
- **30 pts:** visitas ganadas al día respecto al total. Un juego nuevo que peta gana un % enorme de sus visitas cada día.
- **25 pts:** crecimiento de jugadores.
- **20 pts:** juventud del juego (creado hace menos de 120 días).
- **15 pts:** tamaño actual.
- **10 pts:** % de likes.

Si sube solo por un pico de evento, la puntuación se reduce.

## Horror 👻

Antes solo se miraban palabras en el nombre y se perdían muchos juegos. Ahora cada señal suma puntos (`HORROR` en `config.py`):

- **Nombre:** palabras fuertes (doors, backrooms, killer, anomaly, fnaf…) y débiles (escape, survive, night…). Restan palabras de juegos que no dan miedo (brainrot, tsunami, tycoon, obby…). Las etiquetas entre corchetes tipo `[HAUNTED]` o `[🎃 HALLOWEEN]` se ignoran, porque suelen ser eventos temporales.
- **Descripción:** horror, scary, jumpscare, killer, hide from, survive the night, entity…
- **Género antiguo del creador:** Roblox guarda un género "Horror" que elige el propio creador. Así entran *Spider*, *Teddy*, *Keys*, *Evade*, *Piggy*…
- **Género oficial:** Survival › 1 vs All, Survival › Escape, Adventure › Story…

Un juego es de horror si suma **≥5 puntos y tiene al menos una señal fuerte**. Para corregir un caso concreto, añade su `universe_id` a `force_include` o a `force_exclude`. Cada ficha del dashboard muestra por qué se ha clasificado así.

## Datos

Todo vive en el bucket **R2 `roblox-tracker`** de Cloudflare, no en git. Se guarda solo lo básico:

```
data/raw/AAAA-MM-DD.csv   muestras de cada 3 h: hora, juego, jugadores, visitas (35 días)
data/daily/AAAA-MM.csv    un registro por juego y día: n, mediana, media, mín, máx, visitas, favoritos, likes
data/games.json           ficha básica: nombre, creador, géneros, fechas y clasificación de horror
data/dashboard.json       resumen para la web
data/history.json         series para los gráficos
data/state.json           qué avisos de Telegram ya se han enviado
site/dashboard.html       la web (se sube en cada ejecución desde el repo)
```

No se guardan descripciones, iconos ni miniaturas: el Worker los pide a Roblox cuando hacen falta. Se pueden ver y descargar en el panel de Cloudflare → R2 → `roblox-tracker`. Desde la web también, en `https://robloxtracker.stonksstudio.com/data/<fichero>`.

El historial hasta el 03/10/2026 sigue en git (en commits antiguos).

## Uso local

```bash
pip install -r requirements.txt
export TRACKER_TOKEN=...       # el mismo secret que en GitHub
python remote.py pull          # baja los datos de R2
python tracker.py              # ~3 min
python export_dashboard.py
python notifier.py --dry-run   # ver los mensajes de Telegram sin enviarlos
python remote.py push          # solo si quieres guardar lo que has hecho
```

## Cloudflare

- **Worker `roblox-tracker`**, en `robloxtracker.stonksstudio.com`, protegido por la regla de Access de `*.stonksstudio.com`. Su URL `*.workers.dev` solo atiende el almacenamiento, con token, y la usa GitHub Actions.
- **Bucket R2 `roblox-tracker`** con los datos.
- **Secrets:** `INGEST_TOKEN` en el Worker y el mismo valor como `TRACKER_TOKEN` en GitHub (Settings → Secrets and variables → Actions).
- Para cambiar el Worker: `cd worker && npx wrangler deploy`. Los cambios en `dashboard.html` no necesitan desplegar nada: se publican en la siguiente ejecución.

## Telegram

1. En Telegram, habla con **@BotFather** → `/newbot` → guarda el token.
2. Escribe `/start` a tu bot y copia el `chat.id` de `https://api.telegram.org/bot<TOKEN>/getUpdates`.
3. En el repo: **Settings → Secrets and variables → Actions** → crea `TELEGRAM_TOKEN` y `TELEGRAM_CHAT_ID`.

Los mensajes están pensados para el móvil: el resumen diario es un mensaje por categoría con la miniatura del juego más destacado, y cada juego ocupa dos líneas (nombre / jugadores · crecimiento). Las alertas de emergentes llevan su miniatura, sus datos y enlaces para jugar y ver la ficha.

Para probarlo: **Actions → Roblox Tracker → Run workflow** y elige `diario` o `semanal` en "Forzar un resumen de Telegram". En local: `--daily` y `--weekly` fuerzan esos resúmenes y `--dry-run` imprime los mensajes sin enviarlos.

## Limitaciones

- Rolimons solo lista juegos con un mínimo de actividad. Los que no aparecen ahí no se ven.
- GitHub puede retrasar o saltarse ejecuciones programadas. Por eso el cron va en el minuto 17 y cada 3 h: si se pierde una, el día sigue teniendo varias muestras.
- La clasificación de horror es heurística. Revisa los motivos en la ficha y corrige con `force_include` / `force_exclude`.
