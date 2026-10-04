# Revisión de subidas y bajadas (Roblox Brainrot Tracker)

Datos: `data/daily` del 15/05 al 01/10/2026 (~1 muestra al día, entre las 12:44 y las 16:11 UTC). El backtest va del 01/06 al 24/09: 20.479 juego-días y 500 juegos. Para el estado actual se usó `metrics.js` sin tocar: copiado al scratchpad, con un export simulado de 24 filas y sin muestras. Los scripts están en esta carpeta.

## 1. Qué calcula hoy cada métrica

- **growth_24h** (`metrics.js` 256-270): la mediana de las últimas 24 h contra las 24 h anteriores. Si no hay muestras de ayer, compara con el último día limpio. En la práctica compara **un día de la semana con el día anterior**.
- **growth_7d** (284-294): la media de las filas k=1..3 contra la de las filas k=7..10 (4 filas, sin eventos).
- **trend** (287, 228-239): Theil–Sen sobre log de las ≤8 últimas filas limpias, en %/día.
- **status** (371-381): hot si t≥15, o si g24≥30 con t≥0. up si t≥5, o si g24≥10 con t≥−1. down2 si t≤−8, o si g24≤−20 con t≤0. down si t≤−3, o si g24≤−7 con t≤1. Si no, flat.

Fallos encontrados:

1. **Filas, no días** (líneas 279-289). `k` cuenta filas y no fechas. En el 23,6 % de los juego-días, las 10 últimas filas abarcan más de 10 días naturales. Ejemplo: el 20/09, Lumber Tycoon 2 da «7d +561,7 %» porque compara con datos del 30/08.
2. **growth_7d no compara semana con semana.** La distancia entre los centros de las dos ventanas es de 6,5 días: 3 días contra 4, y con otros días de la semana. En una serie plana con el índice de septiembre, el sesgo va de **+7,1 % el lunes a −9,1 % el viernes**. El sesgo medido (growth_7d − WoW, septiembre) da lunes +6,9, viernes −8,3 y domingo +5,9 puntos.
3. **El día abierto entra en los cálculos.** k=1 es la mediana parcial de hoy (`part` en `db.js` 567-579). El ciclo de cada día es fuerte: la muestra de las 20:02 vale 0,83 veces la de las 15:34, y la de las 00:28 vale 1,10 veces la de las 21:13 (02-03/10). Con eso, el valor cambia según la hora a la que se mira.
4. **La x de Theil–Sen es la posición entre las filas limpias** (línea 232), no el día real. Si se quita un evento o falta un día, la escala se comprime. Además, 8 días no cubren semanas enteras: en una serie plana sale un sesgo de +1,8 %/día el lunes y de −2,7 %/día el viernes. Los umbrales son +5 y −3.
5. **status se fía de growth_24h** (377-379). Un sábado normal frente al viernes da +6,6 % de mediana (+27,8 % en septiembre). El 43 % de los pares sábado/viernes supera el +10 % que basta para «up». El lunes frente al domingo da −13,5 % de mediana, y el 67 % de los pares baja más de un 7 %.
6. **El informe semanal** sale el **lunes** a las 18 UTC (`telegram.js` 836 y 854: `weekday` 0 es el lunes). Usa growth_7d, que justo ese día tiene el sesgo más alto (+7 %). `telegram.js` repite `status` y `g7` (298-303 y 498): hay que cambiar las dos copias. El texto de ayuda de la web (`dashboard.html` 433) dice «hace una semana», y no es así.
7. `momentumScore` (386-388) y `emerging` (422 y 433) también usan g24 y g7, así que heredan el sesgo del fin de semana.

## 2. Efecto día de la semana (medido)

El índice es v entre la media móvil centrada de 7 días, por juego y sin eventos (2.397 semanas):

| | lun | mar | mié | jue | vie | sáb | dom |
|---|---|---|---|---|---|---|---|
| jun–sep | 0,99 | 0,94 | 0,93 | 0,95 | 1,00 | 1,06 | 1,13 |
| **septiembre** | 0,93 | 0,85 | 0,86 | 0,85 | 0,99 | **1,26** | **1,28** |
| julio (vacaciones) | 1,00 | 0,98 | 0,96 | 0,99 | 1,00 | 1,00 | 1,06 |

- En el panel agregado (41 juegos presentes cada día, sumados) sale sábado 1,21, domingo 1,27 y jueves 0,88.
- El efecto **cambia con el calendario escolar**: el índice tiene que ser móvil, no una constante.
- Por tamaño cambia poco: los de ≥100k tienen el domingo en 1,14 y los de <1k en 1,10.
- Entre juegos cambia mucho: el cociente sábado/lunes va de 0,89 (p10) a 1,24 (p90). Anime Squadron da 0,64 y Steal An Egg, 2,01.

**Falsos positivos del estado actual:**

- La parte de juegos «subiendo» va del 14 % (miércoles) al 27 % (domingo). En septiembre, la parte «bajando» va del 26 % (domingo) al 64 % (jueves).
- Las entradas en «subiendo» el sábado y el domingo superan en 405 de 860 (un 47 %) a las de martes a jueves.
- Las entradas en «bajando» el lunes superan en 216 de 563 (un 38 %) a las de martes a viernes.
- El 85 % de las entradas en «subiendo» se deshace en 3 días o menos.
- Ejemplos: Roll Anime to Fight! (06-07/09: up y luego down, con WoW de −9 %), Dig to Escape (13-14/09: up y luego down2), Barbie DreamHouse Tycoon (12-14/09: up, up y luego down2, con WoW de +4 %) y Survive the Apocalypse (13-14/09).

## 3. Propuesta

Se usan solo **días cerrados**, sin eventos (`flagEvents`) y con **ventanas por fecha**.

- **Índice por día de la semana** `I[dow]`: la mediana de v entre la media centrada de 7 días, con todos los juegos y las 8 últimas semanas, normalizada a media 1. Por juego solo con ≥6 semanas y con encogimiento hacia el global; en la v1, el global basta.
- Valor desestacionalizado: `ds_d = v_d / I[dow(d)]`.
- **WoW** = media(ds, D−6..D) / media(ds, D−13..D−7) − 1, con **≥4 días limpios en cada ventana**. Si no, es null.
- **MoM (4 semanas)** = media(ds, D−6..D) / media(ds, D−34..D−28) − 1.
- **mismo_dia** = v_D / v_{D−7} − 1, solo para mostrarlo (es ruidoso: p75 de unos ±20 %).
- **trend14**: Theil–Sen sobre log(ds) con x = días reales, 14 días y ≥7 puntos. Solo se enseña y entra en el momentum. Como filtro del estado no mejoró nada.
- **Juegos con menos de 2 semanas**: media de los 3 últimos ds contra los 3 primeros, con ≥6 días limpios y ≥6 días de distancia. El umbral sube ×1,5. Si no hay eso, el estado es «nuevo».
- **Estado** (umbral simétrico en logaritmo, T = 15 %):
  - hot: WoW ≥ +50 %
  - up: WoW ≥ +15 %
  - down: WoW ≤ −13 %
  - down2: WoW ≤ −33 %
  - **Histéresis sin estado guardado**: si el WoW de ayer ya pasaba el umbral, hoy basta con T/2.
  - El tamaño **no** justifica umbrales distintos. El |WoW| (p50/p75) da 9/20 % en los de <1k, 11/23 % en los de 1k–10k y 15/32 % en los de ≥100k. Los juegos pequeños no fluctúan más; los grandes, algo más. Los umbrales por tamaño (25/15/10 %) dieron lo mismo que un 15 % único.
- **Mensajes**: «ha subido/bajado un X % esta semana» con el WoW redondeado, solo si |WoW| ≥ T. Si no, «estable». Si la semana anterior tenía una media de menos de 300 jugadores, se escribe «despegando» en vez de un +300 %. Si es un juego de menos de una semana, «nuevo: +X % desde que lo seguimos». El informe semanal compara la semana cerrada de lunes a domingo con la anterior.

## 4. Backtest (actual frente a propuesta con histéresis)

| | actual | propuesta |
|---|---|---|
| % subiendo, lun…dom | 17 16 14 16 15 20 27 | 14 15 15 15 14 14 12 |
| % subiendo en septiembre | 25 16 14 10 14 28 28 | 10 12 12 12 11 9 9 |
| Cambios de estado | 46 % de los días (13,9 cada 30 días) | 13 % (3,9) |
| Exceso de subidas en fin de semana / de bajadas en lunes | 47 % / 38 % | 4 % / 1 % |
| Subidas / bajadas que se deshacen en ≤3 días | 85 % / 68 % | 28 % / 17 % |
| «Subiendo» con la semana siguiente ≥+10 % (o ≤0) | 53 % (33 %) | 71 % (17 %) |
| «Bajando» con la semana siguiente ≤−10 % (o ≥0) | 74 % (14 %) | 90 % (4 %) |
| Detecta cambios reales de ≥+25 % / ≤−25 % | 50 % / 78 % | 65 % / 80 % |

- El precio es que hay más «nuevo»: un 10,4 % de los juego-días, frente al 1,4 % de ahora (juegos con menos de dos semanas o con huecos).
- La verificación usa la misma semana base que el WoW, así que favorece un poco a la propuesta. El reparto por día de la semana y los vaivenes no dependen de ella.
- En el informe semanal del 13/09, 34 de 143 juegos tienen distinto signo en growth_7d y en WoW. Cuatro de los cinco primeros por 7d no tienen semana anterior comparable.

## 5. Qué cambiar

- **`metrics.js`**: ventanas por fecha; quitar el día abierto de las métricas diarias; `I[dow]`; añadir `growth_wow`, `growth_4w`, `vs_last_week_day` y `trend` (14 días, desestacionalizado); `status` desde WoW con histéresis; momentum y emergentes con WoW en vez de g7 y g24; y g24 desestacionalizado: (típico/prev)·I[ayer]/I[hoy].
- **`telegram.js`**: el mismo cambio en su copia (298-303 y 498) y el informe semanal con WoW.
- **`config.js`**: `STATUS = { wow_up: .15, wow_hot: .50, hyst: .5, min_days: 4 }`, un índice por defecto (el de septiembre) y **`EXPORT_DAILY_DAYS = 36`**. WoW cabe en las 24 filas de hoy (14 cerradas y la de hoy); el MoM necesita 35 días cerrados y la de hoy.
- **Export y Worker**: calcular `dow_index` una vez al día en el cierre diario, sobre `daily` y 8 semanas, guardarlo en `state` y enviarlo en el export. Se puede calcular en el navegador con las 24 filas, pero el export de Telegram lleva pocos juegos. El índice por juego necesitaría historia completa: no cabe en el export.
- **Paridad**: `analytics.py` y `metrics.parity.mjs` dejan de cuadrar. Hay que portar el cambio o asumir que se separan.
- **Transición**: hasta el 02/10 el valor del día era 1 muestra a las 13–16 UTC, y desde entonces es la mediana horaria. WoW mezcla las dos cosas hasta ~16/10 y el MoM hasta ~06/11. Conviene marcarlo como «midiendo» o aceptar el salto. Los juegos que salen del radar (1 dato al día) y vuelven a seguirse tienen el mismo problema.

## Anexo: ficheros

`dow.txt` y `dow2.txt` (efecto semana), `extra.txt` (sesgos teóricos y medidos, ruido e informe semanal), `backtest-*.txt` (variantes base/uni/uni20/conf/hyst), `ejemplos2.txt` (juegos con nombre), `proposal.mjs` (la propuesta en JS) y `backtest.mjs`.
