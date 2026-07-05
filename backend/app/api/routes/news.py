from fastapi import APIRouter

from app.agents.news_agent import NewsAgentService

router = APIRouter(prefix="/news", tags=["News Agent"])


@router.get("/{ticker}")
async def get_news_analysis(ticker: str, limit: int = 10):
    # Fetch RSS + summarise + sentiment.
    return await NewsAgentService.analyze(ticker.upper(), limit)


@router.get("/{ticker}/feed")
async def get_news_feed(ticker: str, limit: int = 10):
    # Raw RSS headlines only (no LLM).
    return await NewsAgentService.fetch_rss(ticker.upper(), limit)
