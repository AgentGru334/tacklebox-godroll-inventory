# Tacklebox God Roll Inventory

Borderlands 4 God Roll Library card importer: FastAPI + MongoDB backend, React/Vite frontend, Clerk (Google) auth. This repo is the cleaned working copy after leaving Emergent, ready to deploy the API on Railway.

**Railway service root is `backend/`.** Start command and healthcheck are in `backend/railway.json`, `backend/Procfile`, and `backend/runtime.txt` (Python 3.11). Healthcheck path: `/health`.

## Docs

- [ENV_VARS.md](./ENV_VARS.md) — backend and frontend environment variables (placeholders only; no secrets).
- [DB_RESTORE.md](./DB_RESTORE.md) — how to restore MongoDB and card images. The mongodump is **not** in this repository; it stays with the owner in the original Emergent export zip.
- [TEST_PLAN.md](./TEST_PLAN.md) — sign-in, imports, OCR, rollback, audit, share links, CORS, and data-integrity checks before going public.
- [NOTES.md](./NOTES.md) — stack inventory, Emergent cleanup, measured document counts, blockers, and recommended Railway steps.

## Layout

```
backend/     FastAPI app (deploy this service)
frontend/    React 19 + Vite (Sites or a reverse proxy)
```

Do not commit `.env` files or the Mongo dump. See `.gitignore`.
