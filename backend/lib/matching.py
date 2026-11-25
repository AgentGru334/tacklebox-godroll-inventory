"""Card export ZIP parsing + exact-serial matching against the God Roll catalog.

Matching key is the item serial ONLY (surrounding whitespace trimmed, case-sensitive).
Display names and filenames are never used to match; a name that disagrees is flagged.
Card filenames follow "<item-name-slug>-item_<imagecode>.webp"; the slug and image code
are parsed and kept on each record for organising/linking, not for matching.
"""

import hashlib
import io
import json
import posixpath
import re
import zipfile

REQUIRED_LEVEL = 70
REQUIRED_SOURCE = "NCS Lookup"
MAX_UNCOMPRESSED = 2 * 1024 * 1024 * 1024

REASON_LABELS = {
    "serial_missing": "No serial in manifest",
    "serial_not_in_catalog": "Serial not in catalog",
    "duplicate_serial": "Duplicate serial in manifest",
    "file_missing": "Card file missing from ZIP",
    "invalid_image": "File is not a WebP image",
    "level_mismatch": "Level is not 70",
    "source_mismatch": "Source is not NCS Lookup",
    "name_mismatch": "Name differs from catalog",
    "checksum_mismatch": "File checksum does not match manifest",
    "duplicate_image": "Same image file used by another record",
    "item_key_mismatch": "itemKey differs from catalog record",
    "item_key_only": "itemKey matches but serial differs",
    "filename_key_mismatch": "Filename code differs from itemKey",
    "level_conflict": "OCR level conflicts with level 70",
}

# Non-blocking evidence shown in review/reports; never changes validated data.
FLAG_LABELS = {
    "ocr_name_conflict": "OCR name differs",
    "filename_name_mismatch": "Filename name differs",
    "level_unreadable": "Level unreadable",
}

# Accepted manifest key spellings (first non-empty wins).
SERIAL_KEYS = ("serial", "item_serial", "itemSerial", "serial_code", "serialCode")
NAME_KEYS = ("name", "item_name", "itemName", "display_name", "displayName", "title")
FILE_KEYS = ("file", "image", "filename", "image_file", "imageFile", "card", "card_file", "path")
LEVEL_KEYS = ("level", "item_level", "itemLevel", "lvl")
SOURCE_KEYS = ("source", "card_source", "generator")
META_KEYS = ("rarity", "manufacturer", "item_type", "type", "category", "prefix")

FILENAME_RE = re.compile(r"^(?P<slug>.+?)-item_(?P<code>[0-9A-Za-z]+)\.webp$", re.IGNORECASE)


class PackageError(Exception):
    pass


def is_webp(data: bytes) -> bool:
    return len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP"


def parse_card_filename(ref: str) -> tuple[str, str]:
    """'atomic-artillery-sphere-item_15bb…f2.webp' -> ('atomic-artillery-sphere', '15bb…f2')."""
    m = FILENAME_RE.match(posixpath.basename(ref or ""))
    return (m.group("slug"), m.group("code")) if m else ("", "")


def split_filename(ref: str) -> dict:
    """'images/atomic-artillery-sphere-item_15bb.webp' -> prefix 'atomic', item name 'artillery sphere',
    code '15bb', extension 'webp'. Prefix = first word of the name slug (BL4 roll prefix)."""
    base = posixpath.basename(ref or "")
    ext = base.rsplit(".", 1)[-1].lower() if "." in base else ""
    slug, code = parse_card_filename(base)
    words = slug.split("-") if slug else []
    return {"file_slug": slug, "image_code": code, "file_ext": ext,
            "file_prefix": words[0] if words else "",
            "file_item_name": " ".join(words[1:]) if len(words) > 1 else " ".join(words)}


def slugify(name: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", name.lower())).strip("-")


def _pick(card: dict, keys: tuple[str, ...]):
    for k in keys:
        v = card.get(k)
        if v not in (None, ""):
            return v
    return None


def read_card_zip(data: bytes) -> tuple[list[dict], dict[str, bytes], dict, list[dict]]:
    """Return (card records, {relative path: bytes}, manifest-level defaults, image-less records)."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise PackageError("This file is not a valid ZIP archive.")
    infos = [i for i in zf.infolist() if not i.is_dir() and "__MACOSX" not in i.filename]
    if sum(i.file_size for i in infos) > MAX_UNCOMPRESSED:
        raise PackageError("ZIP is too large once extracted (limit 2 GB).")
    manifests = sorted((i.filename for i in infos if posixpath.basename(i.filename) == "manifest.json"), key=len)
    if not manifests:
        raise PackageError("ZIP has no manifest.json.")
    manifest_path = manifests[0]
    prefix = manifest_path[: -len("manifest.json")]
    try:
        manifest = json.loads(zf.read(manifest_path).decode("utf-8-sig"))
    except (ValueError, UnicodeDecodeError):
        raise PackageError("manifest.json is not valid JSON.")
    defaults: dict = {}
    missing: list = []
    if isinstance(manifest, dict):
        cards = next((manifest[k] for k in ("present", "cards", "items", "records", "images") if isinstance(manifest.get(k), list)), None)
        missing = manifest.get("missing") if isinstance(manifest.get("missing"), list) else []
        defaults = {"level": _pick(manifest, LEVEL_KEYS), "source": _pick(manifest, SOURCE_KEYS)}
    else:
        cards = manifest
    if not isinstance(cards, list):
        raise PackageError('manifest.json must contain a "cards" list.')
    files: dict[str, bytes] = {}
    for info in infos:
        name = info.filename
        if name == manifest_path or not name.lower().endswith(".webp"):
            continue
        rel = name[len(prefix):] if prefix and name.startswith(prefix) else name
        files[rel] = zf.read(info)
    return ([c if isinstance(c, dict) else {} for c in cards], files, defaults,
            [m for m in missing if isinstance(m, dict)])


def _as_int(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def build_matches(cards: list[dict], files: dict[str, bytes], catalog_by_serial: dict[str, dict],
                  defaults: dict | None = None, catalog_by_key: dict[str, dict] | None = None,
                  allow_new: bool = False):
    """Return a list of (match_fields, image_bytes_or_None). Identity = validated serial + itemKey."""
    defaults = defaults or {}
    catalog_by_key = catalog_by_key or {}
    by_base: dict[str, list[str]] = {}
    for k in files:
        by_base.setdefault(posixpath.basename(k), []).append(k)

    def find(ref: str) -> bytes | None:
        if not ref:
            return None
        ref = ref.lstrip("./")
        if ref in files:
            return files[ref]
        hits = by_base.get(posixpath.basename(ref), [])
        return files[hits[0]] if len(hits) == 1 else None

    serials = [str(_pick(c, SERIAL_KEYS) or "").strip() for c in cards]
    counts: dict[str, int] = {}
    for s in serials:
        if s:
            counts[s] = counts.get(s, 0) + 1
    images = [find(str(_pick(c, FILE_KEYS) or "").strip()) for c in cards]
    digests = [hashlib.sha256(img).hexdigest() if img is not None else "" for img in images]
    digest_counts: dict[str, int] = {}
    for d in digests:
        if d:
            digest_counts[d] = digest_counts.get(d, 0) + 1

    out = []
    for index, (card, serial) in enumerate(zip(cards, serials)):
        reasons: list[str] = []
        flags: list[str] = []
        file_ref = str(_pick(card, FILE_KEYS) or "").strip()
        manifest_name = str(_pick(card, NAME_KEYS) or "").strip()
        # Level/source are checked only when the export states them; a validated NCS Lookup
        # export that carries neither is taken as the regenerated level 70 source of truth.
        lvl = _pick(card, LEVEL_KEYS)
        lvl = lvl if lvl is not None else defaults.get("level")
        level = _as_int(lvl) if lvl is not None else REQUIRED_LEVEL
        stated_source = _pick(card, SOURCE_KEYS) or defaults.get("source")
        source = str(stated_source).strip() if stated_source else REQUIRED_SOURCE
        item_key = str(card.get("itemKey") or card.get("item_key") or "").strip()
        parts = split_filename(file_ref)

        item = catalog_by_serial.get(serial) if serial else None
        key_item = catalog_by_key.get(item_key) if item_key else None
        change = "unmatched"
        if not serial:
            reasons.append("serial_missing")
        elif item is not None:
            change = "replacement" if item.get("card_state") == "card" else "fill"
            if item_key and item.get("item_key") and item["item_key"] != item_key:
                reasons.append("item_key_mismatch")
        elif key_item is not None:
            item = key_item  # same itemKey, different serial: hold for a human decision
            change = "replacement" if item.get("card_state") == "card" else "fill"
            reasons.append("item_key_only")
        elif allow_new:
            change = "new"
        else:
            reasons.append("serial_not_in_catalog")
        if serial and counts.get(serial, 0) > 1:
            reasons.append("duplicate_serial")
        if item_key and parts["image_code"] and item_key.replace("item_", "") != parts["image_code"]:
            reasons.append("filename_key_mismatch")

        image = images[index]
        sha = digests[index]
        if image is None:
            reasons.append("file_missing")
        elif not is_webp(image):
            reasons.append("invalid_image")
            image = None
        elif card.get("sha256") and sha != str(card["sha256"]).lower():
            reasons.append("checksum_mismatch")
        elif card.get("byteSize") and int(card["byteSize"]) != len(image):
            reasons.append("checksum_mismatch")
        if sha and digest_counts.get(sha, 0) > 1:
            reasons.append("duplicate_image")

        if level != REQUIRED_LEVEL:
            reasons.append("level_mismatch")
        if source != REQUIRED_SOURCE:
            reasons.append("source_mismatch")
        if item and manifest_name and manifest_name.casefold() != item["name"].casefold():
            reasons.append("name_mismatch")
        if manifest_name and parts["file_slug"] and slugify(manifest_name) != parts["file_slug"]:
            flags.append("filename_name_mismatch")

        status = "exception" if reasons else "clean"
        out.append(({
            "index": index, "serial": serial, "file": file_ref, **parts, "item_key": item_key, "sha256": sha,
            "manifest_name": manifest_name, "level": level, "source": source,
            "catalog_item_id": item["id"] if item else None,
            "catalog_name": item["name"] if item else (manifest_name if change == "new" else ""),
            "rarity": item.get("rarity", "") if item else "",
            "manufacturer": item.get("manufacturer", "") if item else "",
            "item_type": item.get("item_type", "") if item else "",
            "previous_card_state": item.get("card_state") if item else None,
            "change": change, "status": status, "reasons": reasons, "flags": flags,
            "decision": "auto_approved" if status == "clean" else "pending",
            "ocr_status": "pending", "level_status": "pending",
        }, image))
    return out


def catalog_records_from_manifest(cards: list[dict], files: dict[str, bytes], defaults: dict) -> list[dict]:
    """One catalog record per distinct manifest serial (first occurrence). Duplicate names stay separate."""
    seen: set[str] = set()
    out = []
    for card in cards:
        serial = str(_pick(card, SERIAL_KEYS) or "").strip()
        if not serial or serial in seen:
            continue
        seen.add(serial)
        file_ref = str(_pick(card, FILE_KEYS) or "").strip()
        slug, _ = parse_card_filename(file_ref)
        name = str(_pick(card, NAME_KEYS) or "").strip() or slug.replace("-", " ").title() or serial
        lvl = _pick(card, LEVEL_KEYS)
        out.append({
            "serial": serial, "name": name, "item_key": str(card.get("itemKey") or card.get("item_key") or ""),
            "rarity": str(card.get("rarity") or ""), "manufacturer": str(card.get("manufacturer") or ""),
            "item_type": str(card.get("item_type") or card.get("type") or card.get("category") or ""),
            "level": _as_int(lvl if lvl is not None else defaults.get("level")) or REQUIRED_LEVEL,
        })
    return out


def image_less_records(missing: list[dict]) -> list[dict]:
    """Manifest `missing` entries: validated serials with no card image yet."""
    out, seen = [], set()
    for rec in missing:
        serial = str(_pick(rec, SERIAL_KEYS) or "").strip()
        if not serial or serial in seen:
            continue
        seen.add(serial)
        key = str(rec.get("itemKey") or rec.get("item_key") or "")
        name = str(_pick(rec, NAME_KEYS) or "").strip() or f"Unnamed item {key.replace('item_', '')[:8]}".strip()
        out.append({"serial": serial, "name": name, "item_key": key, "rarity": "", "manufacturer": "",
                    "item_type": "", "level": REQUIRED_LEVEL, "has_image": False})
    return out


def can_approve(match: dict) -> bool:
    """An exception can be approved only if it still points at one catalog item and a real image."""
    blocking = {"serial_missing", "serial_not_in_catalog", "file_missing", "invalid_image", "checksum_mismatch",
                "duplicate_image", "level_conflict"}
    return not (set(match["reasons"]) & blocking)
