from fastapi import APIRouter

from app.api.routes import auth, health, market, trading, scanner, advisor
from app.api.routes import debate, workflow, memory, reports

# Per-ticker analysis runs through the workflow; portfolio work runs through the advisor.
# Everything below /auth and /health requires a bearer token — see app/api/deps.py.
api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(health.router)
api_router.include_router(market.router)
api_router.include_router(trading.router)
api_router.include_router(scanner.router)
api_router.include_router(advisor.router)
api_router.include_router(debate.router)
api_router.include_router(workflow.router)
api_router.include_router(memory.router)
api_router.include_router(reports.router)
