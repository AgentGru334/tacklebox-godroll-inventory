# Environment variables

No real secrets are included. Placeholders only. Set backend vars on the Railway API service. Set frontend vars at **build time** for Sites (Vite inlines `VITE_*`).

## Backend (Railway)

| Variable | Required | Purpose | Example / placeholder |
|---|---|---|---|
| `MONGO_URL` | yes | MongoDB connection string. Railway plugin usually injects this when the service is linked. | `mongodb://mongo:pass@hostname:27017` or the plugin-provided URL |
| `DB_NAME` | yes | Database name to use after restore. Dump was exported from `app`; restore remaps with `--nsFrom/--nsTo`. | `tacklebox_card_injector` |
| `CLERK_PUBLISHABLE_KEY` | yes (auth) | Clerk publishable key. Frontend loads it from `GET /api/clerk/config`. `pk_live_*` also enables the `/api/__clerk` Frontend API relay. | `pk_test_...` or `pk_live_...` |
| `CLERK_SECRET_KEY` | yes (auth) | Clerk secret key. Used to fetch JWKS, look up users on first sign-in, and (for `pk_live_`) the clerk proxy. | `sk_test_...` or `sk_live_...` |
| `CORS_ORIGINS` | yes if split origin | Comma-separated browser origins allowed to call the API **and** accepted as Clerk token `azp`. Must include the Sites origin and the custom subdomain. Do not use `*`. | `https://godroll.the-tacklebox.fish,https://your-frontend.sites.example` |
| `APP_URL` | documented, **unused by code** | Public base URL of the app. Listed in the export guide and `.env.example`; no backend file currently reads it. Set it anyway so it is present if a later change needs it. | `https://godroll.the-tacklebox.fish` |
| `ADMIN_EMAIL` | yes (bootstrap) | Comma-separated Google account emails promoted to `admin` on first sign-in. Everyone else starts as `reviewer`. | `owner@example.com` |
| `APP_TZ` | no | Timezone for "today" date helpers (`lib/dates.py`). Defaults to `UTC`. | `America/Chicago` |
| `PORT` | set by Railway | Listen port for uvicorn. Already referenced in `Procfile` / `railway.json`. | Railway injects this |

Auth is a Bearer token, not cookies (`CORSMiddleware.allow_credentials` is false).

## Frontend (Sites / Vite build)

| Variable | Required | Purpose | Example / placeholder |
|---|---|---|---|
| `VITE_BACKEND_URL` | only for split origin | Public origin of the Railway API, **no trailing slash**. Baked in at `yarn build`. Leave empty when the frontend and API share one origin (Vite dev proxy, or a reverse proxy of `/api` on `godroll.the-tacklebox.fish`). | `https://your-api.up.railway.app` |

Frontend files that honor this: `src/lib/config.ts` (`API_BASE`, `cardImageUrl`), `src/lib/api.ts`, `src/lib/upload.ts`, `src/components/auth/ClerkAuthProvider.tsx`, card `<img>` tags.

There is no `VITE_CLERK_*` key. The publishable key is fetched from the backend.

## Dev-only (removed)

These Emergent pod flags existed in the original `vite.config.ts` and are gone from the working copy: `DISABLE_HOT_RELOAD`, `DISABLE_VISUAL_EDITS`, `DISABLE_EMERGENT_OVERLAY`, `CHOKIDAR_USEPOLLING`.
