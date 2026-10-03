"""
store.py — Lectura/escritura de los datos en disco.

Formato (texto plano, para que git guarde solo las diferencias):
  data/raw/AAAA-MM-DD.csv   muestras intradía   ts,universe_id,playing,visits
  data/daily/AAAA-MM.csv    agregados por día   date,universe_id,n,median,mean,min,max,visits,favorites,up,down
  data/games.json           ficha básica de cada juego {universe_id: {...}}

Los ficheros viven en el bucket R2 de Cloudflare; remote.py los baja y los
sube en cada ejecución.
"""

import csv
import json
import statistics
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from config import DAILY_DIR, GAMES_PATH, RAW_DIR, RAW_RETENTION_DAYS

RAW_FIELDS = ["ts", "universe_id", "playing", "visits"]
DAILY_FIELDS = ["date", "universe_id", "n", "median", "mean", "min", "max",
                "visits", "favorites", "up", "down"]


def _int(v):
    return int(v) if v not in (None, "") else None


# ─── Fichas de juegos ──────────────────────────────────────────────────────────
def load_games() -> dict[int, dict]:
    if not GAMES_PATH.exists():
        return {}
    raw = json.loads(GAMES_PATH.read_text(encoding="utf-8"))
    return {int(k): v for k, v in raw.items()}


def save_games(games: dict[int, dict]):
    GAMES_PATH.parent.mkdir(exist_ok=True)
    # Compacto: solo lo básico, sin campos vacíos
    ordered = {str(k): {f: v for f, v in games[k].items() if v not in (None, "", [])}
               for k in sorted(games)}
    GAMES_PATH.write_text(
        json.dumps(ordered, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
        encoding="utf-8",
    )


# ─── Muestras intradía ─────────────────────────────────────────────────────────
def raw_path(d: date):
    return RAW_DIR / f"{d.isoformat()}.csv"


def append_raw(rows: list[dict], d: date):
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    path = raw_path(d)
    new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=RAW_FIELDS)
        if new:
            w.writeheader()
        w.writerows(rows)


def read_raw(d: date) -> list[dict]:
    path = raw_path(d)
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        return [{
            "ts": r["ts"],
            "universe_id": int(r["universe_id"]),
            "playing": int(r["playing"]),
            "visits": _int(r["visits"]),
        } for r in csv.DictReader(f)]


def read_raw_since(days: int) -> list[dict]:
    today = datetime.now(timezone.utc).date()
    out = []
    for i in range(days, -1, -1):
        out.extend(read_raw(today - timedelta(days=i)))
    return out


def prune_raw():
    """Borra los CSV intradía más antiguos que RAW_RETENTION_DAYS."""
    if not RAW_DIR.exists():
        return 0
    cutoff = datetime.now(timezone.utc).date() - timedelta(days=RAW_RETENTION_DAYS)
    removed = 0
    for p in RAW_DIR.glob("*.csv"):
        try:
            if date.fromisoformat(p.stem) < cutoff:
                p.unlink()
                removed += 1
        except ValueError:
            continue
    return removed


# ─── Agregados diarios ─────────────────────────────────────────────────────────
def daily_path(month: str):
    return DAILY_DIR / f"{month}.csv"


def read_daily_month(month: str) -> list[dict]:
    path = daily_path(month)
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        rows = []
        for r in csv.DictReader(f):
            row = {k: _int(r[k]) for k in DAILY_FIELDS if k not in ("date", "mean")}
            row["date"] = r["date"]
            row["mean"] = _int(r["mean"])
            rows.append(row)
        return rows


def read_all_daily() -> list[dict]:
    if not DAILY_DIR.exists():
        return []
    out = []
    for p in sorted(DAILY_DIR.glob("*.csv")):
        out.extend(read_daily_month(p.stem))
    return out


def write_daily_month(month: str, rows: list[dict]):
    DAILY_DIR.mkdir(parents=True, exist_ok=True)
    rows = sorted(rows, key=lambda r: (r["date"], r["universe_id"]))
    with daily_path(month).open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=DAILY_FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r[k]) for k in DAILY_FIELDS})


def aggregate_day(samples: list[dict], extra: dict[int, dict] | None = None) -> list[dict]:
    """Convierte las muestras de un día en una fila por juego.

    `extra` aporta favoritos/votos (solo se guardan una vez al día).
    """
    by_game = defaultdict(list)
    visits = {}
    for s in samples:
        by_game[s["universe_id"]].append(s["playing"])
        if s["visits"] is not None:
            visits[s["universe_id"]] = max(visits.get(s["universe_id"], 0), s["visits"])
    extra = extra or {}
    out = []
    for uid, vals in by_game.items():
        e = extra.get(uid, {})
        out.append({
            "universe_id": uid,
            "n": len(vals),
            "median": round(statistics.median(vals)),
            "mean": round(statistics.fmean(vals)),
            "min": min(vals),
            "max": max(vals),
            "visits": visits.get(uid),
            "favorites": e.get("favorites"),
            "up": e.get("up"),
            "down": e.get("down"),
        })
    return out


def update_daily(d: date, extra: dict[int, dict]):
    """Recalcula la fila de hoy de cada juego a partir de las muestras de hoy."""
    month = d.strftime("%Y-%m")
    day = d.isoformat()
    rows = [r for r in read_daily_month(month) if r["date"] != day]
    previous = {r["universe_id"]: r for r in read_daily_month(month) if r["date"] == day}
    for r in aggregate_day(read_raw(d), extra):
        # Si hoy no se pudieron leer favoritos/votos, conserva los anteriores
        old = previous.get(r["universe_id"], {})
        for k in ("favorites", "up", "down"):
            if r[k] is None:
                r[k] = old.get(k)
        r["date"] = day
        rows.append(r)
    write_daily_month(month, rows)
