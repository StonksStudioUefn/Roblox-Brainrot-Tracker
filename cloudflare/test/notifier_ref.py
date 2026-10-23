"""notifier.main() sin credenciales ni tocar data/state.json (estado en un temporal)."""
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
