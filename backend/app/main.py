import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.db.mongo import init_db
from app.services.scheduler import start_scheduler, shutdown_scheduler

# uvicorn adds no root handler, so set one up or our INFO logs get dropped.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s | %(message)s",
)


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_:FastAPI):
    if settings.jwt_secret_is_default:
        # Anyone who has read this repo can forge a token for any account, so make
        # the warning impossible to miss rather than failing silently in production.
        logger.warning(
            "JWT_SECRET is still the built-in default — tokens are forgeable. "
            "Set JWT_SECRET before exposing this instance."
        )
    await init_db()
    if settings.scheduler_enabled:
        start_scheduler()
    yield
    shutdown_scheduler()

app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins = settings.cors_origin_list,
    allow_credentials = True,
    allow_methods=["*"],
    allow_headers=["*"]
)

app.include_router(api_router, prefix = settings.api_prefix)

@app.get("/")
async def root():
    return {"message": "AlphaForge AI API", "docs":"/docs"}