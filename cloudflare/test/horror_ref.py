"""analytics.is_horror y clean_title (los de producción) de los juegos JSON de stdin, para horror.parity.mjs."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import analytics as an  # noqa: E402

games = json.load(sys.stdin)
out = []
for g in games:
    horror, score, reasons = an.is_horror(g, g["id"])
    title, tags = an.clean_title(g.get("name") or "")
    out.append({"id": g["id"], "horror": horror, "score": score, "reasons": reasons,
                "title": title, "tags": tags})
json.dump(out, sys.stdout, ensure_ascii=False)
