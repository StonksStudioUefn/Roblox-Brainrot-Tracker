#!/usr/bin/env python3
"""
devserver.py — Servidor de pruebas del dashboard de Cloudflare, sin Worker.

  python cloudflare/test/devserver.py [--port 8767] [--now ISO] [--sorts FILE] [--export FILE]

  /                     cloudflare/public/dashboard.html
  /favicon.svg          favicon.svg del repo
  /config.js /metrics.js /horror.js   módulos de cloudflare/src/
  /api/export           export.json generado con make_export.py desde data/ (o --export)
  /api/history/:id      formato del contrato, desde data/ (HISTORY_DAYS / HISTORY_SAMPLE_DAYS)
  /api/live /api/thumbs /api/game/:id   proxy a las APIs públicas de Roblox (como worker.js)
"""

import argparse
import http.server
import json
import subprocess
import sys
import tempfile
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
CF = HERE.parent
ROOT = CF.parent
sys.path.insert(0, str(HERE))
import simdata  # noqa: E402

HISTORY_DAYS, HISTORY_SAMPLE_DAYS = 120, 7
S = requests.Session()


def rj(url):
    return S.get(url, timeout=20).json()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8767)
    ap.add_argument("--now")
    ap.add_argument("--sorts")
    ap.add_argument("--export")
    args = ap.parse_args()

    if args.export:
        export_path = Path(args.export)
    else:
        export_path = Path(tempfile.mkdtemp()) / "export.json"
        cmd = [sys.executable, str(HERE / "make_export.py"), "--out", str(export_path)]
        if args.now:
            cmd += ["--now", args.now]
        if args.sorts:
            cmd += ["--sorts", args.sorts]
        subprocess.run(cmd, check=True)
    export = json.loads(export_path.read_text(encoding="utf-8"))
    now = datetime.fromisoformat(export["generated_at"].replace("Z", "+00:00"))
    daily, raw = simdata.load(ROOT / "data", now)
    d_cut = (now.date() - timedelta(days=HISTORY_DAYS - 1)).isoformat()
    r_cut = (now - timedelta(days=HISTORY_SAMPLE_DAYS)).strftime("%Y-%m-%dT%H:%MZ")
    hist = {}
    for r in daily:
        if r["date"] >= d_cut:
            hist.setdefault(r["universe_id"], {"d": [], "r": []})["d"].append(
                [r["date"], r["median"], r["min"], r["max"], r["n"]])
    for s in sorted(raw, key=lambda s: s["ts"]):
        if s["ts"] >= r_cut and s["universe_id"] in hist:
            hist[s["universe_id"]]["r"].append([s["ts"], s["playing"]])
    print(f"export: {len(export['games'])} juegos · generated_at {export['generated_at']}", file=sys.stderr)

    files = {
        "/": (CF / "public/dashboard.html", "text/html; charset=utf-8"),
        "/favicon.svg": (ROOT / "favicon.svg", "image/svg+xml"),
        "/config.js": (CF / "src/config.js", "text/javascript; charset=utf-8"),
        "/metrics.js": (CF / "src/metrics.js", "text/javascript; charset=utf-8"),
        "/horror.js": (CF / "src/horror.js", "text/javascript; charset=utf-8"),
    }

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, fmt, *a):
            pass

        def send(self, body: bytes, ctype: str, status=200):
            self.send_response(status)
            self.send_header("content-type", ctype)
            self.send_header("cache-control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def send_json(self, d, status=200):
            self.send(json.dumps(d).encode(), "application/json", status)

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            q = urllib.parse.parse_qs(u.query)
            path = u.path
            try:
                if path in files:
                    f, ct = files[path]
                    return self.send(f.read_bytes(), ct)
                if path == "/api/export":
                    return self.send(export_path.read_bytes(), "application/json")
                if path.startswith("/api/history/"):
                    h = hist.get(int(path.split("/")[3]))
                    return self.send_json(h) if h else self.send_json({"error": "no encontrado"}, 404)
                ids = [i for i in (q.get("ids", [""])[0]).split(",") if i]
                if path == "/api/live":
                    out = {}
                    for i in range(0, len(ids), 50):
                        for g in rj("https://games.roblox.com/v1/games?universeIds=" + ",".join(ids[i:i + 50])).get("data", []):
                            out[str(g["id"])] = {"playing": g["playing"], "visits": g["visits"]}
                    for i in range(0, len(ids), 100):
                        for x in rj("https://thumbnails.roblox.com/v1/games/icons?size=150x150&format=Webp&universeIds="
                                    + ",".join(ids[i:i + 100])).get("data", []):
                            if x.get("state") == "Completed":
                                out.setdefault(str(x["targetId"]), {})["icon"] = x["imageUrl"]
                    return self.send_json({"ts": datetime.now(timezone.utc).isoformat(), "games": out})
                if path == "/api/thumbs":
                    d = rj("https://thumbnails.roblox.com/v1/games/multiget/thumbnails?countPerUniverse=1&size=768x432"
                           "&format=Webp&universeIds=" + ",".join(ids[:50]))
                    return self.send_json({str(t["universeId"]): t["thumbnails"][0]["imageUrl"]
                                           for t in d.get("data", []) if t.get("thumbnails")})
                if path.startswith("/api/game/"):
                    i = path.split("/")[3]
                    g = rj("https://games.roblox.com/v1/games?universeIds=" + i)["data"][0]
                    ic = rj("https://thumbnails.roblox.com/v1/games/icons?size=256x256&format=Webp&universeIds=" + i)["data"][0]
                    th = rj("https://thumbnails.roblox.com/v1/games/multiget/thumbnails?countPerUniverse=1&size=768x432"
                            "&format=Webp&universeIds=" + i)["data"][0]["thumbnails"]
                    return self.send_json({"id": g["id"], "description": g["description"], "playing": g["playing"],
                                           "icon": ic.get("imageUrl"), "thumb": th[0]["imageUrl"] if th else None})
                return self.send(b"No encontrado", "text/plain", 404)
            except Exception as e:  # noqa: BLE001
                return self.send_json({"error": str(e)}, 502)

    print(f"http://127.0.0.1:{args.port}/", file=sys.stderr)
    http.server.ThreadingHTTPServer(("127.0.0.1", args.port), H).serve_forever()


if __name__ == "__main__":
    main()
