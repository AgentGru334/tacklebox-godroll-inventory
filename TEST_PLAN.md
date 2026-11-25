# Test plan — God Roll Inventory (post-migration)

Run after the Railway API is up, data is restored, a new Clerk app is configured, and the frontend is pointed at the API (Sites or local with `VITE_BACKEND_URL`). Do not open the app to the public until this passes.

## 0. Prerequisites

- Backend health: `GET https://<api>/health` → `{ "status": "ok" }` and `GET /api/` → `{ "message": "Tacklebox Card Injector API" }`.
- Restore counts match `DB_RESTORE.md` §3.
- Clerk: new application, Google social connection, allowed origins/redirects include the frontend origin(s) and `https://godroll.the-tacklebox.fish`. Keys set on the API. `GET /api/clerk/config` returns `enabled: true` and a publishable key (the key itself is public by design).
- `CORS_ORIGINS` includes every browser origin that will call the API.
- `ADMIN_EMAIL` is the owner’s Google email.

## 1. Sign-in and roles

- Signed-out: `/sign-in` and `/sign-up` work; other app pages redirect to sign-in.
- Google sign-in succeeds on the new Clerk app.
- First sign-in of `ADMIN_EMAIL` creates a `users` row with role `admin`. `GET /api/me` shows admin.
- A second Google account becomes `reviewer`.
- Reviewer is rejected (403) on admin-only actions (apply, rollback, restore, audit, roles, quarantine, website codes, itemKey map, link/unlink, bulk accept, admin queue, share-link toggle). See `migration/MIGRATION.md` §3.
- Session expiry: stale Bearer token returns 401 and the UI prompts to sign in again.
- After a new Clerk app, old Emergent Clerk user ids must not be treated as valid sessions.

## 2. Imports

- Catalog list: 1,216 items, 1,199 with cards, 17 Card pending.
- Dry-run ZIP upload (resumable chunked upload included): preview is produced; catalog is not mutated until an admin types `INJECT-CONFIRM`.
- A reviewer can upload/preview but cannot apply.
- Apply with the confirm phrase writes to this app’s library only (“direct upload” is simulated and must not deploy anywhere).
- Interrupted upload: re-selecting the same file resumes missing chunks.

## 3. OCR

- OCR is local RapidOCR / ONNX (`backend/lib/ocr.py`). No third-party OCR key.
- Analyzing a batch fills `ocr_status`, level text/confidence, name score, and stores a `kind=level_crop` image.
- OCR never overwrites manifest serial, itemKey, name, or level.
- A `level_unreadable` / `ocr_name_conflict` flag is reviewable. A reviewer can set a level decision (`approve_70`, `ocr_misread`, `require_regeneration`).
- If the service restarts mid-analysis, unfinished `ocr_status=pending` matches resume. Note: resume currently runs in the FastAPI lifespan **before** the app yields, so a large resume can delay `/health`. Watch the first boot after restore.

## 4. Rollback

- Whole-import rollback requires the typed phrase `ROLLBACK-CONFIRM` and admin role.
- After rollback, applied catalog rows are undone and removed records appear in `catalog_archive`.
- A second rollback of the same batch is a safe no-op or a clear error (no silent partial state).
- UI `RollbackButton` is hidden/disabled for reviewers.

## 5. Audit logs

- Admin can list `GET /api/audit` (export has 101 entries).
- New import / rollback / restore / role / quarantine actions append rows (append-only).
- `POST /api/audit/{entry_id}/restore` (admin) restores the previous card image when `previous_image_id` exists; reviewer gets 403.
- Audit images render via `cardImageUrl` (must work in a split-origin setup, not only `/api/cards/...` on the Sites host).

## 6. Share links

- Admin can enable/disable `GET/POST /api/worklist/share`.
- The exported token was stripped; create a **new** token. Old URLs must fail.
- Public routes: `GET /api/public/worklist` and `POST /api/public/worklist/status` with `X-Share-Token`. No Clerk session required.
- Invalid or missing token is rejected. Rate limiter in `lib/ratelimit.py` is in-memory: use **one uvicorn worker per instance** (or move it to Redis) or limits will not be shared.

## 7. CORS and split origin

- From the Sites origin, a browser `GET /api/` and a signed-in `GET /api/me` succeed (correct `Access-Control-Allow-Origin`).
- A request from a random origin is denied.
- Card images and chunked uploads hit `VITE_BACKEND_URL` when it is set (not the Sites host).
- Preferred long-term: serve the SPA and `/api` on `https://godroll.the-tacklebox.fish` (reverse proxy). Then `VITE_BACKEND_URL` can be empty; still set `CORS_ORIGINS` to that origin.

## 8. Auth on admin routes

Spot-check without a token and with a reviewer token (expect 401 / 403):

- `POST /api/batches/{id}/direct-upload`
- `POST /api/batches/{id}/rollback`
- `GET /api/audit`, `POST /api/audit/{id}/restore`
- `GET /api/users`, `PATCH /api/users/{id}/role`
- `POST /api/site/import`, `POST /api/site/link`, `POST /api/site/links/accept`
- `POST /api/catalog/{id}/quarantine`
- `GET /api/admin/queue`, `POST /api/worklist/share`

Public (no token): `GET /health`, `GET /api/`, `GET /api/clerk/config`, `GET /api/cards/{id}`, share-link routes with a valid token.

## 9. Data integrity

- Re-run the mongosh counts in `DB_RESTORE.md` §3 after smoke tests (especially after a deliberate import+rollback).
- Open a gallery/worklist card and confirm the WebP is the expected art (not a broken Sites-relative URL).
- Site-code count stays 1,669; linking does not invent itemKeys (identity is serial + itemKey exact).
- Pre-publish validation: a card publishes only if it is level 70, verified (OCR or a level decision), has no uncertain code, and is not quarantined. A missing website link only warns.
- `site_codes.image_url` host `tacklebox-god-roll-inventory.eric-monceaux.chatgpt.site` is still reachable, or the team accepts that those thumbnails may 404.

## 10. Local checks already run in this phase

See `NOTES.md` for results of the offline import/build checks. Those are not a substitute for the live tests above.
