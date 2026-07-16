from fastapi import APIRouter

from app.api.routes import health, market, trading, scanner, advisor
from app.api.routes import debate, workflow, memory, scheduler

# The LangGraph workflow is the single orchestration path for per-ticker
# analysis: research, technical, fundamental and news all run as nodes inside it
# rather than as standalone endpoints, so there is exactly one place an analysis
# can be produced. Portfolio-level work (risk, allocation) is folded into the
# scheduler's daily report for the same reason.
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
