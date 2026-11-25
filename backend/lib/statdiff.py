"""Pair the text boxes read from two versions of the same card and list what changed.
Both cards share one layout, so boxes pair by position. Evidence only: nothing is written back."""

import re

WEAPON_ROW = ["Damage", "Accuracy", "Reload time", "Fire rate", "Magazine"]


def _num(t: str) -> bool:
    return bool(re.search(r"\d", t))


def _same(a: str, b: str) -> bool:
    """OCR spacing and the $ sign vary between reads of the same text."""
    n = lambda t: re.sub(r"[\s$|Il.,;:]", "", t).lower()  # noqa: E731
    return n(a) == n(b)


def _label(t: str) -> str:
    s = t.lower().replace(" ", "")
    if s.startswith("lvl"):
        return "Level"
    if "dps" in s:
        return "DPS"
    if "dmg/s" in s or "chance" in s:
        return "Elemental damage"
    if re.search(r"\d+cm$", s):
        return "Range"
    if re.fullmatch(r"[\d.]+/s", s):
        return "Fire rate"
    if re.fullmatch(r"[\d.]+%", s):
        return "Accuracy"
    if re.fullmatch(r"[\d.]+s", s):
        return "Reload time"
    if len(s) > 18:
        return "Card text"
    return "Stat" if _num(t) else "Text"


def _label_boxes(boxes: list[dict]) -> None:
    for b in boxes:
        b["label"] = _label(b["text"])
    # the icon stat row (5 boxes at one height) has unlabeled numbers: name them by column
    rows: dict[int, list[dict]] = {}
    for b in boxes:
        if _num(b["text"]):
            rows.setdefault(round(b["y"] * 40), []).append(b)
    for row in rows.values():
        if len(row) == 5:
            for name, b in zip(WEAPON_ROW, sorted(row, key=lambda b: b["x"])):
                b["label"] = name
    for b in boxes:
        if b["y"] > 0.85 and re.fullmatch(r"[\d,]+", b["text"].replace("$", "")):
            b["label"] = "Value"


def diff_cards(old: list[dict], new: list[dict]) -> list[dict]:
    _label_boxes(old)
    _label_boxes(new)
    used: set[int] = set()
    rows = []
    for o in old:
        best, bd = None, 0.06
        for i, n in enumerate(new):
            if i in used:
                continue
            d = abs(o["y"] - n["y"]) * 2 + abs(o["x"] - n["x"])
            if d < bd:
                best, bd = i, d
        n = new[best] if best is not None else None
        if best is not None:
            used.add(best)
        changed = n is None or not _same(n["text"], o["text"])
        if (not _num(o["text"]) and not changed) or (n is None and len(o["text"]) <= 1):
            continue  # unchanged description text and stray icon glyphs are noise
        rows.append({"label": o["label"], "old": o["text"], "new": n["text"] if n else "", "changed": changed,
                     "box_old": [o["x"], o["y"], o["w"], o["h"]], "box_new": [n["x"], n["y"], n["w"], n["h"]] if n else None,
                     "y": o["y"]})
    for i, n in enumerate(new):
        if i not in used and len(n["text"]) > 1:
            rows.append({"label": n["label"], "old": "", "new": n["text"], "changed": True, "box_old": None,
                         "box_new": [n["x"], n["y"], n["w"], n["h"]], "y": n["y"]})
    rows.sort(key=lambda r: r["y"])
    for r in rows:
        r.pop("y")
    return rows
