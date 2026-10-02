"""
legacy.py — Importa las bases de datos del formato antiguo (data/tracker_*.db).

Se ejecuta solo desde tracker.py: si encuentra los .db, pasa todas sus
muestras a data/raw + data/daily, completa data/games.json y borra los .db.
Cuando ya no quedan .db no hace nada.
"""

import sqlite3
from collections import defaultdict
from datetime import datetime

import store
from config import DATA

LEGACY_DBS = sorted(DATA.glob("tracker_*.db"))


def import_legacy(resolve) -> bool:
    """`resolve(place_ids) -> {place_id: universe_id}` para los que no lo tengan."""
    dbs = [p for p in LEGACY_DBS if p.exists()]
    if not dbs:
        return False
    print(f"  Importando formato antiguo: {', '.join(p.name for p in dbs)}")
    games = store.load_games()
    place_map = {g["place_id"]: uid for uid, g in games.items() if g.get("place_id")}

    rows = []
    for db in dbs:
        con = sqlite3.connect(db)
        for pid, uid, name, players, visits, fav, ts in con.execute(
                "SELECT place_id, universe_id, name, player_count, visits, favorites, ts FROM snapshots"):
            if uid:
                place_map.setdefault(pid, uid)
            rows.append((pid, uid, name, players, visits, fav, ts))
        con.close()

    missing = sorted({r[0] for r in rows if not r[1] and r[0] not in place_map})
    if missing:
        place_map.update(resolve(missing))

    by_day, extra = defaultdict(list), defaultdict(dict)
    for pid, uid, name, players, visits, fav, ts in rows:
        uid = uid or place_map.get(pid)
        if not uid or not players:
            continue
        t = datetime.fromisoformat(ts)
        tss = t.strftime("%Y-%m-%dT%H:%MZ")
        g = games.setdefault(uid, {})
        g.setdefault("place_id", pid)
        g.setdefault("name", name)
        if tss < g.get("first_seen", "9999"):
            g["first_seen"] = tss
        by_day[t.date()].append({"ts": tss, "universe_id": uid, "playing": players, "visits": visits})
        if fav:
            extra[t.date()][uid] = {"favorites": fav, "up": None, "down": None}

    for d in sorted(by_day):
        existing = store.read_raw(d)
        seen = {(s["ts"], s["universe_id"]) for s in existing}
        new = []
        for s in sorted(by_day[d], key=lambda s: s["ts"]):
            if (s["ts"], s["universe_id"]) not in seen:
                seen.add((s["ts"], s["universe_id"]))
                new.append({**s, "visits": s["visits"] or ""})
        if new:
            store.append_raw(new, d)
        store.update_daily(d, extra[d])

    store.save_games(games)
    for p in dbs:
        p.unlink()
    print(f"  ✓ {len(rows):,} muestras antiguas importadas ({len(by_day)} días)")
    return True
