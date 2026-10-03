#!/usr/bin/env python3
"""
py_dashboard.py — Ejecuta la referencia (export_dashboard.build() de Python)
con un `now` fijo y los datos tal como estaban en ese instante (simdata.py), y vuelca el
dashboard en un fichero. No escribe nada en data/.

  python py_dashboard.py --now 2026-10-03T00:31:00Z --out /tmp/py.json [--data DIR]
"""

import argparse
import contextlib
import sys
import tempfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import export_dashboard  # noqa: E402
import simdata  # noqa: E402
import store  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--now", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--data")
    args = ap.parse_args()
    now = datetime.fromisoformat(args.now.replace("Z", "+00:00"))

    class FixedDT(datetime):
        @classmethod
        def now(cls, tz=None):
            return now

    if args.data:
        store.GAMES_PATH = Path(args.data) / "games.json"
    export_dashboard.datetime = FixedDT
    store.datetime = FixedDT
    daily, raw = simdata.load(Path(args.data) if args.data else ROOT / "data", now)
    raw_by_day = {}
    for r in raw:
        raw_by_day.setdefault(r["ts"][:10], []).append(r)
    store.read_all_daily = lambda: [dict(r) for r in daily]
    store.read_raw = lambda d: raw_by_day.get(d.isoformat(), [])
    export_dashboard.store = store

    tmp = Path(tempfile.mkdtemp())
    export_dashboard.DASHBOARD_PATH = Path(args.out)
    export_dashboard.HISTORY_PATH = tmp / "history.json"
    with contextlib.redirect_stdout(sys.stderr):
        export_dashboard.build()


if __name__ == "__main__":
    main()
