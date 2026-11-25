"""Free, local OCR (RapidOCR / ONNX) for card verification. OCR only produces evidence:
it never changes manifest serials, itemKeys, names or levels."""

import io
import re
import threading
from difflib import SequenceMatcher

import numpy as np
from PIL import Image

_engine = None
_lock = threading.Lock()

REQUIRED_LEVEL = 70
MIN_CONFIDENT = 0.75


def _get_engine():
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR
        _engine = RapidOCR(intra_op_num_threads=4, inter_op_num_threads=1)  # leave CPU for the app
    return _engine


def _rec(img: Image.Image) -> tuple[str, float]:
    res, _ = _get_engine()(np.array(img), use_det=False, use_cls=False)
    if not res:
        return "", 0.0
    text, score = res[0][0], float(res[0][1])
    return text.strip(), score


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower().replace("&", ""))


def classify_level(level: int | None, conf: float) -> str:
    if level is None:
        return "unreadable"
    if level == REQUIRED_LEVEL:
        return "confirmed_70"
    if 50 <= level < REQUIRED_LEVEL and conf >= MIN_CONFIDENT:
        return "outdated"
    return "possible_misread"


def analyze_card(data: bytes, manifest_name: str) -> dict:
    """Read the level box (top-right) and title lines (top-left) of a BL4 card."""
    with _lock:  # one inference at a time; the engine is not thread-safe
        im = Image.open(io.BytesIO(data)).convert("RGB")
        w, _ = im.size
        crop = im.crop((int(w * 0.78), 4, w - 8, 46))
        level_text, level_conf = _rec(crop)
        line1, _ = _rec(im.crop((16, 2, int(w * 0.74), 36)))
        line2, _ = _rec(im.crop((16, 30, int(w * 0.74), 62)))

    digits = re.findall(r"\d+", level_text.replace("O", "0").replace("o", "0"))
    two = [d for d in digits if len(d) == 2]
    level = int(two[-1]) if two else (int(digits[-1][-2:]) if digits and len(digits[-1]) >= 2 else None)

    target = _norm(manifest_name)
    score = None
    if target:
        a, b = _norm(line1), _norm(line1 + line2)
        score = max(SequenceMatcher(None, target, a).ratio(), SequenceMatcher(None, target, b[: len(target) + 2]).ratio())

    buf = io.BytesIO()
    crop.save(buf, "WEBP", quality=85)
    return {
        "ocr_level": level,
        "ocr_level_text": level_text,
        "ocr_level_conf": round(level_conf, 3),
        "ocr_name_text": " / ".join(t for t in (line1, line2) if t),
        "ocr_name_score": round(score, 3) if score is not None else None,
        "level_status": classify_level(level, level_conf),
        "crop": buf.getvalue(),
    }


def read_card_text(data: bytes) -> list[dict]:
    """Full-card text read for the compare view: [{text, conf, x, y, w, h}] in 0..1 card coordinates."""
    with _lock:
        im = Image.open(io.BytesIO(data)).convert("RGB")
        W, H = im.size
        res, _ = _get_engine()(np.array(im))
    out = []
    for box, text, score in res or []:
        xs, ys = [p[0] for p in box], [p[1] for p in box]
        out.append({"text": text.strip(), "conf": round(float(score), 3), "x": min(xs) / W, "y": min(ys) / H,
                    "w": (max(xs) - min(xs)) / W, "h": (max(ys) - min(ys)) / H})
    return out
