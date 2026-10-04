# Roblox Tracker

Tracker de juegos de Roblox con dos vistas: **General** (todo Roblox) y **Horror**. Vigila unos 2.500 juegos con un radar ligero y sigue de cerca los ~200 que más interesan: el top 10 por jugadores de cada vista y los que tienen más pinta de despegar. Separa los picos de evento del crecimiento real. Tiene un dashboard web con miniaturas, fichas de juego y avisos por Telegram.

**Dashboard:** https://robloxtracker.stonksstudio.com (privado: entra con el login de Cloudflare Access del equipo)

## Cómo funciona

Todo vive en **Cloudflare** (plan gratuito). GitHub solo guarda el código.

```
Cron cada hora (min 0) ─▶ Workflow roblox-sampler ──▶ D1 roblox-tracker (muestras, días, fichas)
                              │                     └─▶ R2 stonks-archivos/roblox-tracker/ (web, export, radar)
                              └─▶ Telegram (alertas y resúmenes)

Worker roblox-tracker (robloxtracker.stonksstudio.com)
  ├─ web y datos desde R2/D1
  └─ /api/live, /api/thumbs, /api/game → Roblox en el momento
```

En cada muestreo el Workflow:

1. **Descubre juegos** con las APIs oficiales de Roblox: listas de Explore (*Up-and-Coming*, *Top Trending*…) y el buscador, con palabras de horror que van rotando. Completa con la lista de Rolimons.
2. **Radar** (cada 3 h): con la lista de Rolimons (1 sola petición) apunta los jugadores de todos los juegos con **≥300 jugadores** (unos 2.500).
3. **Toma una muestra** de los **juegos seguidos** (~200) **cada hora**: jugadores y visitas.
4. En la primera pasada del día, además:
   - actualiza la ficha de todo el radar (nombre, creador, géneros, fechas, visitas) y la clasificación de horror, que usa la descripción, pero esta no se guarda; los likes y favoritos, solo de los seguidos;
   - **cierra el día anterior**: mediana, media, mín y máx de las muestras de los seguidos y de las lecturas del radar del resto;
   - **elige los juegos seguidos** de hoy (ver abajo).
5. **Genera el export** para la web (solo los seguidos) y la lista de candidatos para Telegram. Borra las muestras de más de 8 días y, una vez al día, los días y puestos en listas de **más de un año**.
6. **Telegram**: alertas de emergentes, resumen diario (desde las 18:00 UTC) y semanal.

El plan gratuito permite 50 peticiones externas por invocación, así que el muestreo se reparte en varias ejecuciones encadenadas (1–2 en una pasada normal y unas 4–5 en la primera del día).

## Radar y juegos seguidos

Para encontrar lo que empieza a despegar hay que mirar muchos juegos, pero no hace falta guardarlo todo de todos:

- **Radar (~2.500 juegos):** de cada juego con ≥300 jugadores se guarda **una fila al día** (mediana, media, mínimo y máximo de las 8 lecturas de Rolimons del día, con sus visitas). Basta para ver si está creciendo y para tener su historia si un día entra en la lista.
- **Seguidos (~200):** cada día, con el día anterior cerrado, se eligen en `cloudflare/src/config.js` → `SELECTION`:
  - los **10 con más jugadores** de cada pestaña (General y Horror);
  - los **150 mejores candidatos a emergente** de todo Roblox y los **50 mejores de horror**. La puntuación es la misma que la de emergentes, pero sin el corte de 45 puntos. Si en horror no hay 50 candidatos con menos de 30M visitas, se completa con los siguientes por jugadores.
  - Un juego ya seguido se queda mientras siga dentro del 150 % de su lista, para que no entre y salga cada día.

Solo los seguidos tienen muestras cada hora, likes, salen en la web y mandan avisos a Telegram. Así se escribe unas 4 veces menos en la base de datos que siguiendo todo el radar.

La web pide al Worker lo que no se guarda: **jugadores en vivo**, iconos, miniaturas y descripciones. Lo hace al abrirse, cada ~2 min y con el botón 🔄 Actualizar. Eso no se guarda en el histórico ni manda nada a Telegram.

Toda la configuración está en **`cloudflare/src/config.js`**: umbrales, categorías, reglas de horror, criterios de emergentes y Telegram. La usan el Worker y la web.

## Métricas (y por qué no las ensucian los eventos)

| Métrica | Cómo se calcula |
|---|---|
| **Jugadores** | Mediana de las muestras de las últimas 24 h. "Ahora" es la última muestra. |
| **Valor del día** | Mediana de las ~24 muestras del día. Un pico de una hora no mueve el día. |
| **Días de evento** | Días muy por encima de su entorno (filtro de Hampel) **que luego vuelven a bajar**, descontando el efecto fin de semana (se comparan con el mismo día de la semana anterior). No cuentan para las medias. Si el salto se mantiene es crecimiento real y no se marca. |
| **24h** | Mediana de las últimas 24 h frente a la de las 24 h anteriores. |
| **7d** | Media de los 3 últimos días cerrados frente a la de los días 7 a 10 atrás, por fecha y sin días de evento. |
| **Tendencia/día** | Pendiente de Theil–Sen sobre los últimos 8 días cerrados y limpios, con la fecha real de cada día. Es robusta: un valor raro no la arrastra. |

Todas las ventanas van **por fecha**: si un juego tiene huecos, no se compara con días de hace semanas. Y solo cuentan **días cerrados**: el de hoy está a medias y solo entra en «ahora» y en las 24 h.
| **🎉 Pico ahora** | La última muestra supera 1,8× el máximo típico de los últimos 7 días limpios y 1,5× el máximo del mismo día de la semana de hace 1–3 semanas: probablemente hay un evento o un update. Se compara con el máximo diario porque, con una muestra cada hora, la mediana del día queda por debajo del pico de la tarde. |
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

## Ficha de un juego

Al pulsar un juego se abre su ficha en una tarjeta en el centro de la pantalla (con scroll si hace falta): cabecera con creador, título y botones (jugar, copiar enlace), miniatura con la descripción, fechas y cifras (visitas, visitas/día, favoritos y likes, con su puesto entre los seguidos), y la sección de jugadores con las cifras de ahora, el pico de 24 h y el pico registrado.

La gráfica de la ficha tiene cuatro vistas:

- **Día:** las muestras de cada hora de las últimas 24 h. Se actualiza cada hora.
- **Semana, Mes y Año:** un punto por día con su **media** y la franja entre el **mínimo** y el **máximo**. Los días de evento se marcan en amarillo.

Los datos de cada día se guardan un año. Lo que tiene más de un año se borra solo.

## Datos

Se guarda solo lo básico, en la base de datos **D1 `roblox-tracker`**:

| Tabla | Qué guarda |
|---|---|
| `games` | ficha básica: nombre, creador, géneros, fechas, clasificación de horror y si se sigue (`sel`) |
| `places` | qué juego (universe) corresponde a cada place |
| `samples` | una muestra cada hora de los seguidos: hora, juego, jugadores, visitas (8 días) |
| `daily` | un registro por juego y día, de todo el radar: n, mediana, media, mín, máx, visitas (y favoritos y likes de los seguidos). Se borra al pasar un año |
| `sort_hits` | en qué listas oficiales de Roblox aparece cada juego y en qué puesto (1 año) |
| `state` | estado del muestreo y qué avisos de Telegram ya se han enviado |

En el bucket común de STONKS, **R2 `stonks-archivos`**, dentro de la carpeta **`roblox-tracker/`**, van la web (`site/`), los ficheros generados (`data/export.json`, `data/telegram.json`) y las lecturas del radar de cada muestreo (`radar/<día>/`, 7 días). Así salen en el **Almacén** (almacen.stonksstudio.com) como una app más, junto con lo que ocupa la base D1, que el tracker le da con `espacio()`. No se guardan descripciones, iconos ni miniaturas: el Worker los pide a Roblox cuando hacen falta.

El historial hasta el 03/10/2026 sigue en git, en los commits anteriores a la migración.

## Cloudflare

- **Worker `roblox-tracker`** en `robloxtracker.stonksstudio.com`, protegido por la regla de Access de `*.stonksstudio.com`. Su URL `*.workers.dev` solo responde a `/api/admin/*` con `ADMIN_TOKEN`.
- **Workflow `roblox-sampler`**, **D1 `roblox-tracker`** y la carpeta `roblox-tracker/` del **R2 `stonks-archivos`** (el bucket común de STONKS).
- **Almacén de STONKS:** el Worker exporta el entrypoint `Operaciones` (`cloudflare/src/stonks.js`) con `espacio()` y `nombres()`; el Almacén lo llama por service binding (repo `stonks-ecosistema/almacen`). `GET /api/admin/espacio` da la misma medida.
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
