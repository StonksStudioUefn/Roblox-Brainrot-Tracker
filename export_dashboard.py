"""
export_dashboard.py — Genera los JSON que lee dashboard.html.

  data/dashboard.json  resumen de cada juego + listas por categoría (carga rápida)
  data/history.json    series diarias e intradía (carga diferida)

Iconos, miniaturas y descripciones no van aquí: la web los pide al Worker.

Uso:
  python export_dashboard.py
"""

import json
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import analytics as an
import store
from config import CATEGORIES, DASHBOARD_PATH, EMERGING, HISTORY_PATH, TRACK_MIN_PLAYERS

ACTIVE_DAYS = 2        # si no hay muestras en 2 días, el juego sale de las listas
HISTORY_DAYS = 120     # días de serie diaria en history.json
INTRADAY_DAYS = 7      # días de muestras intradía en history.json
SPARK_DAYS = 21


def build():
    now = datetime.now(timezone.utc)
    games_meta = store.load_games()

    daily = defaultdict(list)
    for r in store.read_all_daily():
        daily[r["universe_id"]].append(r)
    raw = defaultdict(list)
    for r in store.read_raw_since(INTRADAY_DAYS + 1):
        raw[r["universe_id"]].append(r)

    sample_ts = sorted({r["ts"] for rows in raw.values() for r in rows})
    last_sample = sample_ts[-1] if sample_ts else None
    day_cut = (now - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%MZ")
    samples_24h = sum(1 for t in sample_ts if t >= day_cut)

    active_cut = (now - timedelta(days=ACTIVE_DAYS)).date().isoformat()
    summary, history, metrics = {}, {}, {}

    for uid, rows in daily.items():
        rows.sort(key=lambda r: r["date"])
        if rows[-1]["date"] < active_cut:
            continue
        meta = games_meta.get(uid, {})
        m = an.game_metrics(rows, raw.get(uid, []), meta, now)
        m["status"] = an.status(m)
        m["momentum"] = an.momentum_score(m)
        if "horror" in meta:   # calculado por tracker.py con la descripción
            horror, h_score, h_reasons = meta["horror"], meta.get("horror_score", 0), meta.get("horror_reasons", [])
        else:                  # juegos sin detalles todavía: solo con el nombre
            horror, h_score, h_reasons = an.is_horror(meta, uid)
        em = an.emerging(m)
        events = m.pop("_events")
        metrics[uid] = (m, horror, em)

        title, tags = an.clean_title(meta.get("name") or "")
        spark_rows = list(zip(rows, events))[-SPARK_DAYS:]
        summary[uid] = {
            "id": uid,
            "place_id": meta.get("place_id"),
            "name": meta.get("name"),
            "title": title,
            "tags": tags,
            "creator": meta.get("creator"),
            "creator_verified": meta.get("creator_verified"),
            "genre": meta.get("genre_l1"),
            "subgenre": meta.get("genre_l2"),
            "max_players": meta.get("max_players"),
            "created": meta.get("created"),
            "updated": meta.get("updated"),
            "horror": horror,
            "horror_score": h_score,
            "horror_reasons": h_reasons,
            "emerging": em[0] if em else None,
            "emerging_reasons": em[1] if em else [],
            "spark": [r["median"] for r, _ in spark_rows],
            "spark_ev": [i for i, (_, e) in enumerate(spark_rows) if e],
            **m,
        }
        hist_rows = list(zip(rows, events))[-HISTORY_DAYS:]
        intraday_cut = (now - timedelta(days=INTRADAY_DAYS)).strftime("%Y-%m-%dT%H:%MZ")
        history[uid] = {
            "d": [[r["date"], r["median"], r["min"], r["max"], r["n"], int(e)] for r, e in hist_rows],
            "r": [[s["ts"], s["playing"]] for s in sorted(raw.get(uid, []), key=lambda s: s["ts"])
                  if s["ts"] >= intraday_cut],
        }

    categories = {}
    used = set()
    for key, cfg in CATEGORIES.items():
        def belongs(uid):
            return cfg["classifier"] == "all" or metrics[uid][1]

        ids = [uid for uid in metrics
               if belongs(uid) and (metrics[uid][0]["typical"] or 0) >= cfg["min_players"]]
        ids.sort(key=lambda u: -(metrics[u][0]["typical"] or 0))
        emerging = [uid for uid in metrics if belongs(uid) and metrics[uid][2]]
        emerging.sort(key=lambda u: -metrics[u][2][0])
        emerging = emerging[:EMERGING["max_results"]]
        def rising(u):
            m = metrics[u][0]
            return (m["status"] in ("hot", "up") and (m["trend"] is None or m["trend"] > 0)
                    and not (m["spike_now"] and (m["trend"] or 0) < 5))

        trending = sorted((u for u in ids if rising(u)),
                          key=lambda u: -metrics[u][0]["momentum"])[:12]
        players = sum(metrics[u][0]["typical"] or 0 for u in ids)
        categories[key] = {
            "label": cfg["label"],
            "icon": cfg.get("icon", "🎮"),
            "min_players": cfg["min_players"],
            "ids": ids,
            "emerging": emerging,
            "trending": trending,
            "stats": {
                "games": len(ids),
                "players": players,
                "rising": sum(1 for u in ids if metrics[u][0]["status"] in ("hot", "up")),
                "falling": sum(1 for u in ids if metrics[u][0]["status"] in ("down", "down2")),
                "events": sum(1 for u in ids if metrics[u][0]["spike_now"]),
                "new_7d": sum(1 for u in ids if metrics[u][0]["new_week"]),
            },
        }
        used.update(ids, emerging)
        print(f"  {cfg['label']}: {len(ids)} juegos · {len(emerging)} emergentes · {len(trending)} en tendencia")

    payload = {
        "updated_at": now.isoformat(timespec="seconds"),
        "last_sample": last_sample,
        "samples_24h": samples_24h,
        "track_min_players": TRACK_MIN_PLAYERS,
        "emerging_max_visits": EMERGING["max_visits"],
        "categories": categories,
        "games": {str(u): summary[u] for u in sorted(used)},
    }
    DASHBOARD_PATH.parent.mkdir(exist_ok=True)
    DASHBOARD_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
                              encoding="utf-8")
    HISTORY_PATH.write_text(json.dumps({str(u): history[u] for u in sorted(used)},
                                       ensure_ascii=False, separators=(",", ":")),
                            encoding="utf-8")
    print(f"✓ {DASHBOARD_PATH.name} ({DASHBOARD_PATH.stat().st_size:,} B) · "
          f"{HISTORY_PATH.name} ({HISTORY_PATH.stat().st_size:,} B)")
    return payload


if __name__ == "__main__":
    build()
