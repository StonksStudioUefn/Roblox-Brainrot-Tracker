"""
notifier.py — Avisos por Telegram a partir de data/dashboard.json.

Como el tracker corre varias veces al día, el notificador decide solo qué
toca enviar (y guarda en data/state.json lo ya enviado):
  · Alerta instantánea cuando aparece un emergente fuerte (una vez por juego).
  · Resumen diario: una vez al día, a partir de REPORT_HOUR_UTC.
  · Resumen semanal: los lunes.

Variables de entorno:
  TELEGRAM_TOKEN, TELEGRAM_CHAT_ID   (sin ellas, el mensaje se imprime)

Uso:
  python notifier.py              # envía lo que toque
  python notifier.py --daily      # fuerza el resumen diario
  python notifier.py --weekly     # fuerza el resumen semanal
  python notifier.py --dry-run    # muestra sin enviar ni guardar estado
"""

import html
import json
import os
import sys
from datetime import datetime, timezone

import requests

from config import DASHBOARD_PATH, STATE_PATH

REPORT_HOUR_UTC = 18          # el resumen diario sale en la primera ejecución desde esta hora
ALERT_MIN_SCORE = 70          # emergentes con esta puntuación generan alerta instantánea
MAX_ALERTS_PER_RUN = 5
DASHBOARD_URL = os.environ.get(
    "DASHBOARD_URL",
    "https://stonksstudiouefn.github.io/Roblox-Brainrot-Tracker/dashboard.html",
)


def h(s) -> str:
    return html.escape(str(s or ""), quote=False)


def num(n) -> str:
    if n is None:
        return "—"
    if n >= 1e9:
        return f"{n / 1e9:.1f}B"
    if n >= 1e6:
        return f"{n / 1e6:.1f}M"
    if n >= 1e3:
        return f"{n / 1e3:.1f}K"
    return str(int(n))


def pct(p) -> str:
    return "—" if p is None else f"{p:+.0f}%"


def link(g) -> str:
    return f'<a href="https://www.roblox.com/games/{g["place_id"]}">{h(g["title"][:40])}</a>'


def game_line(g, extra="") -> str:
    flags = " 🎉" if g.get("spike_now") else ""
    return f"• {link(g)} — <b>{num(g['typical'])}</b> ({pct(g['growth_24h'])} 24h){extra}{flags}"


# ─── Mensajes ──────────────────────────────────────────────────────────────────
def daily_report(data) -> str:
    lines = [f"🎮 <b>Roblox Tracker — resumen del {datetime.now(timezone.utc):%d/%m}</b>"]
    for key, cat in data["categories"].items():
        games = data["games"]
        lines.append(f"\n{cat['icon']} <b>{h(cat['label'])}</b> · {cat['stats']['games']} juegos · "
                     f"📈 {cat['stats']['rising']} · 📉 {cat['stats']['falling']}")
        trending = [games[str(u)] for u in cat["trending"][:5]]
        if trending:
            lines.append("<i>En tendencia</i>")
            lines += [game_line(g, f", {pct(g['trend'])}/día" if g.get("trend") is not None else "")
                      for g in trending]
        emerging = [games[str(u)] for u in cat["emerging"][:5]]
        if emerging:
            lines.append("<i>Emergentes</i>")
            lines += [game_line(g, f", {num(g['visits'])} visitas, ★{g['emerging']}") for g in emerging]
    lines.append(f'\n<a href="{DASHBOARD_URL}">Abrir dashboard</a>')
    return "\n".join(lines)


def weekly_report(data) -> str:
    lines = ["📅 <b>Roblox Tracker — la semana</b>"]
    for key, cat in data["categories"].items():
        games = [data["games"][str(u)] for u in cat["ids"]]
        up = sorted((g for g in games if g.get("growth_7d") is not None),
                    key=lambda g: -g["growth_7d"])[:8]
        down = sorted((g for g in games if g.get("growth_7d") is not None),
                      key=lambda g: g["growth_7d"])[:3]
        lines.append(f"\n{cat['icon']} <b>{h(cat['label'])}</b>")
        lines += [f"🚀 {link(g)} — {num(g['typical'])} ({pct(g['growth_7d'])} 7d)" for g in up]
        lines += [f"📉 {link(g)} — {num(g['typical'])} ({pct(g['growth_7d'])} 7d)" for g in down]
    lines.append(f'\n<a href="{DASHBOARD_URL}">Abrir dashboard</a>')
    return "\n".join(lines)


def alert(g, key, cat) -> str:
    reasons = ", ".join(g.get("emerging_reasons") or [])
    return (f"🌱 <b>Nuevo emergente</b> {cat['icon']}\n{link(g)} · ★{g['emerging']}\n"
            f"{num(g['typical'])} jugadores ({pct(g['growth_24h'])} 24h) · {num(g['visits'])} visitas\n"
            f"<i>{h(reasons)}</i>\n"
            f'<a href="{DASHBOARD_URL}#cat={key}&game={g["id"]}">Ver ficha</a>')


# ─── Envío ─────────────────────────────────────────────────────────────────────
def send(message: str, dry: bool) -> bool:
    token, chat = os.environ.get("TELEGRAM_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if dry or not token or not chat:
        print("--- mensaje (no enviado) ---")
        print(message)
        return not dry  # sin credenciales cuenta como "hecho" para no repetir
    r = requests.post(f"https://api.telegram.org/bot{token}/sendMessage", json={
        "chat_id": chat, "text": message, "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }, timeout=15)
    if not r.ok:
        print(f"✗ Telegram {r.status_code}: {r.text}", file=sys.stderr)
    return r.ok


def load_state() -> dict:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return {}


def main():
    args = set(sys.argv[1:])
    dry = "--dry-run" in args
    data = json.loads(DASHBOARD_PATH.read_text(encoding="utf-8"))
    state = load_state()
    now = datetime.now(timezone.utc)
    today, week = now.date().isoformat(), now.strftime("%G-W%V")

    # Alertas de emergentes (una sola vez por juego)
    alerted = state.setdefault("alerted", {})
    sent = 0
    for key, cat in data["categories"].items():
        for uid in cat["emerging"]:
            g = data["games"][str(uid)]
            if g["emerging"] >= ALERT_MIN_SCORE and str(uid) not in alerted and sent < MAX_ALERTS_PER_RUN:
                if send(alert(g, key, cat), dry):
                    alerted[str(uid)] = today
                    sent += 1

    if "--daily" in args or (now.hour >= REPORT_HOUR_UTC and state.get("last_daily") != today):
        if send(daily_report(data), dry):
            state["last_daily"] = today

    if "--weekly" in args or (now.weekday() == 0 and now.hour >= REPORT_HOUR_UTC
                              and state.get("last_weekly") != week):
        if send(weekly_report(data), dry):
            state["last_weekly"] = week

    if not dry:
        STATE_PATH.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
