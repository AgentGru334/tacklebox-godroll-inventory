"""Exact-serial website linking, shared by the site router and import apply (kept here to avoid a router import cycle)."""

from datetime import datetime, timezone

from lib import audit
from lib.db import db


async def auto_link_serials(serials: list[str] | None, actor: str, batch_id: str | None = None) -> int:
    """Link catalog records whose serial exactly equals a website code."""
    flt: dict = {"site_item_id": None}
    if serials is not None:
        flt["serial"] = {"$in": serials}
    linked = 0
    async for item in db.catalog_items.find(flt, {"_id": 0}):
        code = await db.site_codes.find_one({"code": item["serial"]}, {"_id": 0})
        if not code:
            continue
        await db.catalog_items.update_one({"id": item["id"]}, {"$set": {
            "site_item_id": code["item_id"], "site_item_name": code.get("item_name") or "", "site_link_method": "exact_serial",
            "site_linked_by": actor, "site_linked_at": datetime.now(timezone.utc)}})
        await audit.log(actor, "site_linked", batch_id=batch_id, item=item, site_item_id=code["item_id"], method="exact_serial")
        linked += 1
    return linked
