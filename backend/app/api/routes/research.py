from fastapi import APIRouter
from pydantic import BaseModel

from app.agents.reasearch_agent import ResearchAgentService

router= APIRouter(prefix="/research", tags=["Research Agent"])

class ResearchRequest(BaseModel):
    news:list[dict] | None = None

@router.get("/{ticker}")
async def research_stock(ticker:str):
    return await ResearchAgentService.research(ticker.upper())

@router.post("/{ticker}")
async def research_stock_with_news(ticker:str, req: ResearchRequest):
    return await ResearchAgentService.research(ticker.upper(),req.news)
    