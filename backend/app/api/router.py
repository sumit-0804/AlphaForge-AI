from fastapi import APIRouter

from app.api.routes import health, market, analysis

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(market.router)
api_router.include_router(analysis.router)