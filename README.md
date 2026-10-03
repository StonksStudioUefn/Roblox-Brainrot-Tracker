# Roblox Tracker

Tracker de juegos de Roblox con dos vistas: **General** (todo Roblox) y **Horror**. Vigila unos 2.500 juegos con un radar ligero y sigue de cerca los ~200 que más interesan: el top 10 por jugadores de cada vista y los que tienen más pinta de despegar. Separa los picos de evento del crecimiento real. Tiene un dashboard web con miniaturas, fichas de juego y avisos por Telegram.

**Dashboard:** https://robloxtracker.stonksstudio.com (privado: entra con el login de Cloudflare Access del equipo)

## Cómo funciona

Todo vive en **Cloudflare** (plan gratuito). GitHub solo guarda el código.

```
Cron 00:00, 03:00… UTC ──▶ Workflow roblox-sampler ──▶ D1 roblox-tracker (muestras, días, fichas)
                              │                     └─▶ R2 roblox-tracker (export.json, telegram.json, web)
                              └─▶ Telegram (alertas y resúmenes)

Worker roblox-tracker (robloxtracker.stonksstudio.com)
  ├─ web y datos desde R2/D1
  └─ /api/live, /api/thumbs, /api/game → Roblox en el momento
```

En cada muestreo el Workflow:

1. **Descubre juegos** con las APIs oficiales de Roblox: listas de Explore (*Up-and-Coming*, *Top Trending*…) y el buscador, con palabras de horror que van rotando. Completa con la lista de Rolimons.
2. **Radar:** con la lista de Rolimons (1 sola petición) apunta los jugadores de todos los juegos con **≥300 jugadores** (unos 2.500).
3. **Toma una muestra** de los **juegos seguidos** (~200): jugadores y visitas.
4. En la primera pasada del día, además:
   - actualiza la ficha de todo el radar (nombre, creador, géneros, fechas, visitas) y la clasificación de horror, que usa la descripción, pero esta no se guarda; los likes y favoritos, solo de los seguidos;
   - **cierra el día anterior**: mediana, media, mín y máx de las muestras de los seguidos y de las lecturas del radar del resto;
   - **elige los juegos seguidos** de hoy (ver abajo).
5. **Genera el export** para la web (solo los seguidos) y la lista de candidatos para Telegram. Borra las muestras de más de 8 días.
6. **Telegram**: alertas de emergentes, resumen diario (desde las 18:00 UTC) y semanal.

El plan gratuito permite 50 peticiones externas por invocación, así que el muestreo se reparte en varias ejecuciones encadenadas (1–2 en una pasada normal y unas 4–5 en la primera del día).

## Radar y juegos seguidos

Para encontrar lo que empieza a despegar hay que mirar muchos juegos, pero no hace falta guardarlo todo de todos:

- **Radar (~2.500 juegos):** de cada juego con ≥300 jugadores se guarda **un solo dato al día** (la mediana de las lecturas de Rolimons de ese día, con sus visitas). Basta para ver si está creciendo y para tener su historia si un día entra en la lista.
- **Seguidos (~200):** cada día, con el día anterior cerrado, se eligen en `cloudflare/src/config.js` → `SELECTION`:
  - los **10 con más jugadores** de cada pestaña (General y Horror);
  - los **150 mejores candidatos a emergente** de todo Roblox y los **50 mejores de horror**. La puntuación es la misma que la de emergentes, pero sin el corte de 45 puntos. Si en horror no hay 50 candidatos con menos de 30M visitas, se completa con los siguientes por jugadores.
  - Un juego ya seguido se queda mientras siga dentro del 150 % de su lista, para que no entre y salga cada día.

Solo los seguidos tienen muestras cada 3 h, likes, salen en la web y mandan avisos a Telegram. Así se escribe unas 4 veces menos en la base de datos que siguiendo todo el radar.

La web pide al Worker lo que no se guarda: **jugadores en vivo**, iconos, miniaturas y descripciones. Lo hace al abrirse, cada ~2 min y con el botón 🔄 Actualizar. Eso no se guarda en el histórico ni manda nada a Telegram.

Toda la configuración está en **`cloudflare/src/config.js`**: umbrales, categorías, reglas de horror, criterios de emergentes y Telegram. La usan el Worker y la web.

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

Si aparece en las listas oficiales de Roblox suma **+15** (*Up-and-Coming*) o **+10** (*Top Trending*), con un máximo de 100. Si sube solo por un pico de evento, la puntuación se reduce.

## Horror 👻

Antes solo se miraban palabras en el nombre y se perdían muchos juegos. Ahora cada señal suma puntos (`HORROR` en `cloudflare/src/config.js`):

- **Nombre:** palabras fuertes (doors, backrooms, killer, anomaly, fnaf…) y débiles (escape, survive, night…). Restan palabras de juegos que no dan miedo (brainrot, tsunami, tycoon, obby…). Las etiquetas entre corchetes tipo `[HAUNTED]` o `[🎃 HALLOWEEN]` se ignoran, porque suelen ser eventos temporales.
- **Descripción:** horror, scary, jumpscare, killer, hide from, survive the night, entity…
- **Género antiguo del creador:** Roblox guarda un género "Horror" que elige el propio creador. Así entran *Spider*, *Teddy*, *Keys*, *Evade*, *Piggy*…
- **Género oficial:** Survival › 1 vs All, Survival › Escape, Adventure › Story…

Un juego es de horror si suma **≥5 puntos y tiene al menos una señal fuerte**. Para corregir un caso concreto, añade su `universe_id` a `force_include` o a `force_exclude`. Cada ficha del dashboard muestra por qué se ha clasificado así.

## Datos

Se guarda solo lo básico, en la base de datos **D1 `roblox-tracker`**:

| Tabla | Qué guarda |
|---|---|
| `games` | ficha básica: nombre, creador, géneros, fechas, clasificación de horror y si se sigue (`sel`) |
| `places` | qué juego (universe) corresponde a cada place |
| `samples` | una muestra cada 3 h de los seguidos: hora, juego, jugadores, visitas (8 días) |
| `daily` | un registro por juego y día, de todo el radar: n, mediana, media, mín, máx, visitas (y favoritos y likes de los seguidos) |
| `sort_hits` | en qué listas oficiales de Roblox aparece cada juego y en qué puesto |
| `state` | estado del muestreo y qué avisos de Telegram ya se han enviado |

En el bucket **R2 `roblox-tracker`** van la web (`site/`), los ficheros generados (`data/export.json`, `data/telegram.json`) y las lecturas del radar de cada muestreo (`radar/<día>/`, 7 días). No se guardan descripciones, iconos ni miniaturas: el Worker los pide a Roblox cuando hacen falta.

El historial hasta el 03/10/2026 sigue en git, en los commits anteriores a la migración.

## Cloudflare

- **Worker `roblox-tracker`** en `robloxtracker.stonksstudio.com`, protegido por la regla de Access de `*.stonksstudio.com`. Su URL `*.workers.dev` solo responde a `/api/admin/*` con `ADMIN_TOKEN`.
- **Workflow `roblox-sampler`**, **D1 `roblox-tracker`** y **R2 `roblox-tracker`**.
- **Secrets del Worker:** `ADMIN_TOKEN`, `TELEGRAM_TOKEN` y `TELEGRAM_CHAT_ID`.
- Código, pruebas y despliegue: [`cloudflare/README.md`](cloudflare/README.md). La interfaz entre piezas está en [`cloudflare/CONTRACT.md`](cloudflare/CONTRACT.md).

Operaciones (con `Authorization: Bearer $ADMIN_TOKEN` contra la URL `*.workers.dev`):

```bash
curl -X POST $URL/api/admin/run -d '{}'                          # muestreo ahora
curl -X POST $URL/api/admin/run -d '{"telegram_force":"daily"}'  # forzar el resumen diario (o "weekly")
curl $URL/api/admin/status                                       # estado del último muestreo
```

Los scripts Python de la raíz (`tracker.py`, `analytics.py`, `export_dashboard.py`, `notifier.py`…) ya no se ejecutan. Se quedan como referencia para las pruebas de paridad de `cloudflare/test/`.

## Telegram

Los mensajes llegan al grupo del equipo. Para cambiar de bot o de chat:

1. En Telegram, habla con **@BotFather** → `/newbot` → guarda el token.
2. Añade el bot al grupo, escribe algo y copia el `chat.id` de `https://api.telegram.org/bot<TOKEN>/getUpdates`.
3. En Cloudflare: **Workers → roblox-tracker → Settings → Variables and Secrets** → cambia `TELEGRAM_TOKEN` y `TELEGRAM_CHAT_ID`.

Los mensajes están pensados para el móvil: el resumen diario es un mensaje por categoría con la miniatura del juego más destacado, y cada juego ocupa dos líneas (nombre / jugadores · crecimiento). Las alertas de emergentes llevan su miniatura, sus datos y enlaces para jugar y ver la ficha.

## Limitaciones

- Rolimons solo lista juegos con un mínimo de actividad. Los que no aparecen ahí no se ven.
- El buscador de Roblox a veces devuelve resultados vacíos si se le pide mucho. Por eso las palabras van rotando, unas pocas en cada muestreo.
- La clasificación de horror es heurística. Revisa los motivos en la ficha y corrige con `force_include` / `force_exclude`.
- Un juego que entra hoy en la lista de seguidos sale en la web desde el siguiente muestreo (necesita su primera muestra). Su historia anterior viene del radar: un dato al día.
