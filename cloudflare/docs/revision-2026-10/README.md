# Revisión de los algoritmos (04/10/2026)

Tres revisiones hechas con los datos reales de `data/daily` (del 15/05 al
01/10/2026: hasta el 01/10, una muestra al día por juego). Cada carpeta tiene su
`informe.md`, los scripts (Node, importan `cloudflare/src/metrics.js`) y sus
salidas (`.txt`). Las tareas que salen de aquí están en el kanban, tablero
ROBLOX TRACKER (J), hito «Subidas y bajadas por semanas» (J-K … J-V).

| Carpeta | Qué revisa |
|---|---|
| `subidas/` | 24 h, 7 días, tendencia y estado subiendo/bajando; efecto del día de la semana; propuesta semana contra semana con backtest |
| `eventos/` | La detección de días de evento (`flagEvents`) y «Pico ahora» con muestras cada hora |
| `listas/` | Emergentes, «En tendencia», momentum, selección del radar y alertas de Telegram |

Los scripts leen `data/` en la raíz del repo, que ya no está en `main`: se saca
del último commit con datos con `git archive 99d2ee9 data | tar -x`.
