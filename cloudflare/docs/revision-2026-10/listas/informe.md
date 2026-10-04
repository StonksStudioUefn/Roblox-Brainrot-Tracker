# Revisión de emergentes, «en tendencia», radar y alertas

**Datos:** del 15/08 al 27/09, con `metrics.js` real (`buildDashboard` y `radarScore` con 14 filas y `s: []`). Hay unos 150 juegos al día con ≥300 jugadores, y 29 de ellos tienen ≤30M visitas.
**Qué cuenta como acierto:** que la media de jugadores de la semana siguiente (D+1..D+7) supere a la de la semana actual (D−6..D). Así el día de la semana no influye. Un «gran crecimiento» es ≥ +30 %.
**Tasa base:** solo el 28 % de los juegos crece de una semana a la otra (21 % entre los de ≤30M visitas).

**Límites de los datos:**
- Hasta el 01/10 hay 1 muestra por juego y día, a una hora que varía (5 h de media por juego, hasta 21 h).
- No hay votos ni historial de las listas de Roblox: no se pudieron probar los +15/+10 ni los likes.
- `fresh` no se activa antes del 04/10.

## 1. Situación actual

| Lista | Por día | Sigue creciendo | Recall (≥+30 %) | Fin de semana |
|---|---|---|---|---|
| Emergentes | 5,7 | **52 %** (base 21 %) | 65 % | Sáb/dom: 7,6 al día y 43 % de aciertos (laborables: 4,9 y 57 %). Media de la semana siguiente: +0,6 % frente a +15,6 % |
| En tendencia | 10,9 | **66 %** (base 28 %) | 34 % | Entran 5–6 nuevos cada día de 12 |
| Emergentes ≥70 | 2,0 | 71 % | 30 % | Primera alerta por juego: 23, con un 69 % de aciertos. 11 caen en sábado o domingo, con un 50 % |

- **Entradas de fin de semana que salen el lunes:** el 69 % de los emergentes (22 de 32) y el 63 % de los de tendencia.
- **Entradas por día:** sábado 3,1 y lunes 0,8.
- 21 de esos 22 emergentes entraron porque `g24/2` era el término máximo.
- **Mercado:** el cambio mediano de un día al siguiente es +5,6 % el sábado y −13,4 % el lunes. El 41 % de los juegos sube más de un 10 % de viernes a sábado.

**Ejemplos:**
- **Aciertos:** Anime Dice (13/09, 85 puntos → +56 %), +1 Tongue Escape (alerta 11/09 → +48 %), Steal A Verity (24/09 → +137 %).
- **Fallos de fin de semana:** Steal a Chicken (sáb 12/09, g24 +89 % → −58 %), Backrooms Morphs 2 (alerta el dom 13/09 → −41 %), +1 Long Arm Toy Escape (alerta el dom 13/09 → −39 %), Steal Fish Eggs (dom 20/09, g24 +91 % con g7 −6 % → −41 %).
- **No detectado:** Steal An Egg (22 días, 42M visitas, +152 %).

## 2. Errores y criterios dudosos (`metrics.js`)

- **L433** `growth = max(t, g24/2, g7/5)`: el máximo de tres señales con ruido. Un sábado, un +40 % en un día da los 25 puntos de crecimiento.
- **L422** `growing`: basta con que *una* señal sea >0, y los sábados casi todas lo son.
- **L376–377 y L527**: «up/hot» con `g24 ≥ 10/30`. Esa es la puerta de entrada de fin de semana a «en tendencia».
- **L196 y L300**: el último día nunca se marca como evento, y `spike_now` exige ×1,8. Un +20–40 % de fin de semana no se penaliza.
- **L228–238 y L278–294**: Theil–Sen y `growth_7d` trabajan por posición de fila, no por fecha. El 6,8 % de los días consecutivos tiene huecos, y quitar los días de evento comprime el eje.
- **L316–318**: en el radar, las visitas por día se dividen por días de calendario, aunque las muestras se tomen a horas distintas (ruido de ±20 %).
- **L291, L351 y L409**: si el primer día no tiene visitas, `visits_growth` sale null y se pierden 30 de 100 puntos. Si no hay visitas en ninguna fila, el juego se excluye con strict.
- **L57, L417 y L423 (+15/+10):**
  - Un juego sin ninguna medida propia (t, g24 y g7 null) entra solo con la lista de Roblox. Por ejemplo: 20 días (16,7) + 3.000 jugadores (10) + 90 % de likes (7,5) + 15 = 49 puntos.
  - Además, los +15 pueden subir un 55 hasta la alerta de 70 sin ninguna confirmación propia.
- **config.js L109** (`max_visits` 30M): deja fuera a 37 de los 95 juegos con ≤90 días que crecieron ≥30 % (39 %). Ejemplos: Steal An Egg, Anime Dice (31M) y Anime Ability Arena.

## 3. Propuesta (comparaciones entre semanas)

Se calculan sobre `d`, **por fecha**. El export tiene 24 filas y el radar 14, que bastan.

- `sdw = v[D]/v[D−7] − 1`: el mismo día de la semana anterior. Es la mejor señal: Spearman 0,43 con la semana siguiente (t 0,37; g7 0,38; g24 0,14).
- `w1 = media(D−6..D)/media(D−13..D−7) − 1`, con ≥4 días en cada semana.
- `vg7 = (V[D]−V[D−7]) / 7 / V[D]`.
- Para juegos sin D−7: `g24adj = (1+g24)/(1+mkt) − 1`, donde `mkt` es el cambio mediano de un día al siguiente de todos los juegos seguidos.
- **w2 (dos semanas seguidas): no aporta.** Spearman 0,06; un 35 % de aciertos frente al 32 % sin ella. Sirve como etiqueta, no como peso.

**Cambios:**
1. **Emergentes (L433, L422, L430):**
   - `growth = max(t, (sdw ?? g24adj)/4, g7/5)`.
   - `growing = sdw != null ? sdw>0 && (t>0 || g7>0 || w1>0) : (regla de hoy con g24adj)`.
   - `sVisits` con `vg7 ?? vg`.
2. **En tendencia (L388, L529):**
   - `momentum = 35·clip(G/60) + 25·clip(sdw/50) + 20·clip(t/20) + 20·tamaño`, con `G = mediana(sdw, w1, (1+t)^7−1)`.
   - Lista estable: quien estaba ayer se queda si sigue «rising» y está en el top 18. Para eso hay que guardar `trending` del día anterior en `state`.
3. **Radar (sampler.js L607 → `emergingCore` con strict=false):** los mismos cambios del punto 1.
4. **Telegram (telegram.js L884):** se avisa si la puntuación es ≥70 **y** está confirmada: `sdw>0 && w1>0`, o, sin una semana de historia, ≥70 también en el cierre diario anterior (`state.pending`).
   - Sin validar: que los +15/+10 no cuenten para llegar a 70.
   - Sin validar: un tope de visitas que dependa de la edad, por ejemplo 150M si tiene ≤60 días.

## 4. Backtest (antes → después)

| | Aciertos | Recall | Salen el lunes (de las entradas de sáb/dom) | Otros |
|---|---|---|---|---|
| Emergentes | 52 % → **57 %** | 65 % → 63 % | 28/38 → **19/31** | |
| Alertas (primera por juego) | 69 % → **87 %** | | | 23 → 17 alertas. Fin de semana: 50 % → 100 % (4). Mediana de la semana siguiente: +20 % → +22 % |
| En tendencia | 65 % → 64 % | 32 % → 31 % | 25 → **9** | Nuevos por día: 5,3 → 4,2 |
| Radar, top 5 de candidatos | 58 % → 61 % | | | |

- Las alertas que se quitan son Spinjitsu, Squishy, Backrooms Morphs 2 y Long Arm, entre otras. Steal A Brainrot Egg no se quita: se retrasa al 11/09 (+22 %).
- En tendencia, la mejora es de **estabilidad, no de precisión**.
- En el radar, la mejora es marginal: el universo de prueba es pequeño.

En emergentes, la mejora se mantiene en las dos mitades por separado: 49 → 54 % del 15/08 al 05/09 y 54 → 59 % del 06/09 al 27/09. Aun así, las muestras son pequeñas: hay que revisarlo con los datos horarios desde el 03/10.

Scripts: `lib.mjs`, `baseline.mjs`, `run_base.mjs`, `weekly.mjs`, `signals.mjs`, `grid_em.mjs`, `grid_tr.mjs`, `radar2.mjs` y `cap.mjs`.
