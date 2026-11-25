import asyncio
from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import client, db, ensure_indexes  # noqa: E402

try:  # launched as `backend.server` (the default)
    from backend.clerk_auth import clerk_router, require_user  # noqa: F401
except ModuleNotFoundError:  # launched from inside backend/ as `server`
    from clerk_auth import clerk_router, require_user  # noqa: F401

from routers.members import router as members_router, move_retired_roles  # noqa: E402
from routers.injector import router as injector_router, resume_unfinished_analyses  # noqa: E402
from routers.uploads import router as uploads_router  # noqa: E402
from routers.site import router as site_router  # noqa: E402
from routers.ops import router as ops_router  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.index_task = asyncio.create_task(ensure_indexes())  # background: a big index build must not block boot
    await move_retired_roles()
    await resume_unfinished_analyses()  # OCR verification picks up where it stopped
    yield
    app.state.index_task.cancel()  # stop a build still running before its client closes
    with suppress(asyncio.CancelledError):
        await app.state.index_task
    client.close()


# Create the main app without a prefix
app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


@api_router.get("/")
async def root():
    return {"message": "Tacklebox Card Injector API"}


api_router.include_router(members_router)
api_router.include_router(injector_router)
api_router.include_router(uploads_router)
api_router.include_router(site_router)
api_router.include_router(ops_router)

app.include_router(clerk_router)  # /api/clerk/config and /api/__clerk/*
# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,  # auth is a Bearer header, never cookies, so no credentialed cross-origin calls
    allow_origins=[o.strip() for o in os.environ.get('CORS_ORIGINS', '').split(',') if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
