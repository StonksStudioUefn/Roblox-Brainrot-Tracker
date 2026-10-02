"""
tracker.py — Toma una muestra de todos los juegos de Roblox con jugadores.

Cada ejecución:
  1. Descarga la lista de Rolimons (todos los juegos con su player count).
  2. Se queda con los que tienen ≥ TRACK_MIN_PLAYERS.
  3. Traduce place_id → universe_id (con caché en data/games.json).
  4. Enriquece con la API oficial: nombre, descripción, creador, género,
     fechas, visitas, favoritos, likes, icono y miniatura.
  5. Añade una muestra a data/raw/HOY.csv y recalcula data/daily/MES.csv.

La clasificación por categoría (general / horror) se hace después, en
export_dashboard.py, así que no hace falta una ejecución por categoría.
Está pensado para correr varias veces al día: con varias muestras diarias
un evento puntual no ensucia la media.

Uso:
  python tracker.py
"""

import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import requests

import legacy
import store
from config import TRACK_MIN_PLAYERS

ROLIMONS_GAMELIST = "https://api.rolimons.com/games/v1/gamelist"
GAMES_API = "https://games.roblox.com/v1/games"
VOTES_API = "https://games.roblox.com/v1/games/votes"
PLACE_UNIVERSE_API = "https://apis.roblox.com/universes/v1/places/{}/universe"
ICONS_API = "https://thumbnails.roblox.com/v1/games/icons"
THUMBS_API = "https://thumbnails.roblox.com/v1/games/multiget/thumbnails"

DESCRIPTION_CHARS = 600   # se guarda un extracto, suficiente para clasificar

SESSION = requests.Session()
SESSION.headers["User-Agent"] = "roblox-tracker/2.0"


def get_json(url: str, params=None, retries: int = 6, timeout: int = 20):
    """GET con reintentos y backoff. Devuelve el JSON o None."""
    for attempt in range(retries):
        try:
            r = SESSION.get(url, params=params, timeout=timeout)
            if r.status_code == 429:
                time.sleep(2 ** attempt + 1)
                continue
            if r.ok:
                return r.json()
            if 400 <= r.status_code < 500:
                return None
        except (requests.RequestException, ValueError):
            pass
        time.sleep(2 ** attempt)
    return None


def batched(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


# ─── Fuentes ───────────────────────────────────────────────────────────────────
def fetch_rolimons() -> dict[int, tuple[str, int]]:
    data = get_json(ROLIMONS_GAMELIST, timeout=30)
    if not data or not data.get("games"):
        raise RuntimeError("Rolimons no devolvió la lista de juegos")
    out = {}
    for pid, info in data["games"].items():
        try:
            out[int(pid)] = (info[0], int(info[1]))
        except (IndexError, TypeError, ValueError):
            continue
    return out


def resolve_universes(place_ids: list[int]) -> dict[int, int]:
    """place_id → universe_id. Solo se llama para places que no están en caché."""
    def one(pid):
        data = get_json(PLACE_UNIVERSE_API.format(pid), timeout=10)
        return pid, (data or {}).get("universeId")

    out = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for i, (pid, uid) in enumerate(ex.map(one, place_ids), 1):
            if uid:
                out[pid] = uid
            if i % 200 == 0:
                print(f"    universe IDs: {i}/{len(place_ids)}…")
    return out


def fetch_batched(url: str, ids: list[int], size: int, extra_params=None,
                  id_param: str = "universeIds") -> list[dict]:
    out = []
    for batch in batched(ids, size):
        params = {id_param: ",".join(map(str, batch)), **(extra_params or {})}
        data = get_json(url, params=params)
        if data:
            out.extend(data.get("data", []))
        else:
            print(f"  ⚠ Sin respuesta de {url} para {len(batch)} juegos", file=sys.stderr)
        time.sleep(0.5)
    return out


# ─── Pipeline ──────────────────────────────────────────────────────────────────
def run():
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    ts = now.strftime("%Y-%m-%dT%H:%MZ")
    print(f"▶ Tracker iniciado — {ts}")

    legacy.import_legacy(resolve_universes)   # solo hace algo la primera vez
    games = store.load_games()
    place_to_uid = {g["place_id"]: uid for uid, g in games.items() if g.get("place_id")}

    rolimons = fetch_rolimons()
    candidates = {pid: v for pid, v in rolimons.items() if v[1] >= TRACK_MIN_PLAYERS}
    print(f"  Rolimons: {len(rolimons):,} juegos · {len(candidates):,} con ≥{TRACK_MIN_PLAYERS} jugadores")

    unknown = [pid for pid in candidates if pid not in place_to_uid]
    if unknown:
        print(f"  Resolviendo {len(unknown)} universe IDs nuevos…")
        resolved = resolve_universes(unknown)
        place_to_uid.update(resolved)
        if len(resolved) < len(unknown):
            print(f"  ⚠ {len(unknown) - len(resolved)} sin universe ID (se reintentará)", file=sys.stderr)

    uid_to_place = {}
    for pid in candidates:
        uid = place_to_uid.get(pid)
        if uid:
            uid_to_place[uid] = pid
    uids = sorted(uid_to_place)

    print(f"  Descargando detalles de {len(uids)} juegos…")
    details = {d["id"]: d for d in fetch_batched(GAMES_API, uids, 50)}
    votes = {v["id"]: v for v in fetch_batched(VOTES_API, uids, 50)}
    icons = {i["targetId"]: i.get("imageUrl")
             for i in fetch_batched(ICONS_API, uids, 100,
                                    {"size": "256x256", "format": "Webp", "returnPolicy": "PlaceHolder"})
             if i.get("state") == "Completed"}
    thumbs = {}
    for t in fetch_batched(THUMBS_API, uids, 50,
                           {"countPerUniverse": 1, "size": "768x432", "format": "Webp", "defaults": "true"}):
        shots = [s for s in t.get("thumbnails") or [] if s.get("state") == "Completed"]
        if shots:
            thumbs[t["universeId"]] = shots[0]["imageUrl"]

    raw_rows, extra = [], {}
    for uid in uids:
        pid = uid_to_place[uid]
        d = details.get(uid, {})
        rol_name, rol_players = candidates[pid]
        playing = d.get("playing") or rol_players
        if not playing:
            continue

        g = games.setdefault(uid, {})
        g.setdefault("first_seen", ts)
        g["place_id"] = pid   # el de Rolimons: así la caché place→universe acierta
        g["name"] = d.get("name") or g.get("name") or rol_name
        if d:
            creator = d.get("creator") or {}
            g.update({
                "description": (d.get("description") or "")[:DESCRIPTION_CHARS],
                "creator": creator.get("name"),
                "creator_type": creator.get("type"),
                "creator_verified": bool(creator.get("hasVerifiedBadge")),
                "created": d.get("created"),
                "updated": d.get("updated"),
                "genre": d.get("genre"),          # género antiguo, lo elige el creador
                "genre_l1": d.get("genre_l1"),
                "genre_l2": d.get("genre_l2"),
                "max_players": d.get("maxPlayers"),
            })
        if uid in icons:
            g["icon"] = icons[uid]
        if uid in thumbs:
            g["thumb"] = thumbs[uid]

        raw_rows.append({"ts": ts, "universe_id": uid, "playing": playing,
                         "visits": d.get("visits") or ""})
        v = votes.get(uid, {})
        extra[uid] = {"favorites": d.get("favoritedCount"),
                      "up": v.get("upVotes"), "down": v.get("downVotes")}

    # Los places resueltos sin datos este turno se guardan igualmente para no
    # volver a pedirlos
    for pid, uid in place_to_uid.items():
        if uid not in games:
            games[uid] = {"place_id": pid, "name": rolimons.get(pid, ("?",))[0], "first_seen": ts}

    store.append_raw(raw_rows, now.date())
    store.update_daily(now.date(), extra)
    store.save_games(games)
    removed = store.prune_raw()

    print(f"✓ {len(raw_rows)} muestras guardadas ({len(details)} con datos oficiales)")
    if removed:
        print(f"  {removed} ficheros intradía antiguos eliminados")


if __name__ == "__main__":
    try:
        run()
    except (requests.RequestException, RuntimeError) as e:
        print(f"✗ Error: {e}", file=sys.stderr)
        sys.exit(1)
