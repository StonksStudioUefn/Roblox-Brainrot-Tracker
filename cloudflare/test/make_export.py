#!/usr/bin/env python3
"""
make_export.py — Construye un export.json con el formato de cloudflare/CONTRACT.md
("Formato de /api/export") a partir de los ficheros locales de data/.

Imita lo que hará db.js con D1 (con los datos tal como estaban en `now`, ver simdata.py):
  · `d`: las últimas EXPORT_DAILY_DAYS filas de la serie diaria de cada juego
    (con --daily-mode calendar, los últimos N días de calendario);
  · `s`: las muestras desde (última muestra − EXPORT_SAMPLE_HOURS h), ambos
    incluidos, como [ts_minutos_epoch, playing, visits|null];
  · `peak`, `peak_date`, `days_tracked`, `first_day`, `favorites`, `up` y `down`
    de toda la historia (con la misma semántica que analytics.game_metrics);
  · filtro de juegos del contrato (muestras en 48 h + umbrales con el máximo de 24 h).

Opciones para las pruebas de paridad:
  --now ISO           instante simulado: se ignoran los datos posteriores
  --daily-days N|all  días de serie diaria (por defecto 21)
  --daily-mode rows|calendar  últimas N filas (por defecto) o últimos N días de calendario
  --sample-hours N|all  horas de muestras (por defecto 48; all = 8 días, como Python)
  --no-filter         todos los juegos con serie diaria (sin el filtro del contrato)
  --sorts FILE        respuesta de explore-api get-sorts → campo `sorts` (rank 1-based)
  --out FILE          salida (por defecto stdout)
  --data DIR          carpeta data/ (por defecto la del repo)
"""

import argparse
import json
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import analytics  # noqa: E402
import simdata  # noqa: E402
from config import CATEGORIES, EMERGING  # noqa: E402

EXPORT_DAILY_DAYS = 21
EXPORT_SAMPLE_HOURS = 48
PY_RAW_DAYS = 8          # export_dashboard: read_raw_since(INTRADAY_DAYS + 1)


def fmt_min(dt):
    return dt.strftime("%Y-%m-%dT%H:%MZ")


def ts_minutes(ts):
    return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() // 60)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--now")
    ap.add_argument("--daily-days", default=str(EXPORT_DAILY_DAYS))
    ap.add_argument("--sample-hours", default=str(EXPORT_SAMPLE_HOURS))
    ap.add_argument("--daily-mode", choices=("rows", "calendar"), default="rows")
    ap.add_argument("--no-filter", action="store_true")
    ap.add_argument("--sorts")
    ap.add_argument("--out")
    ap.add_argument("--data", default=str(ROOT / "data"))
    args = ap.parse_args()
    data = Path(args.data)

    if args.now:
        now = datetime.fromisoformat(args.now.replace("Z", "+00:00"))
    else:   # 3 min después de la última muestra
        last = max(simdata.load(data, datetime.now(timezone.utc))[1], key=lambda r: r["ts"])["ts"]
        now = datetime.fromisoformat(last.replace("Z", "+00:00")) + timedelta(minutes=3)
    today = now.date()
    daily_rows, raw_rows = simdata.load(data, now)
    raw_all = [(r["ts"], r["universe_id"], r["playing"], r["visits"]) for r in raw_rows]
    daily = defaultdict(list)
    for r in daily_rows:
        daily[r["universe_id"]].append(r)
    games_meta = {int(k): v for k, v in json.loads((data / "games.json").read_text(encoding="utf-8")).items()}

    sample_ts = sorted({r[0] for r in raw_all if r[0] >= (today - timedelta(days=PY_RAW_DAYS)).isoformat()})
    last_sample = sample_ts[-1] if sample_ts else None
    day_cut = fmt_min(now - timedelta(hours=24))
    samples_24h = sum(1 for t in sample_ts if t >= day_cut)

    if args.sample_hours == "all":
        s_cut = (today - timedelta(days=PY_RAW_DAYS)).isoformat()      # como Python
    else:
        ref = datetime.fromisoformat(last_sample.replace("Z", "+00:00"))
        s_cut = fmt_min(ref - timedelta(hours=int(args.sample_hours)))
    act_cut = fmt_min(now - timedelta(hours=48))
    by_game = defaultdict(list)
    for r in raw_all:
        if r[0] >= s_cut:
            by_game[r[1]].append(r)

    sorts = {}
    if args.sorts:
        for srt in json.loads(Path(args.sorts).read_text(encoding="utf-8")).get("sorts", []):
            for i, g in enumerate(srt.get("games") or []):
                sorts.setdefault(int(g["universeId"]), {}).setdefault(srt["sortId"], i + 1)

    n_days = None if args.daily_days == "all" else int(args.daily_days)
    d_cut = (today - timedelta(days=n_days - 1)).isoformat() if n_days and args.daily_mode == "calendar" else None
    out = []
    for uid, rows in daily.items():
        rows.sort(key=lambda r: r["date"])
        meta = games_meta.get(uid, {})
        smp = sorted(by_game.get(uid, []))
        if "horror" in meta:
            horror, h_score, h_reasons = bool(meta["horror"]), meta.get("horror_score", 0), meta.get("horror_reasons", [])
        else:
            horror, h_score, h_reasons = analytics.is_horror(meta, uid)
        visits = next((d["visits"] for d in reversed(rows) if d["visits"]), None)
        if not args.no_filter:
            if not any(t >= act_cut for t, *_ in smp):
                continue
            max24 = max((p for t, _, p, _ in smp if t >= day_cut), default=0)
            ok = (max24 >= CATEGORIES["general"]["min_players"]
                  or horror and max24 >= CATEGORIES["horror"]["min_players"]
                  or visits is not None and visits < EMERGING["max_visits"] and max24 >= EMERGING["min_players"])
            if not ok:
                continue
        peak_i = max(range(len(rows)), key=lambda i: rows[i]["max"])
        out.append({
            "id": uid,
            "place_id": meta.get("place_id"),
            "name": meta.get("name"),
            "creator": meta.get("creator"),
            "creator_verified": meta.get("creator_verified"),
            "created": meta.get("created"),
            "updated": meta.get("updated"),
            "genre": meta.get("genre"),
            "genre_l1": meta.get("genre_l1"),
            "genre_l2": meta.get("genre_l2"),
            "max_players": meta.get("max_players"),
            "first_seen": meta.get("first_seen"),
            "horror": bool(horror),
            "horror_score": h_score,
            "horror_reasons": h_reasons,
            "sorts": sorts.get(uid, {}),
            "favorites": next((d["favorites"] for d in reversed(rows) if d["favorites"]), None),
            "up": next((d["up"] for d in reversed(rows) if d["up"] is not None), None),
            "down": next((d["down"] for d in reversed(rows) if d["down"] is not None), None),
            "peak": rows[peak_i]["max"],
            "peak_date": rows[peak_i]["date"],
            "days_tracked": len(rows),
            "first_day": rows[0]["date"],
            "d": [[r["date"], r["median"], r["min"], r["max"], r["n"], r["visits"]]
                  for r in (rows[-n_days:] if n_days and not d_cut else rows) if d_cut is None or r["date"] >= d_cut],
            "s": [[ts_minutes(t), p, v] for t, _, p, v in smp],
        })
    # db.js no garantiza ningún orden: se barajan por id para que el port no dependa de él
    out.sort(key=lambda g: (g["id"] * 2654435761) % 4294967296)
    payload = {
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "last_sample": last_sample,
        "samples_24h": samples_24h,
        "games": out,
    }
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"export: {len(out)} juegos, {len(text):,} B → {args.out}", file=sys.stderr)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
