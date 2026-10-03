"""Referencia en Python para horror.parity.mjs.

Lee de stdin una lista JSON de juegos {id, name, description, genre, genre_l1,
genre_l2} y escribe en stdout, por juego, lo que dicen analytics.is_horror y
analytics.clean_title (los de producción).
"""
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
