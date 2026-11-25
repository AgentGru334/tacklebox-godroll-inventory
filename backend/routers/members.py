"""Roles (admin / reviewer), the current member, and the admin Users page."""

import os

import requests
from fastapi import APIRouter, Depends, HTTPException
from pymongo import ReturnDocument
from starlette.concurrency import run_in_threadpool

from clerk_auth import require_user
from lib.db import db
from models.injector import Me, RoleIn, UserList, UserRow

router = APIRouter()

# The role list is code, so every publish ships it to Live. Highest first; keep `admin`.
ROLES = ["admin", "reviewer"]
DEFAULT_ROLE = "reviewer"
RETIRED_ROLES: dict[str, str] = {}
RANK = {r: len(ROLES) - i for i, r in enumerate(ROLES)}

ENV = "live" if os.environ.get("CLERK_PUBLISHABLE_KEY", "").startswith("pk_live_") else "preview"
IN_ENV = {"env": {"$in": [ENV, None]}}


def effective_role(role) -> str:
    role = RETIRED_ROLES.get(role, role)
    return role if role in ROLES else DEFAULT_ROLE


async def move_retired_roles() -> None:
    for old, new in RETIRED_ROLES.items():
        await db.users.update_many({"role": old}, {"$set": {"role": new}})


def _clerk_profile(user_id: str) -> tuple[bool, str, str]:
    """One Clerk lookup on first sign-in: (is_admin_email, primary_email, name)."""
    admins = {e.strip().lower() for e in os.environ.get("ADMIN_EMAIL", "").split(",") if e.strip()}
    r = requests.get(
        f"https://api.clerk.com/v1/users/{user_id}", timeout=10,
        headers={"Authorization": f"Bearer {os.environ['CLERK_SECRET_KEY']}", "User-Agent": "tacklebox-godroll"},
    )
    r.raise_for_status()
    data = r.json()
    emails = data.get("email_addresses") or []
    is_admin = any(
        e["email_address"].lower() in admins and (e.get("verification") or {}).get("status") == "verified"
        for e in emails
    )
    primary = next((e["email_address"] for e in emails if e.get("id") == data.get("primary_email_address_id")), "")
    if not primary and emails:
        primary = emails[0]["email_address"]
    name = " ".join(p for p in [data.get("first_name"), data.get("last_name")] if p)
    return is_admin, primary, name


async def current_member(user: dict = Depends(require_user)) -> dict:
    uid = user["user_id"]
    member = await db.users.find_one({"user_id": uid}, {"_id": 0})
    if member is None or not member.get("role"):
        is_admin, email, name = await run_in_threadpool(_clerk_profile, uid)
        role = "admin" if is_admin else DEFAULT_ROLE
        await db.users.update_one({"user_id": uid, "role": {"$in": [None, ""]}}, {"$set": {"role": role}})
        member = await db.users.find_one_and_update(
            {"user_id": uid},
            {"$setOnInsert": {"user_id": uid, "role": role}, "$set": {"email": email, "name": name}},
            upsert=True, projection={"_id": 0}, return_document=ReturnDocument.AFTER,
        )
    if member.get("env") != ENV:
        await db.users.update_one({"user_id": uid}, {"$set": {"env": ENV}})
    return {**member, "env": ENV, "role": effective_role(member["role"])}


def require_role(*roles: str):
    async def check(member: dict = Depends(current_member)) -> dict:
        if member["role"] not in roles:
            raise HTTPException(status_code=403, detail="Not allowed")
        return member
    return check


@router.get("/me", response_model=Me)
async def me(member: dict = Depends(current_member)):
    return Me(user_id=member["user_id"], role=member["role"],
              email=member.get("email") or "", name=member.get("name") or "")


@router.get("/users", response_model=UserList)
async def list_users(admin: dict = Depends(require_role("admin"))):
    people = await db.users.find(IN_ENV, {"_id": 0}).to_list(1000)
    return UserList(
        roles=[r for r in ROLES if RANK[r] <= RANK[admin["role"]]],
        users=[UserRow(user_id=p["user_id"], email=p.get("email") or "", name=p.get("name") or "",
                       role=effective_role(p.get("role"))) for p in people],
    )


@router.patch("/users/{user_id}/role")
async def set_role(user_id: str, body: RoleIn, admin: dict = Depends(require_role("admin"))):
    if body.role not in ROLES or RANK[body.role] > RANK[admin["role"]]:
        raise HTTPException(status_code=403, detail="Not allowed")
    target = await db.users.find_one({"user_id": user_id, **IN_ENV}, {"_id": 0})
    if target is None:
        raise HTTPException(status_code=404, detail="Not found")
    if (effective_role(target.get("role")) == "admin" and body.role != "admin"
            and await db.users.count_documents({"role": "admin", **IN_ENV}) <= 1):
        raise HTTPException(status_code=409, detail="Keep at least one admin")
    await db.users.update_one({"user_id": user_id}, {"$set": {"role": body.role}})
    return {"user_id": user_id, "role": body.role}
