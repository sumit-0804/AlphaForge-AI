from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.db.mongo import init_db

@asynccontextmanager
async def lifespan(_:FastAPI):
    await init_db();
    yield

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