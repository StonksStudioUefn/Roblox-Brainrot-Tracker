"""Avisos por Telegram desde data/dashboard.json; lo enviado se guarda en data/state.json para no repetir."""

import html
import json
import os
import re
import sys
from datetime import datetime, timezone

import requests

from config import DASHBOARD_PATH, STATE_PATH

REPORT_HOUR_UTC = 18          # el resumen diario sale en la primera ejecución desde esta hora
# Alerta «PETANDO» (una vez por juego, de cualquier género)
ALERT_MIN_PLAYERS = 40_000    # jugadores AHORA
ALERT_MIN_TYPICAL = 20_000    # y típicos (mediana 24 h): sostenido, no un pico de una hora
ALERT_MAX_AGE_DAYS = 120      # juego nuevo, no un clásico de siempre
MAX_ALERTS_PER_RUN = 3
REPORT_MIN_PLAYERS = 10_000   # los resúmenes solo listan juegos con estos jugadores típicos
LIST_SIZE = 5                 # juegos por sección
TITLE_CHARS = 30              # para que el nombre quepa en una línea del móvil
CAPTION_LIMIT = 1024          # límite de Telegram para el texto de una foto
DASHBOARD_URL = os.environ.get(
    "DASHBOARD_URL",
    "https://robloxtracker.stonksstudio.com/",
)
DAYS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"]


def h(s) -> str:
    return html.escape(str(s or ""), quote=False)


def num(n) -> str:
    if n is None:
        return "—"
    for div, suf in ((1e9, "B"), (1e6, "M"), (1e3, "K")):
        if n >= div:
            v = n / div
            return f"{v:.0f}{suf}" if v >= 100 else f"{v:.1f}{suf}"
    return str(int(n))


def pct(p) -> str:
    return "—" if p is None else f"{p:+.0f}%"


def short(title: str) -> str:
    title = title or "?"
    return title if len(title) <= TITLE_CHARS else title[:TITLE_CHARS - 1].rstrip() + "…"


def game_link(g) -> str:
    return f'<a href="https://www.roblox.com/games/{g["place_id"]}">{h(short(g["title"]))}</a>'


def card_link(key, g, text) -> str:
    return f'<a href="{DASHBOARD_URL}#cat={key}&amp;game={g["id"]}">{text}</a>'


def growth(g, arrow: bool = False) -> str:
    """La tendencia; si es casi plana, el cambio de 24 h."""
    t, g24 = g.get("trend"), g.get("growth_24h")
    if t is not None and (abs(t) >= 2 or g24 is None):
        value, unit = t, "/día"
    elif g24 is not None:
        value, unit = g24, " 24h"
    else:
        return "⏳ midiendo"
    icon = ("📈 " if value >= 0 else "📉 ") if arrow else ""
    return f"{icon}{pct(value)}{unit}"


def entry(i: int, g, *extra: str, medals: bool = True) -> str:
    mark = {1: "🥇", 2: "🥈", 3: "🥉"}.get(i, f"{i}.") if medals else f"{i}."
    stats = " · ".join([f"👥 {num(g['typical'])}", growth(g), *extra])
    flag = " 🎉" if g.get("spike_now") else ""
    return f"{mark} {game_link(g)}{flag}\n      └ {stats}"


def today_label(now) -> str:
    return f"{DAYS[now.weekday()]} {now:%d/%m}"


def is_boom(g) -> bool:
    """«Petando»: juego nuevo con muchos jugadores ahora y de forma sostenida,
    que no está cayendo."""
    return ((g.get("players") or 0) >= ALERT_MIN_PLAYERS
            and (g.get("typical") or 0) >= ALERT_MIN_TYPICAL
            and g.get("age_days") is not None and g["age_days"] <= ALERT_MAX_AGE_DAYS
            and g.get("status") not in ("down", "down2"))


def big(g) -> bool:
    return (g.get("typical") or 0) >= REPORT_MIN_PLAYERS


def alert_category(cats, g) -> str:
    if g.get("horror") and "horror" in cats:
        return "horror"
    return "general" if "general" in cats else next(iter(cats))


def daily_report(key, cat, games, now) -> tuple[str | None, str | None]:
    """Devuelve (texto, id del juego de la miniatura), o (None, None) si no hay
    ningún juego con REPORT_MIN_PLAYERS (ese día no se manda nada)."""
    s = cat["stats"]
    emerging = [g for g in (games[str(u)] for u in cat["emerging"]) if big(g)][:LIST_SIZE]
    shown = {g["id"] for g in emerging}
    trending = [g for g in (games[str(u)] for u in cat["trending"]) if big(g) and g["id"] not in shown][:LIST_SIZE]
    if not emerging and not trending:
        return None, None

    lines = [
        f"{cat['icon']} <b>{h(cat['label'].upper())}</b> · {today_label(now)}",
        f"<i>{s['games']} juegos · 📈 {s['rising']} suben · 📉 {s['falling']} bajan</i>",
    ]
    if emerging:
        lines += ["", "🌱 <b>Emergentes</b>"]
        lines += [entry(i, g, f"⭐{g['emerging']}") for i, g in enumerate(emerging, 1)]
    if trending:
        lines += ["", "🔥 <b>En tendencia</b>"]
        lines += [entry(i, g, medals=False) for i, g in enumerate(trending, 1)]
    lines += ["", f'📊 <a href="{DASHBOARD_URL}#cat={key}">Abrir dashboard</a>']

    top = (emerging or trending or [None])[0]
    return "\n".join(lines), (top or {}).get("id")


def weekly_report(key, cat, games, now) -> tuple[str | None, str | None]:
    listed = [g for g in (games[str(u)] for u in cat["ids"]) if big(g) and g.get("growth_7d") is not None]
    up = sorted(listed, key=lambda g: -g["growth_7d"])[:LIST_SIZE]
    down = sorted((g for g in listed if g["growth_7d"] < 0), key=lambda g: g["growth_7d"])[:3]
    if not up:
        return None, None
    lines = [
        f"📅 {cat['icon']} <b>{h(cat['label'].upper())} · LA SEMANA</b>",
        f"<i>hasta el {today_label(now)}</i>",
        "", "🚀 <b>Lo que más ha crecido</b>",
        *[entry(i, g, f"7d {pct(g['growth_7d'])}") for i, g in enumerate(up, 1)],
    ]
    if down:
        lines += ["", "🧊 <b>Lo que más ha caído</b>",
                  *[entry(i, g, f"7d {pct(g['growth_7d'])}", medals=False) for i, g in enumerate(down, 1)]]
    lines += ["", f'📊 <a href="{DASHBOARD_URL}#cat={key}">Abrir dashboard</a>']
    return "\n".join(lines), (up[0] if up else {}).get("id")


def alert(key, cat, g) -> tuple[str, str | None]:
    creator = h(g.get("creator") or "—") + (" ✔" if g.get("creator_verified") else "")
    genre = h(g.get("subgenre") or g.get("genre") or "")
    lines = [
        f"🚀 <b>PETANDO</b> · {cat['icon']} {h(cat['label'])}",
        "",
        f"<b>{h(g['title'])}</b>",
        f"<i>{creator}{' · ' + genre if genre else ''}</i>",
        "",
        f"👥 <b>{num(g.get('players'))}</b> jugadores ahora · {num(g['typical'])} de media en 24h",
        f"{growth(g, arrow=True)}" + (f" · {pct(g['growth_24h'])} en 24h"
                                      if growth(g).endswith("/día") and g.get("growth_24h") is not None else ""),
        f"👁 {num(g['visits'])} visitas" + (f" · +{num(g['visits_day'])}/día" if g.get("visits_day") else ""),
    ]
    extra = []
    if g.get("like_ratio") is not None:
        extra.append(f"👍 {g['like_ratio']:.0f}%")
    if g.get("age_days") is not None:
        extra.append(f"🗓 creado hace {g['age_days']} días")
    if extra:
        lines.append(" · ".join(extra))
    if g.get("emerging") is not None:
        lines += ["", f"⭐ <b>{g['emerging']}/100</b> — <i>{h(', '.join(g.get('emerging_reasons') or []))}</i>"]
    lines += [
        "",
        f'▶️ <a href="https://www.roblox.com/games/{g["place_id"]}">Jugar</a>   ·   📊 {card_link(key, g, "Ver ficha")}',
    ]
    return "\n".join(lines), g.get("id")


def visible_len(message: str) -> int:
    """Longitud que cuenta Telegram: sin etiquetas y con entidades resueltas."""
    return len(html.unescape(re.sub(r"<[^>]+>", "", message)))


def thumb_url(uid) -> str | None:
    if not uid:
        return None
    try:
        r = requests.get("https://thumbnails.roblox.com/v1/games/multiget/thumbnails", params={
            "universeIds": uid, "countPerUniverse": 1, "size": "768x432", "format": "Jpeg", "defaults": "true",
        }, timeout=15)
        shots = (r.json().get("data") or [{}])[0].get("thumbnails") or []
        return next((s["imageUrl"] for s in shots if s.get("state") == "Completed"), None)
    except (requests.RequestException, ValueError, IndexError):
        return None


def send(message: str, game_id, dry: bool) -> bool:
    token, chat = os.environ.get("TELEGRAM_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if dry or not token or not chat:
        print(f"--- mensaje (no enviado){f' · foto del juego {game_id}' if game_id else ''} ---")
        print(message)
        return not dry  # sin credenciales cuenta como "hecho" para no repetir
    api = f"https://api.telegram.org/bot{token}"
    # Con foto si cabe en el pie de foto; si falla la imagen, como texto
    photo = thumb_url(game_id) if visible_len(message) <= CAPTION_LIMIT else None
    if photo:
        r = requests.post(f"{api}/sendPhoto", json={
            "chat_id": chat, "photo": photo, "caption": message, "parse_mode": "HTML",
        }, timeout=20)
        if r.ok:
            return True
        print(f"  foto rechazada ({r.status_code}), se envía como texto", file=sys.stderr)
    r = requests.post(f"{api}/sendMessage", json={
        "chat_id": chat, "text": message, "parse_mode": "HTML",
        "link_preview_options": {"is_disabled": True},
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
    games, cats = data["games"], data["categories"]
    state = load_state()
    now = datetime.now(timezone.utc)
    today, week = now.date().isoformat(), now.strftime("%G-W%V")

    # Primera vez sin "boom": se apuntan sin avisar los que ya petan (no son noticia).
    seeding = "boom" not in state
    boomed = state.setdefault("boom", {})
    if seeding:
        state.pop("alerted", None)   # las alertas de emergentes de antes
    booming = sorted((g for g in games.values() if is_boom(g) and str(g["id"]) not in boomed),
                     key=lambda g: (-g["players"], g["id"]))
    sent = 0
    for g in booming:
        if seeding:
            boomed[str(g["id"])] = today
            continue
        if sent >= MAX_ALERTS_PER_RUN:
            break
        key = alert_category(cats, g)
        if send(*alert(key, cats[key], g), dry):
            boomed[str(g["id"])] = today
            sent += 1

    def send_all(build):
        msgs = [build(key, cat, games, now) for key, cat in cats.items()]
        return all([send(text, gid, dry) for text, gid in msgs if text])

    if "--daily" in args or (now.hour >= REPORT_HOUR_UTC and state.get("last_daily") != today):
        if send_all(daily_report):
            state["last_daily"] = today

    if "--weekly" in args or (now.weekday() == 0 and now.hour >= REPORT_HOUR_UTC
                              and state.get("last_weekly") != week):
        if send_all(weekly_report):
            state["last_weekly"] = week

    if not dry:
        STATE_PATH.write_text(json.dumps(state, indent=1, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
