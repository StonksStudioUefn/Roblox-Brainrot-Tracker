"""
simdata.py — Datos locales "tal como estaban" en un instante `now`.

Lo usan make_export.py y py_dashboard.py para que Python y el export vean lo
mismo: muestras con ts ≤ now y, para el día de `now`, la fila diaria PARCIAL
calculada con esas muestras (como hace tracker.py en cada pasada y como hará
db.js desde `samples`), en vez de la fila del CSV, que ya tiene el día entero.
Favoritos y votos de hoy se conservan del CSV.
"""

import csv
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import store  # noqa: E402


def _int(v):
    return int(v) if v not in (None, "") else None


def load(data: Path, now: datetime):
    """→ (daily, raw): listas de dicts con el formato de store.read_all_daily / read_raw."""
    today, now_s = now.date().isoformat(), now.strftime("%Y-%m-%dT%H:%MZ")
    raw = []
    for p in sorted((data / "raw").glob("*.csv")):
        if p.stem > today:
            continue
        with p.open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["ts"] <= now_s:
                    raw.append({"ts": r["ts"], "universe_id": int(r["universe_id"]),
                                "playing": int(r["playing"]), "visits": _int(r["visits"])})
    daily, extra = [], {}
    for p in sorted((data / "daily").glob("*.csv")):
        with p.open(encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["date"] > today:
                    continue
                row = {k: _int(r[k]) for k in store.DAILY_FIELDS if k != "date"}
                row["date"] = r["date"]
                if r["date"] == today:
                    extra[row["universe_id"]] = row
                else:
                    daily.append(row)
    for row in store.aggregate_day([s for s in raw if s["ts"].startswith(today)], extra):
        old = extra.get(row["universe_id"], {})
        for k in ("favorites", "up", "down"):
            if row[k] is None:
                row[k] = old.get(k)
        row["date"] = today
        daily.append(row)
    daily.sort(key=lambda r: (r["date"], r["universe_id"]))
    return daily, raw
