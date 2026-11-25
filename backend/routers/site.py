"""God Roll website item linking. Exact serial (website code) links automatically; name/prefix
similarity is only ever a suggestion. Manual + bulk linking by website item ID or URL."""

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException

from lib import audit
from lib.sitelinks import auto_link_serials
from lib.db import db
from models.injector import (BulkAcceptIn, BulkAcceptResult, CatalogItem, ItemKeyMapIn, ItemKeyMapResult, LinkIn,
                             LinkResult, SiteImportResult, SiteItem, UnlinkedItem)
from routers.injector import _item, _who, admin_only, any_member

router = APIRouter()


def _clean_category(c: str) -> str:
    return re.sub(r"^[^A-Za-z0-9]+", "", c or "").strip()


async def _site_items() -> list[dict]:
    pipeline = [{"$group": {"_id": "$item_id", "item_name": {"$first": "$item_name"},
                            "manufacturer": {"$first": "$manufacturer"}, "category": {"$first": "$category"},
                            "code_count": {"$sum": 1}}}]
    return [{"item_id": d["_id"], "item_name": d["item_name"] or "", "manufacturer": d["manufacturer"] or "",
             "category": _clean_category(d["category"]), "code_count": d["code_count"]}
            async for d in db.site_codes.aggregate(pipeline)]


@router.post("/site/import", response_model=SiteImportResult)
async def import_site_codes(payload: dict = Body(...), member: dict = Depends(admin_only)):
    codes = payload.get("codes") if isinstance(payload, dict) else None
    if not isinstance(codes, list) or not codes:
        raise HTTPException(status_code=422, detail='Expected the TB codes export: { "codes": [ ... ] }')
    rows = []
    for c in codes:
        if isinstance(c, dict) and c.get("code") and c.get("item_id"):
            row = {k: str(c.get(k) or "") for k in ("code", "item_id", "item_name", "manufacturer",
                                                    "category", "variant_label", "image_url")}
            row["item_key"] = _norm_key(str(c.get("item_key") or c.get("itemKey") or c.get("itemkey") or ""))
            rows.append(row)
    if not rows:
        raise HTTPException(status_code=422, detail="No codes with both code and item_id")
    await db.site_codes.delete_many({})  # explicit admin re-import of the website code list
    await db.site_codes.insert_many(rows)
    linked = await auto_link_serials(None, _who(member))
    await audit.log(_who(member), "site_codes_imported", codes=len(rows), auto_linked=linked)
    return SiteImportResult(codes=len(rows), items=len({r["item_id"] for r in rows}), auto_linked=linked,
                            with_item_key=sum(1 for r in rows if r["item_key"]))


@router.post("/site/itemkey-map", response_model=ItemKeyMapResult)
async def import_itemkey_map(body: ItemKeyMapIn, member: dict = Depends(admin_only)):
    """Upload an itemKey -> website item map (replaces the previous map). Exact itemKey matches become
    high-confidence suggestions; nothing is linked until someone accepts them."""
    known = {i["item_id"] for i in await _site_items()}
    rows, invalid, unknown = {}, 0, 0
    for r in body.rows:
        key = _norm_key(r.item_key)
        nums = re.findall(r"\d{6,}", r.site_item)
        if len(key) != 32 or not nums:
            invalid += 1
            continue
        if nums[-1] not in known:
            unknown += 1
            continue
        rows[key] = {"item_key": key, "item_id": nums[-1]}
    await db.site_itemkey_map.delete_many({})  # explicit admin re-upload of the map
    if rows:
        await db.site_itemkey_map.insert_many(list(rows.values()))
    high = sum(1 for u in await _evaluate_unlinked() if u.confidence == "high")
    await audit.log(_who(member), "itemkey_map_imported", saved=len(rows), invalid=invalid, unknown_site_items=unknown)
    return ItemKeyMapResult(saved=len(rows), invalid=invalid, unknown_site_items=unknown, high_confidence_now=high)


@router.get("/site/items", response_model=list[SiteItem])
async def list_site_items(member: dict = Depends(any_member)):
    return [SiteItem(**i) for i in sorted(await _site_items(), key=lambda i: i["item_name"])]


def _tokens(s: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", s.lower()) if t]


def _suggest(name: str, items: list[dict]) -> tuple[dict | None, str]:
    """Best website item whose name ends the catalog name (BL4: prefixes + base name), else token overlap."""
    toks = _tokens(name)
    best, best_score, why = None, 0.0, ""
    for it in items:
        it_t = _tokens(it["item_name"])
        if not it_t:
            continue
        if len(it_t) <= len(toks) and toks[-len(it_t):] == it_t:
            score, reason = 1.0 + len(it_t) / 10, f"name ends with “{it['item_name']}” (prefixes ignored)"
        else:
            overlap = len(set(it_t) & set(toks)) / len(set(it_t) | set(toks))
            score, reason = overlap, f"{round(overlap * 100)}% word overlap with “{it['item_name']}”"
        if score > best_score:
            best, best_score, why = it, score, reason
    return (best, why) if best_score >= 0.5 else (None, "")


def _norm_key(k: str) -> str:
    k = k.strip().lower().removeprefix("item_").replace("-", "")
    return k if re.fullmatch(r"[0-9a-f]{32}", k) else ""


async def _code_index() -> dict[str, tuple[dict, str]]:
    """Every itemKey / image code -> (code row, basis). Sources, strongest first: the uploaded
    itemKey map, an itemKey column in the codes file, then 32-hex codes found inside code rows."""
    idx: dict[str, tuple[dict, str]] = {}
    async for m in db.site_itemkey_map.find({}, {"_id": 0}):
        idx[m["item_key"]] = ({"item_id": m["item_id"], "source": "itemKey map"}, "item_key")
    async for c in db.site_codes.find({"item_key": {"$nin": ["", None]}}, {"_id": 0}):
        idx.setdefault(c["item_key"], ({**c, "source": "codes file itemKey column"}, "item_key"))
    async for c in db.site_codes.find({}, {"_id": 0}):
        for field, basis in (("image_url", "image_code"), ("code", "item_key"), ("variant_label", "item_key")):
            for tok in re.findall(r"[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}", c.get(field) or ""):
                idx.setdefault(tok.replace("-", "").lower(), (c, basis))
    return idx


def _name_fits(name: str, site_name: str) -> bool:
    a, b = _tokens(name), _tokens(site_name)
    if b and len(b) <= len(a) and a[-len(b):] == b:
        return True
    return bool(a and b) and len(set(a) & set(b)) / len(set(a) | set(b)) >= 0.5


def _evaluate(d: dict, items: list[dict], by_id: dict[str, dict], idx: dict) -> UnlinkedItem:
    """High confidence = exact itemKey or image-code match with no conflicting name, manufacturer or
    existing link. Name-based suggestions are medium (suffix match) or low (word overlap) and always
    need a person to confirm them one by one."""
    key = (d.get("item_key") or "").lower().removeprefix("item_")
    hit = idx.get(key) if key else None
    if hit and hit[0]["item_id"] in by_id:
        code, basis = hit
        site = by_id[code["item_id"]]
        conflicts = []
        if not _name_fits(d["name"], site["item_name"]):
            conflicts.append(f"name differs: website says “{site['item_name']}”")
        if d.get("manufacturer") and site["manufacturer"] and d["manufacturer"].lower() != site["manufacturer"].lower():
            conflicts.append(f"manufacturer differs: {d['manufacturer']} vs {site['manufacturer']}")
        if d.get("site_item_id"):
            conflicts.append("record already has a website link")
        what = "itemKey" if basis == "item_key" else "image code"
        src = f" (from the {code['source']})" if code.get("source") else ""
        return UnlinkedItem(item=_item(d), suggestion=SiteItem(**site), suggestion_basis=basis,
                            confidence="medium" if conflicts else "high", conflicts=conflicts,
                            suggestion_reason=f"exact {what} match ({key[:10]}…){src} for website item “{site['item_name']}”")
    sug, why = _suggest(d["name"], items)
    if not sug:
        return UnlinkedItem(item=_item(d))
    suffix = why.startswith("name ends")
    return UnlinkedItem(item=_item(d), suggestion=SiteItem(**sug), suggestion_reason=why, suggestion_basis="name",
                        confidence="medium" if suffix else "low",
                        conflicts=[] if suffix else ["only some words match"])


async def _evaluate_unlinked(ids: list[str] | None = None) -> list[UnlinkedItem]:
    items = await _site_items()
    by_id = {i["item_id"]: i for i in items}
    idx = await _code_index()
    flt: dict = {"site_item_id": None}
    if ids is not None:
        flt["id"] = {"$in": ids}
    docs = await db.catalog_items.find(flt, {"_id": 0}).sort("name", 1).to_list(None)
    return [_evaluate(d, items, by_id, idx) for d in docs]


@router.get("/site/unlinked", response_model=list[UnlinkedItem])
async def unlinked_queue(member: dict = Depends(any_member)):
    return await _evaluate_unlinked()


@router.post("/site/links/accept", response_model=BulkAcceptResult)
async def bulk_accept(body: BulkAcceptIn, member: dict = Depends(admin_only)):
    """Bulk-accept suggestions, high-confidence only. Anything else is skipped with its reason."""
    if body.mode == "selected" and not body.catalog_item_ids:
        raise HTTPException(status_code=400, detail="Select at least one record")
    rows = await _evaluate_unlinked(body.catalog_item_ids if body.mode == "selected" else None)
    linked, skipped = 0, []
    now = datetime.now(timezone.utc)
    for r in rows:
        if r.confidence != "high" or not r.suggestion:
            if body.mode == "selected":
                why = "no suggestion" if not r.suggestion else (f"{r.confidence} confidence, confirm it on its own")
                skipped.append(f"{r.item.name}: {why}")
            continue
        await db.catalog_items.update_one({"id": r.item.id, "site_item_id": None}, {"$set": {
            "site_item_id": r.suggestion.item_id, "site_item_name": r.suggestion.item_name, "site_link_method": "bulk_high_confidence",
            "site_linked_by": _who(member), "site_linked_at": now}})
        await audit.log(_who(member), "site_linked", item=r.item.model_dump(), site_item_id=r.suggestion.item_id,
                        method="bulk_high_confidence", basis=r.suggestion_basis, reason=r.suggestion_reason)
        linked += 1
    return BulkAcceptResult(linked=linked, skipped=len(skipped), skipped_reasons=skipped[:50])


def _parse_site_item(ref: str) -> str:
    ref = ref.strip()
    if ref.isdigit():
        return ref
    nums = re.findall(r"\d{6,}", ref)
    if not nums:
        raise HTTPException(status_code=400, detail="Enter a website item ID or a URL that contains it")
    return nums[-1]


@router.post("/site/link", response_model=LinkResult)
async def link_items(body: LinkIn, member: dict = Depends(admin_only)):
    item_id = _parse_site_item(body.site_item)
    site = next((i for i in await _site_items() if i["item_id"] == item_id), None)
    if not site:
        raise HTTPException(status_code=404, detail=f"Website item {item_id} is not in the imported website code list")
    method = "bulk" if len(body.catalog_item_ids) > 1 else "manual"
    docs = await db.catalog_items.find({"id": {"$in": body.catalog_item_ids}}, {"_id": 0}).to_list(None)
    for d in docs:
        await db.catalog_items.update_one({"id": d["id"]}, {"$set": {
            "site_item_id": item_id, "site_item_name": site["item_name"], "site_link_method": method,
            "site_linked_by": _who(member), "site_linked_at": datetime.now(timezone.utc)}})
        await audit.log(_who(member), "site_linked", item=d, site_item_id=item_id, method=method,
                        previous_site_item_id=d.get("site_item_id"))
    return LinkResult(linked=len(docs), site_item=SiteItem(**site))


@router.delete("/site/link/{catalog_item_id}", response_model=CatalogItem)
async def unlink_item(catalog_item_id: str, member: dict = Depends(admin_only)):
    d = await db.catalog_items.find_one({"id": catalog_item_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Record not found")
    await db.catalog_items.update_one({"id": catalog_item_id}, {"$set": {"site_item_id": None, "site_item_name": "", "site_link_method": None}})
    await audit.log(_who(member), "site_unlinked", item=d, site_item_id=d.get("site_item_id"))
    return _item(await db.catalog_items.find_one({"id": catalog_item_id}, {"_id": 0}))
