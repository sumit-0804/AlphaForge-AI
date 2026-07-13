from fastapi import APIRouter

from app.api.routes import health, market, analysis, trading, llm
from app.api.routes import research, news, scanner, fundamentals
from app.api.routes import debate, workflow, portfolio, risk, memory, reflection, scheduler
api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(market.router)
api_router.include_router(analysis.router)
api_router.include_router(trading.router)
api_router.include_router(llm.router)
api_router.include_router(research.router)
api_router.include_router(news.router)
api_router.include_router(scanner.router)
api_router.include_router(fundamentals.router)
api_router.include_router(debate.router)
api_router.include_router(workflow.router)
api_router.include_router(portfolio.router)
api_router.include_router(risk.router)
api_router.include_router(memory.router)
api_router.include_router(reflection.router)
api_router.include_router(scheduler.router)