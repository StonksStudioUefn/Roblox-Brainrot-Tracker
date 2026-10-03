#!/usr/bin/env python3
"""
migrate_from_git.py — Sube los datos actuales del tracker (CSV/JSON del repo)
a la versión Cloudflare (D1) por POST /api/admin/import, en lotes.

Qué sube (pensado para no pasar del límite de 100.000 filas escritas/día de D1):
  · games     data/games.json (~2.400). Se ignoran los campos antiguos
              (description, icon, thumb, creator_type); el horror se calcula
              aquí con analytics.is_horror (con la descripción si la hay) y la
              descripción NO se sube. tracked=1 solo si tiene muestras en 48 h.
  · places    place_id → universe_id (caché de Rolimons), de games.json.
  · daily     data/daily/*.csv entero, salvo el día de hoy (UTC), que el
              Worker calcula al vuelo desde las muestras (~27.000 filas).
  · samples   data/raw/*.csv, solo las últimas 48 h.
  · state     telegram = data/state.json; closed_day = ayer.
  Al final llama a /api/admin/rebuild (agregados de la historia + export).

Es re-ejecutable: el import hace UPSERT y solo escribe filas nuevas o
distintas, así que repetirlo no duplica ni gasta escrituras.

Uso:
  python cloudflare/scripts/migrate_from_git.py --url https://roblox-tracker.<cuenta>.workers.dev \\
      [--ref origin/main | --dir /ruta/al/repo]  [--token …]  [--dry-run]

  El token sale de --token o de la variable ADMIN_TOKEN.
"""

import argparse
import csv
import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import analytics  # noqa: E402  (is_horror: misma lógica que en producción)

DROPPED = {"description", "icon", "thumb", "creator_type"}
SAMPLE_HOURS = 48


# ─── Lectura (git o carpeta) ──────────────────────────────────────────────────
class Source:
    def __init__(self, ref=None, root=None):
        self.ref, self.root = ref, Path(root) if root else None

    def list(self, prefix):
        if self.ref:
            out = subprocess.run(["git", "-C", str(ROOT), "ls-tree", "-r", "--name-only", self.ref, prefix],
                                 check=True, capture_output=True, text=True).stdout
            return sorted(p for p in out.splitlines() if p)
        base = self.root / prefix
        return sorted(str(p.relative_to(self.root)) for p in base.rglob("*") if p.is_file()) if base.exists() else []

    def read(self, path):
        if self.ref:
            r = subprocess.run(["git", "-C", str(ROOT), "show", f"{self.ref}:{path}"], capture_output=True)
            if r.returncode:
                return None
            return r.stdout.decode("utf-8")
        p = self.root / path
        return p.read_text(encoding="utf-8") if p.exists() else None


def _int(v):
    if v in (None, ""):
        return None
    try:
        return int(v)
    except ValueError:
        return int(float(v))


def ts_minutes(iso):
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() // 60)


# ─── Construcción de filas ────────────────────────────────────────────────────
def build(src, now):
    today = now.date().isoformat()
    yesterday = (now.date() - timedelta(days=1)).isoformat()
    cut = int(now.timestamp() // 60) - SAMPLE_HOURS * 60

    # Muestras de las últimas 48 h
    samples = []
    for path in src.list("data/raw"):
        if not path.endswith(".csv"):
            continue
        day = Path(path).stem
        if day < (now.date() - timedelta(days=3)).isoformat():
            continue
        for r in csv.DictReader(io.StringIO(src.read(path) or "")):
            try:
                ts = ts_minutes(r["ts"])
            except (KeyError, ValueError):
                continue
            if ts < cut:
                continue
            samples.append([int(r["universe_id"]), ts, _int(r["playing"]), _int(r.get("visits"))])
    recent = {s[0] for s in samples}

    # Serie diaria (sin el día en curso). Los favoritos/votos que tracker.py ya
    # guardó HOY pasan a la fila de AYER, que es donde los deja el Worker
    # (así el export da los mismos "últimos conocidos" que Python).
    daily = []
    last_day = None
    today_votes = {}
    rows_csv = []
    for path in src.list("data/daily"):
        if not path.endswith(".csv"):
            continue
        rows_csv.extend(csv.DictReader(io.StringIO(src.read(path) or "")))
    for r in rows_csv:
        if r.get("date") == today:
            today_votes[int(r["universe_id"])] = (_int(r["favorites"]), _int(r["up"]), _int(r["down"]))
    for r in rows_csv:
        if not r.get("date") or r["date"] >= today:
            continue
        if r["date"] == yesterday and int(r["universe_id"]) in today_votes:
            fav, up, down = today_votes[int(r["universe_id"])]
            r = {**r, "favorites": fav if fav else r["favorites"],
                 "up": up if up is not None else r["up"], "down": down if down is not None else r["down"]}
        daily.append([int(r["universe_id"]), r["date"], _int(r["n"]), _int(r["median"]), _int(r["mean"]),
                      _int(r["min"]), _int(r["max"]), _int(r["visits"]), _int(r["favorites"]),
                      _int(r["up"]), _int(r["down"])])
        last_day = max(last_day or r["date"], r["date"])

    # Fichas
    raw_games = json.loads(src.read("data/games.json") or "{}")
    games, places = [], []
    horror_n = 0
    for k, g in raw_games.items():
        uid = int(k)
        meta = {f: v for f, v in g.items() if f not in DROPPED}
        if "horror" in g and "description" not in g:
            horror, score, reasons = g["horror"], g.get("horror_score", 0), g.get("horror_reasons", [])
        else:
            horror, score, reasons = analytics.is_horror({**meta, "description": g.get("description") or ""}, uid)
        horror_n += bool(horror)
        verified = meta.get("creator_verified")
        games.append([
            uid, meta.get("place_id"), meta.get("name"), meta.get("creator"),
            None if verified is None else int(bool(verified)),
            meta.get("created"), meta.get("updated"), meta.get("genre"), meta.get("genre_l1"),
            meta.get("genre_l2"), meta.get("max_players"), meta.get("first_seen"),
            int(bool(horror)), int(score), json.dumps(reasons, ensure_ascii=False),
            json.dumps(["rolimons"]), 1 if uid in recent else 0,
        ])
        if meta.get("place_id"):
            places.append([int(meta["place_id"]), uid])

    state = []
    tg = src.read("data/state.json")
    if tg:
        state.append(["telegram", json.dumps(json.loads(tg), ensure_ascii=False, separators=(",", ":"))])
    if last_day:
        state.append(["closed_day", json.dumps(min(last_day, yesterday))])

    return {
        "games": (["universe_id", "place_id", "name", "creator", "creator_verified", "created", "updated",
                   "genre", "genre_l1", "genre_l2", "max_players", "first_seen", "horror", "horror_score",
                   "horror_reasons", "sources", "tracked"], games),
        "places": (["place_id", "universe_id"], places),
        "daily": (["universe_id", "date", "n", "median", "mean", "min", "max", "visits", "favorites", "up", "down"],
                  daily),
        "samples": (["universe_id", "ts", "playing", "visits"], samples),
        "state": (["key", "value"], state),
    }, {"horror": horror_n, "tracked": len(recent & {g[0] for g in games}), "last_day": last_day}


# ─── Subida ───────────────────────────────────────────────────────────────────
def post(url, token, path, body, retries=5):
    data = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    for attempt in range(retries):
        req = urllib.request.Request(f"{url}{path}", data=data, method="POST", headers={
            "authorization": f"Bearer {token}", "content-type": "application/json",
            "user-agent": "roblox-tracker-migrate/1.0",
        })
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "replace")[:300]
            if e.code < 500 and e.code != 429:
                raise SystemExit(f"✗ {path}: HTTP {e.code} {msg}")
            print(f"  … HTTP {e.code} {msg} (reintento {attempt + 1})", file=sys.stderr)
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"  … {e} (reintento {attempt + 1})", file=sys.stderr)
        time.sleep(2 ** attempt)
    raise SystemExit(f"✗ {path}: sin respuesta")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", help="URL del Worker (p. ej. https://roblox-tracker.<cuenta>.workers.dev)")
    ap.add_argument("--token", default=os.environ.get("ADMIN_TOKEN"))
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--ref", default=None, help="rama/commit de git (por defecto origin/main)")
    g.add_argument("--dir", help="carpeta que contiene data/ (en vez de git)")
    ap.add_argument("--now", help="instante 'ahora' en ISO (por defecto, ahora)")
    ap.add_argument("--batch", type=int, default=1000, help="filas por petición")
    ap.add_argument("--only", help="tablas a subir, separadas por comas")
    ap.add_argument("--dry-run", action="store_true", help="solo cuenta filas, no sube nada")
    args = ap.parse_args()

    now = (datetime.fromisoformat(args.now.replace("Z", "+00:00")) if args.now
           else datetime.now(timezone.utc))
    src = Source(root=args.dir) if args.dir else Source(ref=args.ref or "origin/main")
    tables, info = build(src, now)
    print(f"▶ Migración ({'git ' + src.ref if src.ref else src.root}) · ahora {now:%Y-%m-%dT%H:%MZ}")
    for t, (_, rows) in tables.items():
        print(f"  {t:8s} {len(rows):>7,} filas")
    print(f"  horror: {info['horror']} · con muestras en 48 h (tracked): {info['tracked']} · último día: {info['last_day']}")
    if args.dry_run:
        return
    if not args.url or not args.token:
        raise SystemExit("✗ Faltan --url y/o --token (o ADMIN_TOKEN)")
    url = args.url.rstrip("/")
    only = set(args.only.split(",")) if args.only else None

    total_written = 0
    for t, (cols, rows) in tables.items():
        if only and t not in only:
            continue
        written = 0
        for i in range(0, len(rows), args.batch):
            r = post(url, args.token, "/api/admin/import", {"table": t, "columns": cols, "rows": rows[i:i + args.batch]})
            written += r.get("written", 0)
        total_written += written
        print(f"  ✓ {t}: {len(rows):,} filas enviadas · {written:,} escritas")
    r = post(url, args.token, "/api/admin/rebuild", {})
    print(f"  ✓ rebuild: {r}")
    print(f"✓ Hecho. Filas escritas en D1: {total_written:,}")


if __name__ == "__main__":
    main()
