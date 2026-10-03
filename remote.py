"""
remote.py — Sincroniza la carpeta data/ con el bucket R2 de Cloudflare.

Los datos no viven en git: GitHub Actions los descarga al empezar, el
tracker trabaja con ficheros locales como siempre y al acabar se suben solo
los que han cambiado. También sube la web (dashboard.html y favicon.svg).

Todo pasa por el Worker (TRACKER_API), autenticado con TRACKER_TOKEN.

Uso:
  python remote.py pull     # R2 → data/
  python remote.py push     # data/ (+ web) → R2; borra las muestras intradía podadas
"""

import hashlib
import os
import sys
from pathlib import Path

import requests

from config import DATA, ROOT

API = os.environ.get("TRACKER_API", "https://roblox-tracker.stonksstudiouefn.workers.dev").rstrip("/")
TOKEN = os.environ.get("TRACKER_TOKEN", "")
SITE_FILES = {"site/dashboard.html": ROOT / "dashboard.html", "site/favicon.svg": ROOT / "favicon.svg"}

SESSION = requests.Session()


def call(method: str, path: str, **kw) -> requests.Response:
    if not TOKEN:
        sys.exit("✗ Falta TRACKER_TOKEN (secret de GitHub)")
    SESSION.headers["Authorization"] = f"Bearer {TOKEN}"
    for attempt in range(4):
        try:
            r = SESSION.request(method, f"{API}{path}", timeout=60, **kw)
            if r.status_code < 500:
                break
        except requests.RequestException:
            if attempt == 3:
                raise
    r.raise_for_status()
    return r


def remote_files(prefix: str) -> dict[str, str]:
    return {f["key"]: f["etag"] for f in call("GET", "/api/files", params={"prefix": prefix}).json()["files"]}


def md5(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def pull():
    files = remote_files("data/")
    for key in sorted(files):
        dest = ROOT / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(call("GET", f"/api/file/{key}").content)
    size = sum((ROOT / k).stat().st_size for k in files)
    print(f"✓ Descargados {len(files)} ficheros de R2 ({size / 1e6:.1f} MB)")


def push():
    if not (DATA / "games.json").exists():
        sys.exit("✗ data/games.json no existe: ¿has hecho pull antes?")
    remote = remote_files("")
    local = {p.relative_to(ROOT).as_posix(): p for p in DATA.rglob("*")
             if p.is_file() and not p.name.startswith(".")}
    local.update({k: p for k, p in SITE_FILES.items() if p.exists()})

    uploaded = 0
    for key, path in sorted(local.items()):
        if remote.get(key) != md5(path):
            call("PUT", f"/api/file/{key}", data=path.read_bytes())
            uploaded += 1
    # Lo único que se borra son las muestras intradía antiguas que el tracker
    # ya podó en local; nada más se borra nunca desde aquí.
    deleted = 0
    for key in sorted(remote):
        if key.startswith("data/raw/") and key not in local:
            call("DELETE", f"/api/file/{key}")
            deleted += 1
    print(f"✓ R2: {uploaded} ficheros subidos, {deleted} borrados, {len(local) - uploaded} sin cambios")


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action == "pull":
        pull()
    elif action == "push":
        push()
    else:
        sys.exit(__doc__)
