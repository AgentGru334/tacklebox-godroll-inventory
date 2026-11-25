"""Catalog, dry-run card batches (+ resumable OCR analysis), review decisions, level-70 decisions,
apply-to-library (simulated direct upload), export package, admin queue, audit log + restore."""

import asyncio
import csv
import io
import json
import logging
import re
import uuid
import zipfile
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from pymongo import UpdateOne
from starlette.concurrency import run_in_threadpool

from lib import audit
from lib.db import db
from lib.sitelinks import auto_link_serials
from lib.matching import (FLAG_LABELS, REASON_LABELS, REQUIRED_LEVEL, REQUIRED_SOURCE, PackageError,
                          build_matches, can_approve, catalog_records_from_manifest, image_less_records,
                          read_card_zip)
from models.injector import (AuditEntry, Batch, CatalogEditIn, CatalogImportResult, CatalogItem, CatalogItemIn,
                             DecisionIn, DirectUploadIn, DirectUploadResult, ImportHistoryEntry, LevelDecisionIn,
                             Match, QueuePublishIn, QueuePublishResult, RollbackIn, RollbackResult, Stats,
                             ValidationReport, ValidationRow)
from routers.members import require_role

router = APIRouter()
any_member = require_role("admin", "reviewer")
admin_only = require_role("admin")
log = logging.getLogger("injector")

CONFIRM_PHRASE = "INJECT-CONFIRM"
MAX_ZIP_BYTES = 1536 * 1024 * 1024
_running: dict[str, asyncio.Task] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _who(member: dict) -> str:
    return member.get("email") or member["user_id"]


def _aware(doc: dict, *fields: str) -> dict:
    for f in fields:
        v = doc.get(f)
        if isinstance(v, datetime) and v.tzinfo is None:
            doc[f] = v.replace(tzinfo=timezone.utc)
    return doc


def _batch(doc: dict) -> Batch:
    return Batch(**_aware(doc, "created_at", "package_generated_at", "published_at", "rolled_back_at"))


def _match(doc: dict) -> Match:
    return Match(**_aware(doc, "decided_at", "level_decided_at"))


STALE_LEVELS = ("outdated", "possible_misread", "unreadable")


def _item(doc: dict) -> CatalogItem:
    """Stale flags are computed live: a card below/unverified at level 70, or no website link."""
    stale = []
    if doc.get("needs_level70_refresh") or (doc.get("card_state") == "card" and doc.get("level_status") in STALE_LEVELS):
        stale.append("below_70")
    if not doc.get("site_item_id"):
        stale.append("needs_link")
    return CatalogItem(**_aware(doc, "card_updated_at", "placeholder_published_at", "regen_status_at"), stale_reasons=stale)


def _new_catalog_doc(it: dict, card_state: str) -> dict:
    return {
        "id": str(uuid.uuid4()), "serial": it["serial"], "name": it.get("name") or it["serial"],
        "rarity": it.get("rarity") or "", "manufacturer": it.get("manufacturer") or "",
        "item_type": it.get("item_type") or "", "level": it.get("level") or REQUIRED_LEVEL,
        "item_key": it.get("item_key") or "", "card_state": card_state, "card_image_id": None,
        "card_updated_at": None, "placeholder_published_at": None, "level_status": None,
        "needs_level70_refresh": False, "site_item_id": None, "site_item_name": "", "site_link_method": None,
    }


async def _merge_catalog(items: list[dict]) -> set[str]:
    """Upsert by exact serial. New serials are inserted; existing records keep id + card state."""
    serials = [it["serial"] for it in items]
    existing = {d["serial"] for d in await db.catalog_items.find({"serial": {"$in": serials}}, {"_id": 0, "serial": 1}).to_list(None)}
    ops, created = [], set()
    for it in items:
        meta = {k: it.get(k) or "" for k in ("name", "rarity", "manufacturer", "item_type", "item_key")}
        meta["level"] = it.get("level") or REQUIRED_LEVEL
        if it["serial"] in existing:
            ops.append(UpdateOne({"serial": it["serial"]}, {"$set": {k: v for k, v in meta.items() if v}}))
        else:
            doc = _new_catalog_doc(it, "card" if it.get("has_image") else "missing")
            created.add(doc["id"])
            ops.append(UpdateOne({"serial": it["serial"]}, {"$setOnInsert": doc}, upsert=True))
    for i in range(0, len(ops), 1000):
        await db.catalog_items.bulk_write(ops[i:i + 1000], ordered=False)
    return created


# ---------- batch counters ----------

async def _recount(batch_id: str) -> dict:
    ms = await db.matches.find({"batch_id": batch_id}, {"_id": 0, "status": 1, "decision": 1, "change": 1,
                                                        "reasons": 1, "flags": 1, "level_status": 1,
                                                        "level_decision": 1, "ocr_status": 1}).to_list(None)
    c = {
        "total": len(ms),
        "clean": sum(m["status"] == "clean" for m in ms),
        "exceptions": sum(m["status"] == "exception" for m in ms),
        "pending": sum(m["decision"] == "pending" for m in ms),
        "approved": sum(m["decision"] in ("approved", "auto_approved") for m in ms),
        "rejected": sum(m["decision"] == "rejected" for m in ms),
        "new_records": sum(m.get("change") == "new" for m in ms),
        "replacements": sum(m.get("change") == "replacement" for m in ms),
        "fills": sum(m.get("change") == "fill" for m in ms),
        "unmatched": sum(m.get("change") == "unmatched" for m in ms),
        "duplicate_files": sum("duplicate_image" in m["reasons"] for m in ms),
        "ocr_conflicts": sum(bool(set(m.get("flags", [])) & {"ocr_name_conflict", "level_unreadable"})
                             or "level_conflict" in m["reasons"] for m in ms),
        "level_held": sum("level_conflict" in m["reasons"] and m.get("level_decision") is None for m in ms),
        "analysis_done": sum(m.get("ocr_status", "done") != "pending" for m in ms),
    }
    batch = await db.batches.find_one({"id": batch_id}, {"_id": 0, "status": 1, "analysis_status": 1})
    update = dict(c)
    update["analysis_total"] = c["total"]
    if batch and batch["status"] in ("review", "ready"):
        update["status"] = "ready" if c["pending"] == 0 and batch.get("analysis_status", "done") == "done" else "review"
    await db.batches.update_one({"id": batch_id}, {"$set": update})
    return c


# ---------- OCR analysis (background, resumable: only pending matches are processed) ----------

async def _ocr_evidence(m: dict, batch_id: str) -> dict:
    """Read one card's level/name. Evidence only: never fatal, never changes manifest data."""
    from lib.ocr import analyze_card
    img = await db.card_images.find_one({"id": m["image_id"]}, {"_id": 0, "data": 1}) if m.get("image_id") else None
    if img is None:
        return {"ocr_status": "done", "level_status": "unreadable"}
    try:
        r = await run_in_threadpool(analyze_card, bytes(img["data"]), m.get("manifest_name", ""))
    except Exception:  # corrupt image etc.
        log.exception("ocr failed for %s", m["id"])
        return {"ocr_status": "error", "level_status": "unreadable"}
    crop_id = str(uuid.uuid4())
    await db.card_images.insert_one({"id": crop_id, "batch_id": batch_id, "data": r.pop("crop"), "kind": "level_crop"})
    return {"ocr_status": "done", **r, "level_crop_id": crop_id}


def _flag_conflicts(m: dict, upd: dict) -> None:
    """Turn OCR evidence into review reasons/flags; a clean match with a new reason goes back to review."""
    reasons, flags = list(m["reasons"]), list(m.get("flags", []))
    ls = upd["level_status"]
    if ls in ("outdated", "possible_misread") and "level_conflict" not in reasons:
        reasons.append("level_conflict")
    if ls == "unreadable" and "level_unreadable" not in flags:
        flags.append("level_unreadable")
    score = upd.get("ocr_name_score")
    if score is not None and score < 0.8 and "ocr_name_conflict" not in flags:
        flags.append("ocr_name_conflict")
    upd.update({"reasons": reasons, "flags": flags})
    if reasons and m["status"] == "clean":
        upd.update({"status": "exception", "decision": "pending", "decided_by": None, "decided_at": None})


async def _sync_catalog_evidence(m: dict, upd: dict, batch_id: str) -> None:
    if not m.get("catalog_item_id"):
        return
    if m.get("image_id"):
        # keep the live record's level evidence in sync when this card is the one in the library
        await db.catalog_items.update_one({"id": m["catalog_item_id"], "card_image_id": m["image_id"]},
                                          {"$set": {"level_status": upd["level_status"]}})
    if upd["level_status"] == "confirmed_70":
        # worklist: a regenerated card arrived and OCR confirmed level 70
        await db.catalog_items.update_one(
            {"id": m["catalog_item_id"], "needs_level70_refresh": True, "regen_status": {"$ne": "published"}},
            {"$set": {"regen_status": "verified", "regen_status_by": "OCR (batch " + batch_id[:8] + ")",
                      "regen_status_at": _now()}})


async def _analyze(batch_id: str) -> None:
    try:
        await db.batches.update_one({"id": batch_id}, {"$set": {"analysis_status": "running"}})
        while True:
            todo = await db.matches.find({"batch_id": batch_id, "ocr_status": "pending"},
                                         {"_id": 0}).sort("index", 1).to_list(25)
            if not todo:
                break
            for m in todo:
                upd = await _ocr_evidence(m, batch_id)
                _flag_conflicts(m, upd)
                await db.matches.update_one({"id": m["id"]}, {"$set": upd})
                await _sync_catalog_evidence(m, upd, batch_id)
            await _recount(batch_id)
        await db.batches.update_one({"id": batch_id}, {"$set": {"analysis_status": "done"}})
        await _recount(batch_id)
    finally:
        _running.pop(batch_id, None)


def start_analysis(batch_id: str) -> None:
    if batch_id not in _running:
        _running[batch_id] = asyncio.create_task(_analyze(batch_id))


async def resume_unfinished_analyses() -> None:
    for b in await db.batches.find({"analysis_status": {"$in": ["running", "pending"]}}, {"_id": 0, "id": 1}).to_list(None):
        start_analysis(b["id"])


# ---------- batch creation (dry run: the catalog is NOT touched until Apply) ----------

async def create_batch(data: bytes, filename: str, member: dict, add_to_catalog: bool = False, note: str = "") -> Batch:
    try:
        cards, files, defaults, missing = await run_in_threadpool(read_card_zip, data)
    except PackageError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not cards:
        raise HTTPException(status_code=400, detail="manifest.json lists no cards.")
    catalog = await db.catalog_items.find({}, {"_id": 0}).to_list(None)
    if not catalog and not add_to_catalog:
        raise HTTPException(status_code=409, detail="Import a God Roll catalog first, or add manifest records to the catalog.")
    by_serial = {c["serial"]: c for c in catalog}
    by_key = {c["item_key"]: c for c in catalog if c.get("item_key")}
    results = await run_in_threadpool(build_matches, cards, files, by_serial, defaults, by_key, add_to_catalog)
    new_meta = {r["serial"]: r for r in catalog_records_from_manifest(cards, files, defaults)}
    missing_records = [r for r in image_less_records(missing) if r["serial"] not in by_serial or
                       by_serial[r["serial"]]["card_state"] == "missing"]

    batch_id = str(uuid.uuid4())
    images, matches = [], []
    for fields, image in results:
        image_id = None
        if image is not None:
            image_id = str(uuid.uuid4())
            images.append({"id": image_id, "batch_id": batch_id, "data": image, "size": len(image), "kind": "card"})
        auto = fields["decision"] == "auto_approved"
        matches.append({"id": str(uuid.uuid4()), "batch_id": batch_id, "image_id": image_id, "note": "",
                        "decided_by": "auto" if auto else None, "decided_at": _now() if auto else None,
                        "new_record": new_meta.get(fields["serial"]) if fields["change"] == "new" else None,
                        "level_crop_id": None, "level_decision": None, **fields})
    for i in range(0, len(images), 200):
        await db.card_images.insert_many(images[i:i + 200])
    await db.matches.insert_many(matches)
    await db.batches.insert_one({
        "id": batch_id, "filename": filename, "created_at": _now(), "created_by": _who(member),
        "status": "review", "zip_files": len(files), "add_to_catalog": add_to_catalog,
        "analysis_status": "pending", "missing_record_list": missing_records, "missing_records": len(missing_records),
        "package_generated_at": None, "published_at": None, "published_by": None, "note": note.strip(),
    })
    await _recount(batch_id)
    await audit.log(_who(member), "batch_imported", batch_id=batch_id, filename=filename, cards=len(cards),
                    missing_records=len(missing_records), mode="dry_run", note=note.strip())
    start_analysis(batch_id)
    return _batch(await db.batches.find_one({"id": batch_id}, {"_id": 0}))


async def _get_batch(batch_id: str) -> dict:
    doc = await db.batches.find_one({"id": batch_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Batch not found")
    return doc


# ---------- catalog ----------

@router.post("/catalog/import", response_model=CatalogImportResult)
async def import_catalog(items: list[CatalogItemIn], mode: str = Query("merge", pattern="^(merge|replace)$"),
                         member: dict = Depends(any_member)):
    if not items:
        raise HTTPException(status_code=422, detail="Catalog is empty")
    serials = [it.serial.strip() for it in items]
    if len(set(serials)) != len(serials):
        raise HTTPException(status_code=422, detail="Duplicate serials in catalog file")
    rows = [{**it.model_dump(), "serial": it.serial.strip(), "name": it.name.strip(),
             "has_image": bool(it.has_image) or bool(it.image_url)} for it in items]
    if mode == "replace":
        await db.catalog_items.delete_many({"serial": {"$nin": serials}})  # explicit user-chosen replace
    await _merge_catalog(rows)
    await audit.log(_who(member), "catalog_imported", mode=mode, records=len(rows))
    docs = await db.catalog_items.find({"serial": {"$in": serials}}, {"_id": 0, "card_state": 1}).to_list(None)
    with_card = sum(1 for d in docs if d["card_state"] == "card")
    return CatalogImportResult(imported=len(docs), with_card=with_card, image_missing=len(docs) - with_card)


@router.get("/catalog", response_model=list[CatalogItem])
async def list_catalog(member: dict = Depends(any_member)):
    docs = await db.catalog_items.find({}, {"_id": 0}).sort("name", 1).to_list(None)
    return [_item(d) for d in docs]


@router.patch("/catalog/{item_id}", response_model=CatalogItem)
async def edit_catalog_item(item_id: str, body: CatalogEditIn, member: dict = Depends(admin_only)):
    """Name/category/manufacturer only — serial and itemKey are authoritative and never editable."""
    doc = await db.catalog_items.find_one({"id": item_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Record not found")
    changes = {k: v.strip() for k, v in body.model_dump(exclude_none=True).items()}
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to change")
    await db.catalog_items.update_one({"id": item_id}, {"$set": changes})
    await audit.log(_who(member), "record_edited", item=doc, before={k: doc.get(k) for k in changes}, after=changes)
    return _item(await db.catalog_items.find_one({"id": item_id}, {"_id": 0}))


# ---------- batches ----------

@router.post("/batches", response_model=Batch)
async def upload_batch(file: UploadFile = File(...), add_to_catalog: bool = Query(False),
                       member: dict = Depends(any_member)):
    data = await file.read(MAX_ZIP_BYTES + 1)
    if len(data) > MAX_ZIP_BYTES:
        raise HTTPException(status_code=413, detail="ZIP is larger than 1.5 GB.")
    return await create_batch(data, file.filename or "cards.zip", member, add_to_catalog)


@router.get("/batches", response_model=list[Batch])
async def list_batches(member: dict = Depends(any_member)):
    docs = await db.batches.find({}, {"_id": 0, "missing_record_list": 0}).sort("created_at", -1).to_list(200)
    return [_batch(d) for d in docs]


@router.get("/batches/{batch_id}", response_model=Batch)
async def get_batch(batch_id: str, member: dict = Depends(any_member)):
    return _batch(await _get_batch(batch_id))


@router.get("/batches/{batch_id}/missing-records", response_model=list[CatalogItemIn])
async def batch_missing_records(batch_id: str, member: dict = Depends(any_member)):
    b = await _get_batch(batch_id)
    return [CatalogItemIn(**r) for r in b.get("missing_record_list", [])]


@router.post("/batches/{batch_id}/analyze", response_model=Batch)
async def analyze_batch(batch_id: str, member: dict = Depends(admin_only)):
    """Start or resume OCR verification. Already-read cards are skipped."""
    await _get_batch(batch_id)
    await db.batches.update_one({"id": batch_id}, {"$set": {"analysis_status": "running"}})
    start_analysis(batch_id)
    return _batch(await _get_batch(batch_id))


@router.get("/batches/{batch_id}/matches", response_model=list[Match])
async def list_matches(batch_id: str, member: dict = Depends(any_member)):
    batch = await _get_batch(batch_id)
    docs = await db.matches.find({"batch_id": batch_id}, {"_id": 0, "new_record": 0}).sort("index", 1).to_list(None)
    # side-by-side compare: the library card this import replaces (or replaced, once applied)
    if batch["status"] == "published":
        prev = {e["serial"]: e.get("previous_image_id") for e in await db.audit.find(
            {"batch_id": batch_id, "action": "card_replaced"}, {"_id": 0, "serial": 1, "previous_image_id": 1}).to_list(None)}
    else:
        ids = [d["catalog_item_id"] for d in docs if d.get("catalog_item_id")]
        prev = {c["serial"]: c.get("card_image_id") for c in await db.catalog_items.find(
            {"id": {"$in": ids}, "card_state": "card"}, {"_id": 0, "serial": 1, "card_image_id": 1}).to_list(None)}
    for d in docs:
        cid = prev.get(d["serial"])
        d["compare_image_id"] = cid if cid and cid != d.get("image_id") else None
    return [_match(d) for d in docs]


@router.patch("/matches/{match_id}", response_model=Match)
async def decide_match(match_id: str, body: DecisionIn, member: dict = Depends(any_member)):
    m = await db.matches.find_one({"id": match_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    batch = await _get_batch(m["batch_id"])
    if batch["status"] == "published":
        raise HTTPException(status_code=409, detail="This batch is already applied.")
    if m["status"] == "clean" and body.decision == "pending":
        raise HTTPException(status_code=400, detail="Clean matches are approved automatically.")
    if "level_conflict" in m["reasons"] and m.get("level_decision") is None and body.decision == "approved":
        raise HTTPException(status_code=400, detail="Record a level decision first.")
    other = [r for r in m["reasons"] if r != "level_conflict" or m.get("level_decision") == "require_regeneration"]
    if body.decision == "approved" and m["status"] == "exception" and not can_approve({"reasons": other}):
        raise HTTPException(status_code=400, detail="This exception has no catalog item, valid image or unique file, so it can only be rejected.")
    if body.decision == "approved" and m["status"] == "exception" and not body.note.strip():
        raise HTTPException(status_code=400, detail="Add a note explaining why this exception is approved.")
    decision = "auto_approved" if (m["status"] == "clean" and body.decision == "approved") else body.decision
    await db.matches.update_one({"id": match_id}, {"$set": {
        "decision": decision, "note": body.note.strip(),
        "decided_by": _who(member) if decision != "pending" else None,
        "decided_at": _now() if decision != "pending" else None,
    }})
    await audit.log(_who(member), "match_decision", batch_id=m["batch_id"], serial=m["serial"], item_key=m.get("item_key", ""),
                    item_name=m.get("catalog_name") or m.get("manifest_name", ""), decision=decision, note=body.note.strip())
    await _recount(m["batch_id"])
    return _match(await db.matches.find_one({"id": match_id}, {"_id": 0}))


@router.post("/matches/{match_id}/level-decision", response_model=Match)
async def level_decision(match_id: str, body: LevelDecisionIn, member: dict = Depends(any_member)):
    """Manifest level 70 vs OCR level conflict: approve as 70, OCR misread, or require regeneration."""
    m = await db.matches.find_one({"id": match_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    if "level_conflict" not in m["reasons"] and m.get("level_status") != "unreadable":
        raise HTTPException(status_code=400, detail="This card has no level conflict.")
    batch = await _get_batch(m["batch_id"])
    upd = {"level_decision": body.decision, "level_decided_by": _who(member), "level_decided_at": _now(),
           "note": body.note.strip() or m.get("note", "")}
    others = [r for r in m["reasons"] if r != "level_conflict"]
    if body.decision == "require_regeneration":
        upd.update({"decision": "rejected", "decided_by": _who(member), "decided_at": _now()})
        if batch["status"] == "published" and m.get("catalog_item_id"):
            await db.catalog_items.update_one({"id": m["catalog_item_id"]}, {"$set": {
                "needs_level70_refresh": True, "regen_status": "pending", "regen_status_by": _who(member), "regen_status_at": _now()}})
    elif not others:
        upd.update({"decision": "approved", "decided_by": _who(member), "decided_at": _now()})
        if batch["status"] == "published" and m.get("catalog_item_id"):
            await db.catalog_items.update_one({"id": m["catalog_item_id"]}, {"$set": {"needs_level70_refresh": False}})
    await db.matches.update_one({"id": match_id}, {"$set": upd})
    await audit.log(_who(member), "level_decision", batch_id=m["batch_id"], serial=m["serial"], item_key=m.get("item_key", ""),
                    item_name=m.get("catalog_name") or m.get("manifest_name", ""), decision=body.decision,
                    ocr_level=m.get("ocr_level"), ocr_confidence=m.get("ocr_level_conf"), note=body.note.strip())
    await _recount(m["batch_id"])
    return _match(await db.matches.find_one({"id": match_id}, {"_id": 0}))


@router.get("/cards/{image_id}")
async def card_image(image_id: str):
    doc = await db.card_images.find_one({"id": image_id}, {"_id": 0, "data": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Card not found")
    return Response(content=bytes(doc["data"]), media_type="image/webp",
                    headers={"Cache-Control": "private, max-age=86400"})


# ---------- export package ----------

def _package_manifest(batch: dict, matches: list, approved: list, images: dict, fname) -> dict:
    return {
        "schema": 2, "generated_by": "Tacklebox Card Injector", "generated_at": _now().isoformat(),
        "batch_id": batch["id"], "source_zip": batch["filename"],
        "present": [{"itemKey": m["item_key"], "serial": m["serial"], "name": m["catalog_name"] or m["manifest_name"],
                     "filename": fname(m), "sha256": m["sha256"], "byteSize": len(images.get(m["image_id"], b"")),
                     "level": REQUIRED_LEVEL, "levelStatus": m.get("level_status"), "levelDecision": m.get("level_decision"),
                     "change": m.get("change")} for m in approved],
        "missing": [{"itemKey": r.get("item_key", ""), "serial": r["serial"], "name": r["name"], "placeholder": "Card pending"}
                    for r in batch.get("missing_record_list", [])]
                   + [{"itemKey": m["item_key"], "serial": m["serial"], "name": m["catalog_name"] or m["manifest_name"],
                       "placeholder": "Card pending", "reason": "requires level-70 regeneration"}
                      for m in matches if m.get("level_decision") == "require_regeneration"],
    }


def _package_summary(batch: dict, counts: dict, actor: str) -> dict:
    return {"batch_id": batch["id"], "source_zip": batch["filename"], "generated_by": actor,
               "generated_at": _now().isoformat(), "reviewable": True,
               "rules": {"identity": "manifest serial + itemKey (exact)", "required_level": REQUIRED_LEVEL,
                         "required_source": REQUIRED_SOURCE, "ocr": "evidence only — never overwrites manifest data"},
               "counts": counts, "missing_records": batch.get("missing_records", 0)}



def _package_zip(manifest: dict, summary: dict, matches: list, approved: list, images: dict, links: dict, fname) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        zf.writestr("import_summary.json", json.dumps(summary, indent=2))
        for m in approved:
            if m["image_id"] in images:
                zf.writestr(fname(m), images[m["image_id"]])
        rows = io.StringIO()
        w = csv.writer(rows)
        w.writerow(["serial", "itemKey", "name", "filename", "site_item_id", "site_item_name", "link_method"])
        for m in approved:
            ln = links.get(m["serial"], {})
            w.writerow([m["serial"], m["item_key"], m["catalog_name"] or m["manifest_name"], fname(m),
                        ln.get("site_item_id") or "", ln.get("site_item_name") or "", ln.get("site_link_method") or ""])
        zf.writestr("link_mapping.csv", rows.getvalue())
        rows = io.StringIO()
        w = csv.writer(rows)
        w.writerow(["serial", "itemKey", "file", "name", "reasons", "flags", "ocr_level", "ocr_confidence",
                    "level_status", "level_decision", "decision", "note", "decided_by"])
        for m in matches:
            if m["status"] == "exception" or m.get("flags"):
                w.writerow([m["serial"], m["item_key"], m["file"], m["catalog_name"] or m["manifest_name"],
                            "; ".join(REASON_LABELS.get(r, r) for r in m["reasons"]),
                            "; ".join(FLAG_LABELS.get(f, f) for f in m.get("flags", [])),
                            m.get("ocr_level") or "", m.get("ocr_level_conf") or "", m.get("level_status"),
                            m.get("level_decision") or "", m["decision"], m["note"], m["decided_by"] or ""])
        zf.writestr("exceptions_report.csv", rows.getvalue())
    return buf.getvalue()


@router.get("/batches/{batch_id}/package")
async def export_package(batch_id: str, member: dict = Depends(any_member)):
    batch = await _get_batch(batch_id)
    counts = await _recount(batch_id)
    if batch.get("analysis_status", "done") != "done":
        raise HTTPException(status_code=409, detail="OCR verification is still running.")
    if counts["pending"]:
        raise HTTPException(status_code=409, detail=f"{counts['pending']} exception(s) still need a decision.")
    matches = await db.matches.find({"batch_id": batch_id}, {"_id": 0}).sort("index", 1).to_list(None)
    approved = [m for m in matches if m["decision"] in ("approved", "auto_approved") and m["image_id"]]
    images = {d["id"]: bytes(d["data"]) for d in await db.card_images.find(
        {"id": {"$in": [m["image_id"] for m in approved]}}, {"_id": 0}).to_list(None)}
    serials = [m["serial"] for m in matches if m["serial"]]
    links = {d["serial"]: d for d in await db.catalog_items.find(
        {"serial": {"$in": serials}}, {"_id": 0, "serial": 1, "site_item_id": 1, "site_item_name": 1, "site_link_method": 1}).to_list(None)}
    fname = lambda m: f"images/{m['file_slug'] or 'card'}-{m['item_key'] or m['serial'][:12]}.webp"  # noqa: E731

    manifest = _package_manifest(batch, matches, approved, images, fname)
    summary = _package_summary(batch, counts, _who(member))

    def build() -> bytes:
        return _package_zip(manifest, summary, matches, approved, images, links, fname)

    data = await run_in_threadpool(build)
    update = {"package_generated_at": _now()}
    if batch["status"] != "published":
        update["status"] = "package_generated"
    await db.batches.update_one({"id": batch_id}, {"$set": update})
    await audit.log(_who(member), "package_generated", batch_id=batch_id, cards=len(approved))
    return Response(content=data, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="tacklebox-import-package-{batch_id[:8]}.zip"'})


# ---------- pre-publish validation ----------

UNCERTAIN_CODE = ["item_key_mismatch", "item_key_only", "filename_key_mismatch", "checksum_mismatch",
                  "duplicate_serial", "duplicate_image", "serial_missing"]
VERIFIED_DECISIONS = ("approve_70", "ocr_misread")


async def validate_matches(matches: list[dict]) -> dict[str, tuple[list[str], list[str]]]:
    """For every card that would go public: (blockers, warnings). A card publishes only when it is
    level 70, passes OCR verification (or a reviewer's level decision), has no uncertain code and is
    not quarantined. A missing website link is only a warning."""
    publish = [m for m in matches if m["decision"] in ("approved", "auto_approved") and m.get("image_id")
               and m.get("level_decision") != "require_regeneration"]
    items = {d["serial"]: d for d in await db.catalog_items.find(
        {"serial": {"$in": [m["serial"] for m in publish]}}, {"_id": 0, "serial": 1, "quarantined": 1,
                                                              "quarantine_reason": 1, "site_item_id": 1}).to_list(None)}
    codes = set(await db.site_codes.distinct("code", {"code": {"$in": [m["serial"] for m in publish]}}))
    out = {}
    for m in publish:
        blockers, warnings = [], []
        if m.get("level") not in (None, REQUIRED_LEVEL):
            blockers.append(f"Manifest level is {m.get('level')}, not {REQUIRED_LEVEL}")
        if m.get("level_status") != "confirmed_70" and m.get("level_decision") not in VERIFIED_DECISIONS:
            blockers.append(f"Level 70 not verified ({m.get('level_status', 'pending').replace('_', ' ')}); record a level decision")
        for r in m["reasons"]:
            if r in UNCERTAIN_CODE:
                blockers.append(f"Uncertain code: {REASON_LABELS.get(r, r)}")
        it = items.get(m["serial"])
        if it and it.get("quarantined"):
            blockers.append("Quarantined" + (f": {it['quarantine_reason']}" if it.get("quarantine_reason") else ""))
        if not (it and it.get("site_item_id")) and m["serial"] not in codes:
            warnings.append("Needs website link")
        out[m["id"]] = (blockers, warnings)
    return out


@router.get("/batches/{batch_id}/validation", response_model=ValidationReport)
async def batch_validation(batch_id: str, member: dict = Depends(any_member)):
    await _get_batch(batch_id)
    matches = await db.matches.find({"batch_id": batch_id}, {"_id": 0, "new_record": 0}).sort("index", 1).to_list(None)
    checks = await validate_matches(matches)
    by_id = {m["id"]: m for m in matches}
    rows = [ValidationRow(match_id=k, serial=by_id[k]["serial"], item_key=by_id[k].get("item_key", ""),
                          name=by_id[k].get("catalog_name") or by_id[k].get("manifest_name", ""), change=by_id[k].get("change", ""),
                          blockers=b, warnings=w) for k, (b, w) in checks.items() if b or w]
    blocked = sum(1 for b, _ in checks.values() if b)
    return ValidationReport(batch_id=batch_id, would_publish=len(checks), publishable=len(checks) - blocked, blocked=blocked,
                            warnings=sum(1 for b, w in checks.values() if w and not b),
                            rows=sorted(rows, key=lambda r: (not r.blockers, r.name)))


# ---------- apply to library (SIMULATED direct upload; admin + typed confirmation) ----------

@router.post("/batches/{batch_id}/direct-upload", response_model=DirectUploadResult)
async def direct_upload(batch_id: str, body: DirectUploadIn, member: dict = Depends(admin_only)):
    batch = await _get_batch(batch_id)
    actor = _who(member)
    if batch["status"] == "published":
        raise HTTPException(status_code=409, detail="This batch is already applied.")
    if not body.acknowledged or body.confirmation.strip() != CONFIRM_PHRASE:
        raise HTTPException(status_code=400, detail=f"Final confirmation missing: type {CONFIRM_PHRASE} exactly.")
    if batch.get("analysis_status", "done") != "done":
        raise HTTPException(status_code=409, detail="OCR verification is still running.")
    counts = await _recount(batch_id)
    if counts["pending"]:
        raise HTTPException(status_code=409, detail=f"{counts['pending']} exception(s) still need a decision.")
    matches = await db.matches.find({"batch_id": batch_id}, {"_id": 0}).to_list(None)
    checks = await validate_matches(matches)
    now = _now()
    res = DirectUploadResult(batch_id=batch_id, replaced=0)
    touched: list[str] = []
    for m in matches:
        approved = m["decision"] in ("approved", "auto_approved") and m["image_id"]
        regen = m.get("level_decision") == "require_regeneration"
        if not (approved or regen):
            continue
        if approved and not regen and checks.get(m["id"], ([], []))[0]:
            res.blocked += 1  # pre-publish validation failed: the card stays out of the library
            await audit.log(actor, "publish_blocked", batch_id=batch_id, serial=m["serial"], item_key=m.get("item_key", ""),
                            item_name=m.get("catalog_name") or m.get("manifest_name", ""), blockers=checks[m["id"]][0])
            continue
        item = await db.catalog_items.find_one({"id": m["catalog_item_id"]}, {"_id": 0}) if m.get("catalog_item_id") else None
        if item is None and m.get("change") == "new" and m.get("new_record"):
            item = await db.catalog_items.find_one({"serial": m["serial"]}, {"_id": 0})
            if item is None:
                item = _new_catalog_doc(m["new_record"], "missing")
                await db.catalog_items.insert_one(dict(item))
                item.pop("_id", None)
                res.created += 1
                await audit.log(actor, "record_created", batch_id=batch_id, item=item)
        if item is None:
            continue
        touched.append(item["serial"])
        if regen:
            state = "card" if item["card_state"] == "card" else "pending_placeholder"
            await db.catalog_items.update_one({"id": item["id"]}, {"$set": {"needs_level70_refresh": True, "card_state": state,
                                                                           "level_status": m.get("level_status"),
                                                                           "regen_status": "pending", "regen_status_by": actor,
                                                                           "regen_status_at": now}})
            res.held_for_regeneration += 1
            await audit.log(actor, "held_for_regeneration", batch_id=batch_id, item=item, ocr_level=m.get("ocr_level"))
            continue
        prev = item.get("card_image_id")
        await db.catalog_items.update_one({"id": item["id"]}, {"$set": {
            "card_state": "card", "card_image_id": m["image_id"], "card_updated_at": now,
            "level_status": m.get("level_status"), "needs_level70_refresh": False,
            **({"regen_status": "published", "regen_status_by": actor, "regen_status_at": now} if item.get("needs_level70_refresh") else {})}})
        if item["card_state"] == "card":
            res.replaced += 1
        else:
            res.added += 1
        await audit.log(actor, "card_replaced" if item["card_state"] == "card" else "card_added", batch_id=batch_id,
                        item=item, previous_image_id=prev, new_image_id=m["image_id"],
                        approved_by=m.get("decided_by"), level_status=m.get("level_status"),
                        prev_refresh=bool(item.get("needs_level70_refresh")), prev_regen_status=item.get("regen_status"))
    for r in batch.get("missing_record_list", []):
        item = await db.catalog_items.find_one({"serial": r["serial"]}, {"_id": 0})
        if item is None:
            item = _new_catalog_doc(r, "pending_placeholder")
            await db.catalog_items.insert_one(dict(item))
            item.pop("_id", None)
            res.created += 1
            await audit.log(actor, "record_created", batch_id=batch_id, item=item)
        elif item["card_state"] == "missing":
            await db.catalog_items.update_one({"id": item["id"]}, {"$set": {"card_state": "pending_placeholder"}})
        else:
            continue
        await db.catalog_items.update_one({"id": item["id"]}, {"$set": {"placeholder_published_at": now, "placeholder_published_by": actor}})
        res.placeholders += 1
        touched.append(r["serial"])
        await audit.log(actor, "placeholder_published", batch_id=batch_id, item=item)
    await auto_link_serials(touched, actor, batch_id=batch_id)
    await db.batches.update_one({"id": batch_id}, {"$set": {"status": "published", "published_at": now, "published_by": actor}})
    await audit.log(actor, "import_applied", batch_id=batch_id, **res.model_dump(exclude={"batch_id"}))
    return res


# ---------- admin queue ----------

@router.get("/admin/queue", response_model=list[CatalogItem])
async def admin_queue(member: dict = Depends(admin_only)):
    docs = await db.catalog_items.find({"$or": [{"card_state": {"$in": ["missing", "pending_placeholder"]}},
                                                {"needs_level70_refresh": True}]},
                                       {"_id": 0}).sort("name", 1).to_list(None)
    return [_item(d) for d in docs]


@router.post("/admin/queue/publish", response_model=QueuePublishResult)
async def publish_placeholders(body: QueuePublishIn, member: dict = Depends(admin_only)):
    docs = await db.catalog_items.find({"id": {"$in": body.item_ids}, "card_state": "missing"}, {"_id": 0}).to_list(None)
    await db.catalog_items.update_many(
        {"id": {"$in": [d["id"] for d in docs]}},
        {"$set": {"card_state": "pending_placeholder", "placeholder_published_at": _now(),
                  "placeholder_published_by": _who(member)}})
    for d in docs:
        await audit.log(_who(member), "placeholder_published", item=d)
    return QueuePublishResult(published=len(docs))


# ---------- audit + restore ----------

@router.get("/audit", response_model=list[AuditEntry])
async def list_audit(action: str = Query("", max_length=60), q: str = Query("", max_length=100), limit: int = Query(300, le=2000), member: dict = Depends(admin_only)):
    flt: dict = {}
    if action:
        flt["action"] = action
    if q:
        flt["$or"] = [{"serial": q}, {"item_key": q}, {"item_name": {"$regex": re.escape(q), "$options": "i"}}, {"actor": q}]
    docs = await db.audit.find(flt, {"_id": 0}).sort("at", -1).to_list(limit)
    return [AuditEntry(**_aware(d, "at", "restored_at")) for d in docs]


@router.post("/audit/{entry_id}/restore", response_model=CatalogItem)
async def restore_previous_card(entry_id: str, member: dict = Depends(admin_only)):
    e = await db.audit.find_one({"id": entry_id}, {"_id": 0})
    if not e or e["action"] not in ("card_replaced", "card_added"):
        raise HTTPException(status_code=400, detail="Only card replacements can be restored.")
    if e.get("restored_at"):
        raise HTTPException(status_code=409, detail="Already restored.")
    item = await db.catalog_items.find_one({"id": e["catalog_item_id"]}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Record no longer exists")
    if item.get("card_image_id") != e.get("new_image_id"):
        raise HTTPException(status_code=409, detail="The card has changed since this replacement; restore the newer entry first.")
    prev = e.get("previous_image_id")
    await db.catalog_items.update_one({"id": item["id"]}, {"$set": {
        "card_image_id": prev, "card_state": "card" if prev else "pending_placeholder", "card_updated_at": _now()}})
    await db.audit.update_one({"id": entry_id}, {"$set": {"restored_at": _now()}})
    await audit.log(_who(member), "card_restored", batch_id=e.get("batch_id"), item=item,
                    previous_image_id=e.get("new_image_id"), new_image_id=prev, restores=entry_id)
    return _item(await db.catalog_items.find_one({"id": item["id"]}, {"_id": 0}))


# ---------- stats ----------

@router.get("/stats", response_model=Stats)
async def stats(member: dict = Depends(any_member)):
    latest = await db.batches.find_one({}, {"_id": 0, "missing_record_list": 0}, sort=[("created_at", -1)])
    return Stats(
        catalog_total=await db.catalog_items.count_documents({}),
        catalog_with_card=await db.catalog_items.count_documents({"card_state": "card"}),
        catalog_missing=await db.catalog_items.count_documents({"card_state": "missing"}),
        catalog_pending_placeholder=await db.catalog_items.count_documents({"card_state": "pending_placeholder"}),
        needs_refresh=await db.catalog_items.count_documents({"needs_level70_refresh": True}),
        unlinked=await db.catalog_items.count_documents({"site_item_id": None}),
        latest_batch=_batch(latest) if latest else None,
    )


# ---------- import history timeline ----------

HISTORY_EVENTS = ["batch_imported", "package_generated", "import_applied", "import_rolled_back"]


@router.get("/imports/history", response_model=list[ImportHistoryEntry])
async def import_history(member: dict = Depends(any_member)):
    batches = await db.batches.find({}, {"_id": 0, "missing_record_list": 0}).sort("created_at", -1).to_list(200)
    ids = [b["id"] for b in batches]
    changes: dict[str, dict[str, int]] = {}
    async for r in db.audit.aggregate([{"$match": {"batch_id": {"$in": ids}, "action": {"$nin": HISTORY_EVENTS}}},
                                       {"$group": {"_id": {"b": "$batch_id", "a": "$action"}, "n": {"$sum": 1}}}]):
        changes.setdefault(r["_id"]["b"], {})[r["_id"]["a"]] = r["n"]
    events: dict[str, list[AuditEntry]] = {}
    for e in await db.audit.find({"batch_id": {"$in": ids}, "action": {"$in": HISTORY_EVENTS}}, {"_id": 0}).sort("at", 1).to_list(None):
        events.setdefault(e["batch_id"], []).append(AuditEntry(**_aware(e, "at", "restored_at")))
    return [ImportHistoryEntry(batch=_batch(b), changes=changes.get(b["id"], {}), events=events.get(b["id"], []),
                               can_download=b.get("analysis_status", "done") == "done" and b.get("pending", 0) == 0)
            for b in batches]


# ---------- undo a whole applied import ----------

ROLLBACK_PHRASE = "ROLLBACK-CONFIRM"
REVERSIBLE = ["card_replaced", "card_added", "record_created", "placeholder_published", "held_for_regeneration", "site_linked"]


@router.post("/batches/{batch_id}/rollback", response_model=RollbackResult)
async def rollback_import(batch_id: str, body: RollbackIn, member: dict = Depends(admin_only)):
    """Revert every audit-logged change one applied import made (newest first). dry_run=true only counts.
    Cards changed again after this import are left alone and reported as conflicts."""
    batch = await _get_batch(batch_id)
    if batch["status"] != "published":
        raise HTTPException(status_code=409, detail="Only an applied import can be rolled back.")
    dry = body.dry_run
    if not dry and body.confirmation.strip() != ROLLBACK_PHRASE:
        raise HTTPException(status_code=400, detail=f"Final confirmation missing: type {ROLLBACK_PHRASE} exactly.")
    entries = await db.audit.find({"batch_id": batch_id, "action": {"$in": REVERSIBLE}, "restored_at": None},
                                  {"_id": 0}).sort("at", -1).to_list(None)
    res = RollbackResult(batch_id=batch_id, dry_run=dry, reversible_changes=len(entries))
    actor, now, done = _who(member), _now(), []
    for e in entries:
        item = await db.catalog_items.find_one({"id": e.get("catalog_item_id")}, {"_id": 0}) if e.get("catalog_item_id") else None
        if item is None:
            continue
        label = f"{item['name']} ({item['serial'][:14]}…)"
        a, upd = e["action"], None
        if a in ("card_replaced", "card_added"):
            if item.get("card_image_id") != e.get("new_image_id"):
                res.conflicts.append(f"{label}: card changed after this import, left as is")
                continue
            prev = e.get("previous_image_id")
            upd = {"card_image_id": prev, "card_state": "card" if prev else "missing", "card_updated_at": now}
            if e.get("details", {}).get("prev_refresh"):  # the card was on the worklist: put it back there
                upd.update({"needs_level70_refresh": True, "regen_status": e["details"].get("prev_regen_status") or "pending"})
            res.cards_reverted += 1
        elif a == "placeholder_published":
            if item["card_state"] != "pending_placeholder":
                res.conflicts.append(f"{label}: no longer Card pending, left as is")
                continue
            upd = {"card_state": "missing", "placeholder_published_at": None}
            res.placeholders_reverted += 1
        elif a == "held_for_regeneration":
            upd = {"needs_level70_refresh": False, "regen_status": None, "regen_status_by": None, "regen_status_at": None}
            res.regen_flags_cleared += 1
        elif a == "site_linked":
            if item.get("site_item_id") != e.get("site_item_id"):
                res.conflicts.append(f"{label}: website link changed since, left as is")
                continue
            upd = {"site_item_id": None, "site_item_name": "", "site_link_method": None}
            res.links_removed += 1
        elif a == "record_created":
            res.records_archived += 1
            if not dry:  # archived copy kept; the record leaves the live catalog
                await db.catalog_archive.insert_one({**item, "archived_at": now, "archived_by": actor, "archived_from_batch": batch_id})
                await db.catalog_items.delete_one({"id": item["id"]})
            done.append(e["id"])
            continue
        if not dry and upd:
            await db.catalog_items.update_one({"id": item["id"]}, {"$set": upd})
        done.append(e["id"])
    if not dry:
        await db.audit.update_many({"id": {"$in": done}}, {"$set": {"restored_at": now}})
        await db.batches.update_one({"id": batch_id}, {"$set": {"status": "ready", "rolled_back_at": now, "rolled_back_by": actor,
                                                               "published_at": None, "published_by": None}})
        await audit.log(actor, "import_rolled_back", batch_id=batch_id,
                        **res.model_dump(exclude={"batch_id", "dry_run", "conflicts"}), conflicts=len(res.conflicts))
    return res
