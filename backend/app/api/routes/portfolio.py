from fastapi import APIRouter
from pydantic import BaseModel

from app.services.portfolio import (
    PortfolioService,
    DEFAULT_MAX_POSITION,
    DEFAULT_MAX_SECTOR,
    DEFAULT_CASH_RESERVE,
)
from app.agents.portfolio_agent import PortfolioAgentService

router = APIRouter(prefix="/portfolio", tags=["Portfolio Agent"])


class Candidate(BaseModel):
    ticker: str
    conviction: float = 1.0   # relative weight; higher = larger target position


class AllocationRequest(BaseModel):
    candidates: list[Candidate]
    capital: float | None = None            # defaults to paper-portfolio cash
    max_position: float = DEFAULT_MAX_POSITION
    max_sector: float = DEFAULT_MAX_SECTOR
    cash_reserve: float = DEFAULT_CASH_RESERVE
    explain: bool = True


@router.post("/allocate")
async def allocate(req: AllocationRequest):
    plan = await PortfolioService.allocate(
        [c.model_dump() for c in req.candidates],
        capital=req.capital,
        max_position=req.max_position,
        max_sector=req.max_sector,
        cash_reserve=req.cash_reserve,
    )
    if req.explain:
        plan["analysis"] = await PortfolioAgentService.explain(plan)
    return plan