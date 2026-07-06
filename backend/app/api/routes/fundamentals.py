from fastapi import APIRouter

from app.services.fundamentals import FundamentalService
from app.agents.fundamental_agent import FundamentalAgentService

router = APIRouter(prefix="/fundamentals", tags=["Fundamental Agent"])

@router.get("/{ticker}")
def get_fundamentals(ticker:str):
    return FundamentalService.get_fundamentals(ticker.upper())

@router.get("/{ticker}/analysis")
async def analyze_fundamentals(ticker:str):
    return await FundamentalAgentService.analyze(ticker.upper())