"""Referencia en Python para telegram.test.mjs: ejecuta notifier.main() (el de
producción) con un `now` fijo, un dashboard y un estado dados, y sin enviar nada.

  python notifier_ref.py --now 2026-10-03T19:00:00Z --dashboard d.json --state s.json -- --dry-run --daily

Lo que va detrás de `--` son los argumentos de notifier.py. Las credenciales de
Telegram se quitan del entorno: sin ellas notifier.send() solo imprime (y, sin
--dry-run, cuenta como enviado y guarda el estado, como en producción).
El estado se copia a un fichero temporal: nunca se toca data/state.json.

Salida (JSON): {"stdout": "...", "messages": [[texto, game_id], ...], "state": {...}}
"""
import argparse
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.pop("TELEGRAM_TOKEN", None)
os.environ.pop("TELEGRAM_CHAT_ID", None)

import notifier  # noqa: E402


def main():
    argv = sys.argv[1:]
    rest = argv[argv.index("--") + 1:] if "--" in argv else []
    own = argv[:argv.index("--")] if "--" in argv else argv
    ap = argparse.ArgumentParser()
    ap.add_argument("--now", required=True)
    ap.add_argument("--dashboard", required=True)
    ap.add_argument("--state")
    args = ap.parse_args(own)
    now = datetime.fromisoformat(args.now.replace("Z", "+00:00"))

    class FixedDT(datetime):
        @classmethod
        def now(cls, tz=None):
            return now

    tmp = Path(tempfile.mkdtemp())
    state = tmp / "state.json"
    if args.state:
        shutil.copy(args.state, state)
    notifier.datetime = FixedDT
    notifier.DASHBOARD_PATH = Path(args.dashboard)
    notifier.STATE_PATH = state

    messages = []
    orig_send = notifier.send

    def send(message, game_id, dry):
        messages.append([message, game_id])
        return orig_send(message, game_id, dry)

    notifier.send = send
    out = io.StringIO()
    sys.argv = ["notifier.py", *rest]
    with contextlib.redirect_stdout(out):
        notifier.main()
    st = json.loads(state.read_text(encoding="utf-8")) if state.exists() else None
    json.dump({"stdout": out.getvalue(), "messages": messages, "state": st}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
