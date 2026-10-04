# Revisión de los días de evento y de «Pico ahora»

Datos: `data/daily` del 01/08 al 01/10, con 10.600 días-juego de 362 juegos. Las pruebas se hicieron con el `flagEvents` real, importado de `metrics.js`, y un `flagCore` instrumentado que da 0 diferencias con él. Los scripts y las salidas están en esta carpeta: `actual.mjs`, `motivos.mjs`, `mercado.mjs`, `sinteticos.mjs`, `v3.mjs`, `variantes.mjs`, `diffD.mjs` y `spike.mjs`.

## 1. Qué marca hoy `flagCore` (metrics.js:188-223)

Un día *i* es evento si cumple las tres condiciones:

1. Supera 1,6 veces la base. La base es `max(mediana de los 3 días anteriores, mediana de los 3 posteriores)`, con la ventana contada por posición y no por fecha.
2. `v − base > 3,5·MAD`. La MAD se calcula con los 6 vecinos y tiene un suelo del 5 % de la mediana.
3. No se explica por el día de la semana: `v ≥ 1,6 × max(valor de hace 7 días, valor de hace 14 días)`.

No se marca si hay menos de 2 días antes o ninguno después (l.196). Por eso el primer día, el segundo y el último no se marcan nunca.

## 2. Resultados con los datos reales

- Se marcan **55 días, el 0,52 %**, en 49 juegos. De ellos, 36 (el 65 %) caen en sábado o domingo. El viernes da el 0,9 % y de lunes a jueves, el 0,1 %.
- **El fin de semana pesa mucho más desde la vuelta al cole.** El índice del sábado frente a la semana subió de 1,00 en junio-agosto a 1,26 en septiembre (p90 = 1,67). El del domingo, de 1,06 a 1,27. En los fines de semana de septiembre, entre el 25 % y el 35 % de los juegos superan 1,6 veces a sus vecinos. Los juegos de terror llegan a 2×: Night Shift at Paulie's marca cada fin de semana unos 2.400 frente a unos 950 entre semana. El filtro de la semana los descarta bien: **esos casos no son falsos positivos**.
- **Aciertos claros:** Grow a Chicken Fighter el 29/08 (188.058 frente a unos 35.000), Inside Brainrot Heads el 29/08 (20.001 frente a unos 3.000), Jump To Steal An Egg el 27/09 (46.914 frente a unos 9.000) y Emergency Response el 27/09 (24.363 frente a unos 7.500).
- **Falsos positivos:** son los juegos nuevos sin historia del mismo día de la semana. «he ate them.» el 19 y el 20/09 (1.773 y 1.568 frente a unos 850) es su fin de semana normal de juego de terror, porque al siguiente marcó 2.034 y 6.771. El 07/08 (viernes) se marcan 9 juegos a la vez, unas 3 veces su nivel, sin que el resto del catálogo se mueva (mediana del día: 0,99). Parece un fallo del muestreo, aunque podría ser un evento de la plataforma.
- **Falsos negativos:** hay 33 días a 2× o más de su base que el filtro de la semana tapa, y 3 que tapa la MAD. La mayoría son fines de semana normales de juegos de terror, y ahí el filtro acierta. Pero alrededor de 8 son eventos reales. Los ejemplos están en la tabla del apartado 3.

## 3. Errores en el código

| Línea | Problema | Ejemplo real |
|---|---|---|
| 209-216 | **Un evento tapa otro.** Se compara con el *máximo* de hace 7 y 14 días, sin quitar los días que ya fueron evento. | Inside Brainrot Heads el 05/09 (6.950) queda tapado por el evento del 29/08 (20.001). Lumber Tycoon 2 el 26/09 (33.190 frente a unos 9.000) queda tapado por el 19/09. |
| 209-216 | **Un juego en caída nunca da evento**, porque hace 14 días estaba más alto. | Prueba sintética: un pico de 2.000 a 5.000 queda tapado por un valor de 8.000 de hace 14 días. |
| 194 | **La ventana va por posición, no por fecha.** Con huecos, compara con meses atrás. | World // Zero el 19/09: sus «días anteriores» son del 27/05 y del 21/06. Hay un 6,4 % de filas con hueco. |
| 199-204 | **Una tendencia hincha la MAD**, porque la MAD se mide respecto a una sola mediana. | Steal a Chicken el 12/09: 39.950 frente a unos 18.000, en caída. |
| 196 | **En eventos de varios días se marca solo uno.** De 3 días seguidos se marca solo el del medio. Si son 2 días al final, no se marca ninguno. El último día entra limpio en `avg_7d` y en la tendencia (l.284-289). | — |
| 300 / 389 | **«Pico ahora» confunde crecimiento con evento.** De sus avisos, el 73 % cae en fin de semana y el 34 % son crecimientos que se mantienen. Aun así, el 0,7 de l.389 los castiga. | — |

Un escalón de crecimiento sostenido no se confunde con un evento, porque la base usa los días de después. Ese caso está bien resuelto.

## 4. «Pico ahora» con una muestra por hora

Hasta el 02/10 había una muestra al día, entre las 12:30 y las 22:20 UTC. Por eso la «mediana diaria» era en realidad el valor de la tarde. Ahora es la mediana de 24 horas, que es más baja que la tarde por un factor D. **D está estimado, no medido:** por la forma típica de Roblox, D ≈ 1,25-1,4. Aún no se puede medir porque los datos locales no tienen las muestras horarias (se mide como mediana de máximo/mediana del día). La última muestra de la tarde frente a esa base equivale a bajar el umbral de 1,8 a 1,8/D. Simulado sobre los datos:

| | Salta | Sábado | Domingo | Lun-vie | Precisión* |
|---|---|---|---|---|---|
| Hoy, una muestra al día | 2,2 % | 4,1 % | 5,4 % | 1,0 % | 16 % |
| Por horas, D = 1,25 | 7,4 % | 17 % | 18 % | 2,4 % | 6 % |
| Por horas, D = 1,4 | **13,0 %** | **28 %** | **31 %** | 4,8 % | 4 % |
| **Propuesta** | 1,6 % | 2,6 % | 3,6 % | 0,9 % | 22 % |

\* Precisión: la parte de los avisos que caen en un día que, visto después, se marca como evento.

**Propuesta para «Pico ahora»:**

- La base pasa a ser la **mediana de los máximos diarios** (`d[i][3]`) de los 7 días limpios. Así se mantiene la calibración antigua, porque el máximo se parece a la muestra de la tarde.
- Además, se exige `now ≥ 1,5 × máximo del mismo día de la semana` de hace 1 a 3 semanas, tomando su mediana.
- Una alternativa más fina es comparar con la mediana de la misma hora (±1 h) de los 7 días anteriores. D1 guarda 8 días, pero el export solo trae 48 h, así que habría que calcularlo en el Worker.

## 5. Propuesta para `flagCore`, validada

1. **Vecinos:** los 3 de cada lado, descartando los que estén a más de 7 días de calendario.
2. **MAD por lado:** cada lado se mide respecto a su propia mediana, `MAD = mediana(|antes − med_antes| ∪ |después − med_después|)·1,4826`, con un suelo de 0,05·base.
3. **Día de la semana:** `ref = mediana(v(d−7), v(d−14), v(d−21))`, sin contar los días ya marcados. Para eso se recorre la serie en orden. La condición es `v ≥ 1,6·ref`.
4. **Sin historia de ese día de la semana:** se usa `v ≥ 1,6·base·√M(fecha)`, donde M(fecha) es la mediana, en todo el catálogo, de v/base ese día. `buildDashboard` ya tiene todos los juegos para calcularla. M vale 1,20-1,27 los fines de semana de septiembre.
5. **Eventos de varios días:** se marcan también los días pegados (sin contar el último) con `v ≥ 1,6·base_del_evento` y `v ≥ 1,6·ref`.

| | Marcados | Sáb+dom |
|---|---|---|
| Hoy | 55 (0,52 %) | 65 % |
| Propuesta | **72 (0,68 %)** | 71 % |

Hay 48 días en común, 24 nuevos y 7 que se quitan.

- **Nuevos:** Lumber Tycoon 2 del 19 al 20/09 y del 26 al 27/09, Inside Brainrot Heads el 05/09, Steal a Chicken el 12/09, Wings for Brainrots el 18/09 (8.720 frente a unos 3.400), DOORS el 30/08 y Steal An Egg el 29/08 (2,63 M frente a unos 0,95 M).
- **Siguen sin marcarse** los fines de semana normales de terror (Night Shift at Paulie's, Scary Sushi) y no aparece un efecto cascada cuando cambia el patrón del fin de semana.
- **Se quitan:** 5 juegos con huecos, entre ellos el bloque del 07/08, y Tongue Escape el 13/09 (1,7× un domingo con M = 1,23), que era dudoso.
- **Coste:** «he ate them.» sigue marcado el 19/09.

Por separado, la mediana de 3 semanas da 0,68 %. Las variantes probadas están en `variantes.txt`. Con 2 semanas se pasa al 0,75 %, y quitar M sube los falsos positivos de los juegos nuevos.

**Aviso del cambio de régimen:** del 02 al 03/10 el valor diario baja por un factor D sin que cambie nada en los juegos. Durante unas 3 semanas, la tendencia, los 7 días y las bases mezclan los dos regímenes. Para comparar lo mismo con lo mismo, conviene usar el máximo diario, o la mediana de 13 a 22 UTC, en los cálculos de eventos y de pico mientras dure la transición.
