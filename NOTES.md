# God Roll Inventory — migration analysis and local prep

Prepared 2026-11-25 (America/Chicago). **Analysis + local prep only.** No Railway project, no deploys, no Clerk app, no external writes.

## Layout

| Path | What |
|---|---|
| `original/` | Untouched unzip of the Emergent export (keep as source of truth). |
| `app/` | Working copy with Emergent overlay/integrations removed and a configurable API base URL. |
| *(Mongo dump)* | **Not in the GitHub repo.** Kept on the owner's side in the original Emergent export zip. Locally it is at `original/migration/data/dump/`. |
| `ENV_VARS.md` | Every backend + frontend variable, purpose, placeholder. No real secrets. |
| `DB_RESTORE.md` | `mongorestore` steps, image plan, verification counts. |
| `TEST_PLAN.md` | Sign-in, imports, OCR, rollback, audit, share links, CORS, admin auth, integrity. |
| `app/backend/railway.json`, `Procfile`, `runtime.txt`, `nixpacks.toml` | FastAPI start command and `/health` check. Set the Railway service root to **`backend/`**. |

Frontend `yarn.lock` in `app/` was regenerated after removing `@emergentbase/*`. A local Python 3.11 venv lives at `app/backend/.venv/` and `node_modules` / `frontend/dist` are local build artifacts.

## Stack summary

- **Backend:** FastAPI (`backend/server.py` → `app`), Uvicorn, Motor/PyMongo, Pydantic v2. Python **3.11** (export guide; also required by pinned `rapidocr-onnxruntime==1.4.4`). Routes under `/api`, plus `GET /health` (added in the working copy).
- **Frontend:** React 19 + Vite 8 + TypeScript + Tailwind v4 + shadcn/ui. Scripts: `yarn dev` (port 3000, proxies `/api` → `:8001`), `yarn build` (`tsc -b && vite build`).
- **Auth:** Clerk already (Google only). Not Emergent session auth. The **Emergent-managed Clerk instance does not transfer** — create a new Clerk application. Frontend loads the publishable key from `GET /api/clerk/config`. `pk_live_*` enables the `/api/__clerk` Frontend API relay. Roles live in Mongo `users`; `ADMIN_EMAIL` is promoted on first sign-in.
- **OCR:** Local RapidOCR / ONNX (`backend/lib/ocr.py`). Evidence only; no third-party OCR/LLM key. Needs CPU/RAM (export: ≥2 vCPU / 2 GB).
- **Images:** Stored as WebP BinData in Mongo `card_images`, served at `GET /api/cards/{id}`. Not GridFS, not loose files, not an Emergent CDN.
- **Unused template deps** (still in `requirements.txt`, not imported by app code): `boto3`, `requests-oauthlib`, `pandas`, `openpyxl`, `jq`, `typer`, plus lint/test tooling. Safe later cleanup, not required for launch.
- `APP_URL` is documented but **not read by any backend file**. `APP_TZ` is optional (default UTC). `pillow` is now an explicit requirement (used by OCR).

## Data summary (measured from this zip)

`mongodump --gzip` of database **`app`**, MongoDB **7.0.45**.

| Collection | Docs | Notes |
|---|---:|---|
| `catalog_items` | 1,216 | `card` 1,199; `pending_placeholder` 17 |
| `card_images` | 2,398 | 1,199 card docs (no `kind` field) + 1,199 `kind=level_crop`. ~152.1 MiB BinData. Split as `card_images.bson.gz.part00` + `.part01` (join before restore). |
| `matches` | 1,199 | |
| `site_codes` | 1,669 | 1,493 `image_url`s host `tacklebox-god-roll-inventory.eric-monceaux.chatgpt.site` (website art, not the card library) |
| `audit` | 101 | |
| `batches` | 1 | already published; analysis_status length 4 (`done` likely) |
| `settings` | 1 | share-link token was stripped and the link disabled |
| `users` | 1 | includes an email field (PII). Clerk ids will not match a new Clerk app |
| `catalog_archive` | 0 | |
| `site_itemkey_map` | 0 | |

Export README claimed 2,373 images (subtracting 25 “shared” cards). Trust **2,398 documents**. Temporary collections (`upload_sessions`, `upload_chunks`, `stat_diffs`, `status_checks`) were not exported.

## Emergent-specific items

### Found (file:line in `original/`)

- `frontend/package.json:61-62` — `@emergentbase/overlay` and `@emergentbase/visual-edits` (tarballs from `assets.emergent.sh`)
- `frontend/vite.config.ts:5-28, 38-46, 95-103` — visual-edits plugin, branded error overlay, supervisor/`DISABLE_*` flags, polling, preview CORS comments
- `backend/requirements.txt:32` — `emergentintegrations==0.2.2` (**never imported**)
- `backend/clerk_auth.py:1-3, 108` — “Emergent-managed Clerk” docstring; `User-Agent: emergent-clerk-auth`
- `backend/routers/members.py:22, 41` — `ENV` preview/live split; `User-Agent: emergent-app`
- `README.md` — farm-ts starter + supervisord pod conventions (docs only; no supervisor config file in the zip)
- `memory/SPEC.md:6`, `migration/MIGRATION.md:30-31` — document the Emergent-managed Clerk instance
- No `index.html` overlay scripts, no `preview.emergentagent.com` URLs, no `EMERGENT_LLM` keys, no supervisor conf in the zip

### Removed in `app/` (clean)

- Emergent Vite plugins, overlay loader, and `DISABLE_*` / `CHOKIDAR_USEPOLLING` defaults from `vite.config.ts` (standard Vite + `/api` proxy remain)
- `@emergentbase/overlay` and `@emergentbase/visual-edits` from `package.json` (and the regenerated `yarn.lock`)
- Unused `emergentintegrations==0.2.2` from `requirements.txt`
- User-Agent strings changed to `tacklebox-godroll`; Clerk module docstring de-Emergentized
- Frontend API/image/upload URLs now go through `src/lib/config.ts` (`VITE_BACKEND_URL` → `API_BASE` / `cardImageUrl`)

### Needs a decision (not rewritten)

1. **New Clerk application** (required). Enable Google, set origins/redirects to the real domain(s), put keys in Railway. Old `users.user_id` values will not match.
2. **`/api/__clerk` relay vs Clerk custom domain.** The proxy is still in `clerk_auth.py` and turns on for `pk_live_*`. Alternative: attach a Clerk production domain / CNAME on `godroll.the-tacklebox.fish` and leave `proxy_url` empty (test-key behavior). Either works; pick one and configure Clerk accordingly.
3. **One origin vs split origin.** Recommended: reverse-proxy `/api` on `https://godroll.the-tacklebox.fish` to Railway and leave `VITE_BACKEND_URL` empty. If Sites and Railway stay on different hosts, set `VITE_BACKEND_URL` at **build time** and list every browser origin in `CORS_ORIGINS`.
4. **`site_codes` image host** `tacklebox-god-roll-inventory.eric-monceaux.chatgpt.site` — confirm it still serves those 1,493 URLs, or accept broken website thumbnails (Mongo card images are unaffected).
5. Whether to drop unused template Python deps (boto3, pandas, etc.).
6. Whether to move `resume_unfinished_analyses()` out of the blocking lifespan (it currently runs before the app yields and can delay `/health` after a restore if OCR work is pending).

## Environment variables

See `ENV_VARS.md`. Backend must have `MONGO_URL`, `DB_NAME`, Clerk keys, `CORS_ORIGINS`, `ADMIN_EMAIL`. Set `APP_URL` even though unused. Frontend only needs `VITE_BACKEND_URL` for a split-origin deploy.

## Secrets / PII in the zip (paths only, no values)

- No `.env` files with values (only `.env.example`).
- No matches for `sk_live_` / `sk_test_` / `pk_live_` / `pk_test_`, Mongo URIs with credentials, AWS access keys, PEM private keys, Emergent LLM keys, or JWT-like tokens in the code or dump (card image binaries were not scanned as text).
- PII: `original/migration/data/dump/app/users.bson.gz` contains **one** user document with an `email` field. Treat as personal data; do not commit it to a public repo without review.

## Local tests (this phase)

- **Backend install:** Failed on box Python 3.13 (`rapidocr-onnxruntime==1.4.4` requires `<3.13`). Succeeded in a **Python 3.11.18** venv (`uv python install 3.11`). `runtime.txt` pins `python-3.11` for Railway.
- **Import check:** `IMPORT_OK`. `GET /health` handler returns `{status: ok}`. OpenAPI lists 46 paths including `/api/`, clerk, cards, uploads, audit, worklist, site, etc. `RapidOCR` imports. Clerk config reports `enabled=false` without keys (expected). Full `uvicorn` boot was **not** run (no local MongoDB; `lib/db.py` connects at import and lifespan talks to Mongo on startup).
- **Frontend:** `yarn typecheck` and `yarn build` both succeeded (Vite 8.1.5, `frontend/dist` produced). One chunk-size warning (877 kB JS). Cosmetic OpenAPI warning: duplicate operation id on `clerk_proxy` (pre-existing).

## Blockers for go-live

- A new Clerk app and keys (cannot proceed with sign-in otherwise).
- Railway MongoDB 7.x + restore of the joined `card_images` dump.
- Decision on custom domain routing (proxy `/api` vs `VITE_BACKEND_URL`).
- Recreate the worklist share token; do not reuse any old URL.
- Confirm or replace the chatgpt.site image host for site-code thumbnails.

## Recommended next step (Railway)

1. Create a Railway project and add a **MongoDB 7.x** plugin.
2. Add a service from `app/backend/` (root directory = `backend`). Nixpacks will use `runtime.txt` (Python 3.11) and `railway.json` / `Procfile` (`uvicorn server:app --host 0.0.0.0 --port $PORT`, healthcheck `/health`). Give the service at least 2 vCPU / 2 GB, **one worker**.
3. Set `MONGO_URL` (plugin), `DB_NAME=tacklebox_card_injector`, `CORS_ORIGINS`, `APP_URL`, `ADMIN_EMAIL`. Clerk keys can wait until the Clerk app exists; `/health` and `/api/` work without them (auth routes will be inert).
4. Deploy the API and verify `GET /health` and `GET /api/`.
5. Follow `DB_RESTORE.md` (join parts, `mongorestore --nsFrom=app.* --nsTo=$DB_NAME.* --gzip`, run verification counts).
6. Create the Clerk app, set keys, re-deploy if needed, then smoke `GET /api/clerk/config`.
7. Build/deploy the frontend on Sites with the chosen `VITE_BACKEND_URL`, attach `godroll.the-tacklebox.fish`, run `TEST_PLAN.md` before opening it publicly.
