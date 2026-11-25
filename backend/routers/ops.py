"""Worklist status + read-only share link, quarantine, import notes and the stat-level card compare."""

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from lib import audit, ratelimit
from lib.db import db
from models.injector import (Batch, BatchNoteIn, CatalogItem, PublicStatusIn, PublicWorklist, PublicWorklistRow, QuarantineIn,
                             ShareIn, ShareStatus, StatDiff, StatDiffRow, WorklistStatusIn)
from routers.injector import _batch, _get_batch, _item, _who, admin_only, any_member

router = APIRouter()
SHARE_ID = "worklist_share"


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- worklist status: Pending -> In progress -> Regenerated (people) -> Verified -> Published (imports) ----------

@router.patch("/worklist/{item_id}/status", response_model=CatalogItem)
async def set_worklist_status(item_id: str, body: WorklistStatusIn, member: dict = Depends(any_member)):
    item = await db.catalog_items.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Record not found")
    if not item.get("needs_level70_refresh"):
        raise HTTPException(status_code=400, detail="This record is not on the regeneration worklist.")
    if item.get("regen_status") in ("verified", "published"):
        raise HTTPException(status_code=409, detail="Verified and Published are set by imports; this card is already past Regenerated.")
    await db.catalog_items.update_one({"id": item_id}, {"$set": {
        "regen_status": body.status, "regen_status_by": _who(member), "regen_status_at": _now()}})
    await audit.log(_who(member), "worklist_status", item=item, before=item.get("regen_status") or "pending", after=body.status)
    return _item(await db.catalog_items.find_one({"id": item_id}, {"_id": 0}))


# ---------- read-only share link ----------

def _share(doc: dict | None) -> ShareStatus:
    if not doc:
        return ShareStatus(enabled=False)
    at = doc.get("created_at")
    if isinstance(at, datetime) and at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return ShareStatus(enabled=doc.get("enabled", False), token=doc.get("token") if doc.get("enabled") else None,
                       created_by=doc.get("created_by"), created_at=at)


@router.get("/worklist/share", response_model=ShareStatus)
async def get_share(member: dict = Depends(admin_only)):
    return _share(await db.settings.find_one({"id": SHARE_ID}, {"_id": 0}))


@router.post("/worklist/share", response_model=ShareStatus)
async def set_share(body: ShareIn, member: dict = Depends(admin_only)):
    doc = await db.settings.find_one({"id": SHARE_ID}, {"_id": 0}) or {}
    upd: dict = {"enabled": body.enabled}
    if body.enabled and (body.regenerate or not doc.get("token")):
        upd.update({"token": secrets.token_urlsafe(24), "created_by": _who(member), "created_at": _now()})
    await db.settings.update_one({"id": SHARE_ID}, {"$set": upd}, upsert=True)
    await audit.log(_who(member), "worklist_share_" + ("on" if body.enabled else "off"), new_link=bool(upd.get("token")))
    return _share(await db.settings.find_one({"id": SHARE_ID}, {"_id": 0}))


async def _check_token(token: str) -> None:
    doc = await db.settings.find_one({"id": SHARE_ID}, {"_id": 0})
    if not token or not doc or not doc.get("enabled") or not secrets.compare_digest(doc.get("token") or "", token):
        raise HTTPException(status_code=404, detail="This share link is off or no longer valid.")


# The share token travels in the X-Share-Token header (never in the API path), so it stays out of access logs.

@router.post("/public/worklist/status", response_model=PublicWorklistRow)
async def public_mark_in_progress(body: PublicStatusIn, request: Request,
                                  x_share_token: str = Header("", max_length=128)):
    """Share-link visitors (no account) may only move a Pending card to In progress, under a typed name.
    Rate-limited per visitor IP (10/min, 60/hour) and per link (300/hour)."""
    await _check_token(x_share_token)
    ip = ratelimit.client_ip(request)
    ratelimit.check(f"ip-min:{ip}", 10, 60)
    ratelimit.check(f"ip-hour:{ip}", 60, 3600)
    ratelimit.check("link-hour", 300, 3600)
    item = await db.catalog_items.find_one({"serial": body.serial, "needs_level70_refresh": True}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="That card isn't on the worklist.")
    if (item.get("regen_status") or "pending") != "pending":
        raise HTTPException(status_code=409, detail="Only Pending cards can be marked In progress from the share link.")
    who = f"{body.name.strip()} (share link)"
    await db.catalog_items.update_one({"id": item["id"]}, {"$set": {
        "regen_status": "in_progress", "regen_status_by": who, "regen_status_at": _now()}})
    await audit.log(who, "worklist_status", item=item, before="pending", after="in_progress", via="share_link")
    return PublicWorklistRow(name=item["name"], serial=item["serial"], item_key=item.get("item_key", ""),
                             item_type=item.get("item_type", ""), status="in_progress", by=who)


@router.get("/public/worklist", response_model=PublicWorklist)
async def public_worklist(x_share_token: str = Header("", max_length=128)):
    """No sign-in. Names, serials and status only: no images, warnings or admin data."""
    await _check_token(x_share_token)
    items = await db.catalog_items.find({"needs_level70_refresh": True}, {"_id": 0}).sort("name", 1).to_list(None)
    return PublicWorklist(generated_at=_now(), rows=[
        PublicWorklistRow(name=i["name"], serial=i["serial"], item_key=i.get("item_key", ""), item_type=i.get("item_type", ""),
                          status=i.get("regen_status") or "pending",
                          # only names typed on the share link are shown publicly, never team emails
                          by=i["regen_status_by"] if (i.get("regen_status_by") or "").endswith("(share link)") else None)
            for i in items])


# ---------- quarantine ----------

@router.post("/catalog/{item_id}/quarantine", response_model=CatalogItem)
async def quarantine(item_id: str, body: QuarantineIn, member: dict = Depends(admin_only)):
    item = await db.catalog_items.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Record not found")
    if body.quarantined and not body.reason.strip():
        raise HTTPException(status_code=400, detail="Give a reason for the quarantine.")
    await db.catalog_items.update_one({"id": item_id}, {"$set": {
        "quarantined": body.quarantined, "quarantine_reason": body.reason.strip() if body.quarantined else ""}})
    await audit.log(_who(member), "quarantined" if body.quarantined else "quarantine_released", item=item, reason=body.reason.strip())
    return _item(await db.catalog_items.find_one({"id": item_id}, {"_id": 0}))


# ---------- import notes ----------

@router.patch("/batches/{batch_id}/note", response_model=Batch)
async def set_batch_note(batch_id: str, body: BatchNoteIn, member: dict = Depends(any_member)):
    b = await _get_batch(batch_id)
    await db.batches.update_one({"id": batch_id}, {"$set": {"note": body.note.strip()}})
    await audit.log(_who(member), "import_note_edited", batch_id=batch_id, before=b.get("note", ""), after=body.note.strip())
    return _batch(await _get_batch(batch_id))


# ---------- compare: read the stats on both cards and list what changed ----------

@router.get("/matches/{match_id}/stat-diff", response_model=StatDiff)
async def stat_diff(match_id: str, member: dict = Depends(any_member)):
    from routers.injector import list_matches
    m = await db.matches.find_one({"id": match_id}, {"_id": 0, "batch_id": 1})
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    full = next((x for x in await list_matches(m["batch_id"], member) if x.id == match_id), None)
    if not full or not full.compare_image_id or not full.image_id:
        raise HTTPException(status_code=400, detail="There is no older card to compare with.")
    old_id, new_id = full.compare_image_id, full.image_id
    cached = await db.stat_diffs.find_one({"old": old_id, "new": new_id}, {"_id": 0})
    if not cached:
        from lib.ocr import read_card_text
        from lib.statdiff import diff_cards
        imgs = {d["id"]: bytes(d["data"]) for d in await db.card_images.find({"id": {"$in": [old_id, new_id]}}, {"_id": 0}).to_list(2)}
        if len(imgs) < 2:
            raise HTTPException(status_code=404, detail="Card image missing")
        old = await run_in_threadpool(read_card_text, imgs[old_id])
        new = await run_in_threadpool(read_card_text, imgs[new_id])
        cached = {"old": old_id, "new": new_id, "rows": diff_cards(old, new), "at": _now()}
        await db.stat_diffs.insert_one(dict(cached))
    rows = [StatDiffRow(**r) for r in cached["rows"]]
    return StatDiff(match_id=match_id, old_image_id=old_id, new_image_id=new_id, changed=sum(r.changed for r in rows), rows=rows)
