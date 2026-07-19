from fastapi import APIRouter

from app.api.routes import health, market, trading, scanner, advisor
from app.api.routes import debate, workflow, memory, scheduler

# Per-ticker analysis runs through the workflow; portfolio work runs in the daily report.
api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(market.router)
api_router.include_router(trading.router)
api_router.include_router(scanner.router)
api_router.include_router(advisor.router)
api_router.include_router(debate.router)
api_router.include_router(workflow.router)
api_router.include_router(memory.router)
api_router.include_router(scheduler.router)
