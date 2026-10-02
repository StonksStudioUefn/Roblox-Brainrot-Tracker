"""
analytics.py — Clasificación, métricas robustas, eventos y emergentes.

Ideas clave:
  · El valor de cada día es la MEDIANA de sus muestras, no una foto suelta.
  · Los días que se salen mucho de su entorno (eventos, updates con pico)
    se marcan y no cuentan para las medias ni las tendencias.
  · Las tendencias se calculan con la pendiente de Theil–Sen sobre el
    logaritmo, que es robusta: un día raro no la arrastra.
"""

import math
import re
import statistics
from datetime import date, datetime, timedelta

from config import EMERGING, EVENTS, HORROR, SCAN_START

# ─── Utilidades ────────────────────────────────────────────────────────────────
def parse_ts(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def pct(new, old):
    if new is None or not old:
        return None
    return round((new - old) * 100 / old, 1)


def clip(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


# ─── Títulos ───────────────────────────────────────────────────────────────────
EMOJI_RE = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF"
    "\U00002190-\U000021FF\U00002B00-\U00002BFF\U00003000-\U0000303F"
    "️‍⃣⌀-⏿]"
)
TAG_RE = re.compile(r"[\[\(【]([^\]\)】]{1,30})[\]\)】]")


def clean_title(name: str) -> tuple[str, list[str]]:
    """'[⚙️UPD 6] Anime Dice 🎲' → ('Anime Dice', ['UPD 6'])."""
    name = name or ""
    tags = []
    for m in TAG_RE.finditer(name):
        t = EMOJI_RE.sub("", m.group(1)).strip(" -|:!")
        if t:
            tags.append(t.upper() if len(t) <= 12 else t)
    title = TAG_RE.sub(" ", name)
    title = EMOJI_RE.sub(" ", title)
    title = re.sub(r"\s+", " ", title).strip(" -|:·•!")
    if not title:
        title = EMOJI_RE.sub("", name).strip() or name
    return title, tags[:3]


# ─── Clasificación de horror ───────────────────────────────────────────────────
def _kw_regex(words):
    # Inicio de palabra obligatorio; el final puede seguir (monster → monsters)
    return [(w, re.compile(r"(?<![a-z0-9])" + re.escape(w))) for w in words]


_H = {k: _kw_regex(HORROR[k])
      for k in ("name_strong", "name_weak", "name_negative", "desc_strong", "desc_weak")}


def horror_score(g: dict, uid: int) -> tuple[int, list[str]]:
    if uid in HORROR["force_include"]:
        return 99, ["incluido a mano"]
    if uid in HORROR["force_exclude"]:
        return -99, ["excluido a mano"]
    pts = HORROR["points"]
    title, tags = clean_title(g.get("name") or "")
    name = title.lower()
    desc = (g.get("description") or "").lower()
    score, reasons = 0, []

    def first(key, text):
        return next((w for w, rx in _H[key] if rx.search(text)), None)

    tag = next((t for t in tags if t.lower() in HORROR["tags"]), None)
    hit = first("name_strong", name)
    if hit or tag:
        score += pts["name_strong"]
        reasons.append(f"nombre: {hit or tag.lower()}")
    if w := first("name_weak", name):
        score += pts["name_weak"]
        reasons.append(f"nombre: {w}")
    if w := first("name_negative", name):
        score += pts["name_negative"]
        reasons.append(f"resta: {w}")

    legacy = HORROR["legacy_genres"].get(g.get("genre"))
    if legacy:
        score += legacy
        reasons.append(f"género del creador: {g['genre']}")
    genre = f"{g.get('genre_l1') or ''}/{g.get('genre_l2') or ''}"
    if genre in HORROR["genres"]:
        score += HORROR["genres"][genre]
        reasons.append(f"género: {genre.rstrip('/')}")

    ds = [w for w, rx in _H["desc_strong"] if rx.search(desc)]
    if ds:
        score += min(len(ds) * pts["desc_strong"], pts["desc_strong_cap"])
        reasons.append("descripción: " + ", ".join(ds[:3]))
    dw = [w for w, rx in _H["desc_weak"] if rx.search(desc)]
    if dw:
        score += min(len(dw) * pts["desc_weak"], pts["desc_weak_cap"])
        if not ds:
            reasons.append("descripción: " + ", ".join(dw[:2]))
    return score, reasons


def is_horror(g: dict, uid: int) -> tuple[bool, int, list[str]]:
    """Horror = llega al umbral Y tiene al menos una señal fuerte.

    Así un juego de "escapar" genérico (género Escape + palabra "escape")
    no entra solo por señales débiles.
    """
    s, r = horror_score(g, uid)
    return s >= HORROR["threshold"] and _has_strong(g, uid), s, r


def _has_strong(g: dict, uid: int) -> bool:
    if uid in HORROR["force_include"]:
        return True
    title, tags = clean_title(g.get("name") or "")
    name, desc = title.lower(), (g.get("description") or "").lower()
    return bool(
        any(rx.search(name) for _, rx in _H["name_strong"])
        or any(t.lower() in HORROR["tags"] for t in tags)
        or any(rx.search(desc) for _, rx in _H["desc_strong"])
        or HORROR["legacy_genres"].get(g.get("genre"))
    )


# ─── Series y eventos ──────────────────────────────────────────────────────────
def flag_events(values: list[float], dates: list[str]) -> list[bool]:
    """Marca días de evento: picos que se salen de su entorno y luego bajan.

    · Se compara con los días de antes Y con los de después: si el salto se
      mantiene es crecimiento real, no un evento (clave para los emergentes).
    · No cuenta si se explica por el día de la semana (los sábados siempre hay
      más gente): se compara con el mismo día de las semanas anteriores.
    · El último día no se marca (aún no se sabe si se mantiene); para eso está
      el aviso de "pico ahora".
    """
    w = EVENTS["window_days"] // 2
    by_date = dict(zip(dates, values))
    flags = []
    for i, v in enumerate(values):
        before, after = values[max(0, i - w):i], values[i + 1:i + 1 + w]
        if len(before) < 2 or not after:
            flags.append(False)
            continue
        base = max(statistics.median(before), statistics.median(after))
        neigh = before + after
        m = statistics.median(neigh)
        mad = max(statistics.median(abs(x - m) for x in neigh) * 1.4826, m * 0.05)
        is_out = v > base * EVENTS["min_ratio"] and (v - base) > EVENTS["mad_k"] * mad
        if is_out:
            d = date.fromisoformat(dates[i])
            same_wd = [by_date.get((d - timedelta(days=k)).isoformat()) for k in (7, 14)]
            same_wd = [x for x in same_wd if x]
            if same_wd and v < max(same_wd) * EVENTS["min_ratio"]:
                is_out = False
        flags.append(is_out)
    return flags


def theil_sen_daily_growth(values: list[float]) -> float | None:
    """Crecimiento diario típico (%), robusto a valores sueltos."""
    pts = [(i, math.log(v)) for i, v in enumerate(values) if v and v > 0]
    if len(pts) < 4:
        return None
    slopes = [(y2 - y1) / (x2 - x1)
              for k, (x1, y1) in enumerate(pts) for (x2, y2) in pts[k + 1:] if x2 != x1]
    return round((math.exp(statistics.median(slopes)) - 1) * 100, 1)


def window_median(samples: list[tuple[datetime, int]], start: datetime, end: datetime):
    vals = [p for t, p in samples if start <= t < end]
    return (statistics.median(vals), len(vals)) if vals else (None, 0)


# ─── Métricas por juego ────────────────────────────────────────────────────────
def game_metrics(daily: list[dict], raw: list[dict], meta: dict, now: datetime) -> dict:
    """`daily`: filas del juego ordenadas por fecha. `raw`: muestras recientes."""
    samples = sorted((parse_ts(r["ts"]), r["playing"]) for r in raw)
    samples = [s for s in samples if s[0]]
    values = [d["median"] for d in daily]
    events = flag_events(values, [d["date"] for d in daily])
    clean = [v for v, e in zip(values, events) if not e]

    last_ts, now_players = (samples[-1] if samples else (None, values[-1] if values else 0))
    ref = last_ts or now

    # Jugadores típicos: mediana de las últimas 24h (o del último día)
    typical, n24 = window_median(samples, ref - timedelta(hours=24), ref + timedelta(minutes=1))
    if n24 < 2:
        typical = values[-1] if values else now_players
    prev, nprev = window_median(samples, ref - timedelta(hours=48), ref - timedelta(hours=24))
    if nprev < 2:
        prev = None
        # sin muestras intradía de ayer: usa el último día "limpio" anterior
        for v, e in zip(reversed(values[:-1]), reversed(events[:-1])):
            if not e:
                prev = v
                break
    growth_24h = pct(typical, prev)

    last7 = [v for v, e in zip(values[-7:], events[-7:]) if not e]
    avg_7d = round(statistics.fmean(last7)) if last7 else typical
    recent3 = [v for v, e in zip(values[-3:], events[-3:]) if not e]
    week_ago = [v for v, e in zip(values[-10:-6], events[-10:-6]) if not e]
    growth_7d = (pct(statistics.fmean(recent3), statistics.fmean(week_ago))
                 if recent3 and week_ago else None)
    trend = theil_sen_daily_growth([v for v, e in zip(values[-8:], events[-8:]) if not e])

    base7 = statistics.median(clean[-8:-1]) if len(clean) >= 4 else None
    spike_now = bool(base7 and now_players >= base7 * EVENTS["spike_now_ratio"])

    peak_i = max(range(len(daily)), key=lambda i: daily[i]["max"]) if daily else None

    # Visitas: actuales y ganadas en el último día
    visits = next((d["visits"] for d in reversed(daily) if d["visits"]), None)
    visits_day = None
    vs = [(parse_ts(r["ts"]), r["visits"]) for r in raw if r["visits"]]
    vs = sorted(v for v in vs if v[0])
    if vs:
        t1, v1 = vs[-1]
        older = [(t, v) for t, v in vs if t <= t1 - timedelta(hours=20)]
        if older:
            t0, v0 = older[-1]
            visits_day = round((v1 - v0) * 86400 / max((t1 - t0).total_seconds(), 1))
    if visits_day is None:
        vd = [d for d in daily if d["visits"]]
        if len(vd) >= 2:
            d1, d0 = vd[-1], vd[-2]
            gap = (date.fromisoformat(d1["date"]) - date.fromisoformat(d0["date"])).days or 1
            visits_day = round((d1["visits"] - d0["visits"]) / gap)
    if visits_day is not None and visits_day < 0:
        visits_day = None

    last = daily[-1] if daily else {}
    fav = next((d["favorites"] for d in reversed(daily) if d["favorites"]), None)
    up = next((d["up"] for d in reversed(daily) if d["up"] is not None), None)
    down = next((d["down"] for d in reversed(daily) if d["down"] is not None), None)
    like_ratio = round(up * 100 / (up + down), 1) if up is not None and down is not None and up + down > 0 else None

    created = parse_ts(meta.get("created"))
    updated = parse_ts(meta.get("updated"))
    first_seen = parse_ts(meta.get("first_seen"))
    first_day = date.fromisoformat(daily[0]["date"]) if daily else None
    seen = min(filter(None, [first_day, first_seen.date() if first_seen else None]), default=None)
    first_seen_days = (now.date() - seen).days if seen else None
    # Antes de SCAN_START+2 días todo el catálogo es "nuevo" para el tracker,
    # así que no se marca nada como recién detectado
    trusted = seen is not None and seen >= date.fromisoformat(SCAN_START) + timedelta(days=2)
    return {
        "players": now_players,
        "players_ts": last_ts.isoformat() if last_ts else None,
        "typical": round(typical) if typical is not None else None,
        "avg_7d": avg_7d,
        "growth_24h": growth_24h,
        "growth_7d": growth_7d,
        "trend": trend,
        "spike_now": spike_now,
        "event_days": sum(events[-30:]),
        "peak": daily[peak_i]["max"] if peak_i is not None else now_players,
        "peak_date": daily[peak_i]["date"] if peak_i is not None else None,
        "visits": visits,
        "visits_day": visits_day,
        "visits_growth": round(visits_day * 100 / visits, 2) if visits and visits_day else None,
        "favorites": fav,
        "like_ratio": like_ratio,
        "votes": (up or 0) + (down or 0) if up is not None else None,
        "age_days": (now - created).days if created else None,
        "updated_days": round((now - updated).total_seconds() / 86400, 1) if updated else None,
        "first_seen_days": first_seen_days,
        "fresh": bool(trusted and first_seen_days <= 3),
        "new_week": bool(trusted and first_seen_days <= 7),
        "days_tracked": len(daily),
        "samples_today": last.get("n", 0) if last.get("date") == now.date().isoformat() else 0,
        "_events": events,
    }


# ─── Estado y puntuaciones ─────────────────────────────────────────────────────
def status(m: dict) -> str:
    """Combina el cambio de 24 h con la tendencia de varios días: si se
    contradicen, manda la tendencia (más difícil de engañar con un pico)."""
    g, t = m["growth_24h"], m["trend"]
    if g is None and t is None:
        return "new"
    g = g or 0
    if t is not None and t >= 15 or g >= 30 and (t is None or t >= 0):
        return "hot"
    if t is not None and t >= 5 or g >= 10 and (t is None or t >= -1):
        return "up"
    if t is not None and t <= -8 or g <= -20 and (t is None or t <= 0):
        return "down2"
    if t is not None and t <= -3 or g <= -7 and (t is None or t <= 1):
        return "down"
    return "flat"


def momentum_score(m: dict) -> int:
    """0-100: crecimiento sostenido (no picos sueltos) ponderado por tamaño."""
    t = m["trend"] or 0
    g24 = m["growth_24h"] or 0
    g7 = m["growth_7d"] or 0
    size = clip(math.log10(max(m["typical"] or 1, 1) / 300) / math.log10(1_000_000 / 300))
    s = (35 * clip(t / 20) + 25 * clip(g24 / 50) + 20 * clip(g7 / 100) + 20 * size)
    if m["spike_now"] and t < 5:
        s *= 0.7   # sube solo por un evento: cuenta menos
    return round(s)


def emerging(m: dict) -> tuple[int, list[str]] | None:
    """Devuelve (puntuación, motivos) si el juego cumple los requisitos."""
    cfg = EMERGING
    visits, typical = m["visits"], m["typical"] or 0
    if visits is None or visits > cfg["max_visits"] or typical < cfg["min_players"]:
        return None
    t, g24, g7 = m["trend"], m["growth_24h"], m["growth_7d"]
    growing = any(x is not None and x > 0 for x in (t, g24, g7))
    fresh = m["fresh"]
    if not growing and not fresh:
        return None
    if m["status"] in ("down", "down2"):
        return None

    reasons = []
    vg = m["visits_growth"] or 0
    s_visits = 30 * clip(vg / 12)
    if vg >= 3:
        reasons.append(f"visitas +{vg:.0f}%/día")

    growth = max(t or 0, (g24 or 0) / 2, (g7 or 0) / 5)
    s_growth = 25 * clip(growth / 20)
    if t and t >= 5:
        reasons.append(f"tendencia +{t:.0f}%/día")
    elif g24 and g24 >= 15:
        reasons.append(f"+{g24:.0f}% en 24h")

    age = m["age_days"]
    s_young = 20 * clip(1 - age / cfg["max_age_days"]) if age is not None else 0
    if age is not None and age <= 30:
        reasons.append(f"creado hace {age} días")
    if fresh:
        s_young = max(s_young, 8)
        reasons.append("recién detectado")

    s_size = 15 * clip(math.log10(typical / cfg["min_players"]) / math.log10(30))
    lr = m["like_ratio"]
    s_like = 10 * clip(((lr or 0) - 75) / 20)
    if lr and lr >= 90:
        reasons.append(f"{lr:.0f}% likes")
    if visits < 2_000_000:
        reasons.append("menos de 2M visitas")

    score = round(s_visits + s_growth + s_young + s_size + s_like)
    if m["spike_now"] and (t or 0) < 5:
        score = round(score * 0.8)
    if score < cfg["min_score"]:
        return None
    return score, reasons[:4]
