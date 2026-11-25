"""Resumable chunked ZIP uploads: chunks persist in Mongo, so a dropped phone connection or a closed
browser resumes with only the missing chunks."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from lib.db import db
from models.injector import Batch, UploadInit, UploadSession
from routers.injector import MAX_ZIP_BYTES, any_member, create_batch

router = APIRouter()


async def _session(upload_id: str, member: dict) -> dict:
    s = await db.upload_sessions.find_one({"id": upload_id}, {"_id": 0})
    if not s or s["created_by"] != member["user_id"]:
        raise HTTPException(status_code=404, detail="Upload not found")
    return s


def _out(s: dict) -> UploadSession:
    return UploadSession(**{k: s.get(k) for k in UploadSession.model_fields})


@router.post("/uploads", response_model=UploadSession)
async def init_upload(body: UploadInit, member: dict = Depends(any_member)):
    if body.size > MAX_ZIP_BYTES:
        raise HTTPException(status_code=413, detail="ZIP is larger than 1.5 GB.")
    s = {"id": str(uuid.uuid4()), "filename": body.filename, "size": body.size, "chunk_size": body.chunk_size,
         "total_chunks": -(-body.size // body.chunk_size), "received": [], "status": "uploading", "batch_id": None,
         "add_to_catalog": body.add_to_catalog, "note": body.note, "created_by": member["user_id"], "created_at": datetime.now(timezone.utc)}
    await db.upload_sessions.insert_one(dict(s))
    return _out(s)


@router.get("/uploads/{upload_id}", response_model=UploadSession)
async def get_upload(upload_id: str, member: dict = Depends(any_member)):
    return _out(await _session(upload_id, member))


@router.put("/uploads/{upload_id}/chunks/{n}", response_model=UploadSession)
async def put_chunk(upload_id: str, n: int, request: Request, member: dict = Depends(any_member)):
    s = await _session(upload_id, member)
    if s["status"] != "uploading":
        raise HTTPException(status_code=409, detail="Upload already completed")
    if not 0 <= n < s["total_chunks"]:
        raise HTTPException(status_code=400, detail="Chunk out of range")
    data = await request.body()
    expected = s["chunk_size"] if n < s["total_chunks"] - 1 else s["size"] - s["chunk_size"] * (s["total_chunks"] - 1)
    if len(data) != expected:
        raise HTTPException(status_code=400, detail=f"Chunk {n} has {len(data)} bytes, expected {expected}")
    await db.upload_chunks.update_one({"upload_id": upload_id, "n": n}, {"$set": {"data": data}}, upsert=True)
    await db.upload_sessions.update_one({"id": upload_id}, {"$addToSet": {"received": n}})
    return _out(await _session(upload_id, member))


@router.post("/uploads/{upload_id}/complete", response_model=Batch)
async def complete_upload(upload_id: str, member: dict = Depends(any_member)):
    s = await _session(upload_id, member)
    if s["status"] == "complete" and s.get("batch_id"):
        from routers.injector import get_batch
        return await get_batch(s["batch_id"], member)
    missing = sorted(set(range(s["total_chunks"])) - set(s["received"]))
    if missing:
        raise HTTPException(status_code=409, detail=f"{len(missing)} chunk(s) still missing")
    parts = []
    async for c in db.upload_chunks.find({"upload_id": upload_id}, {"_id": 0, "n": 1, "data": 1}).sort("n", 1):
        parts.append(bytes(c["data"]))
    batch = await create_batch(b"".join(parts), s["filename"], member, s.get("add_to_catalog", True), s.get("note", ""))
    await db.upload_sessions.update_one({"id": upload_id}, {"$set": {"status": "complete", "batch_id": batch.id}})
    await db.upload_chunks.delete_many({"upload_id": upload_id})  # temp chunks of this finished upload only
    return batch
