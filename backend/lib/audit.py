"""Append-only audit log."""

import uuid
from datetime import datetime, timezone

from lib.db import db


async def log(actor: str, action: str, *, batch_id=None, item: dict | None = None, site_item_id=None,
              previous_image_id=None, new_image_id=None, **details) -> None:
    await db.audit.insert_one({
        "id": str(uuid.uuid4()), "at": datetime.now(timezone.utc), "actor": actor, "action": action,
        "batch_id": batch_id,
        "catalog_item_id": item.get("id") if item else None,
        "serial": item.get("serial", "") if item else details.pop("serial", ""),
        "item_key": item.get("item_key", "") if item else details.pop("item_key", ""),
        "item_name": item.get("name", "") if item else details.pop("item_name", ""),
        "site_item_id": site_item_id, "previous_image_id": previous_image_id, "new_image_id": new_image_id,
        "details": details, "restored_at": None,
    })
