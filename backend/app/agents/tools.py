"""LLM-callable tools that wrap services. Each returns JSON and never raises — errors
come back as an {"error": ...} payload. The function docstrings are sent to the model
verbatim, so keep them descriptive."""

import json
import asyncio

from langchain_core.tools import tool

from app.services.market_data import MarketDataService
from app.services.technical_analysis import TechnicalAnalysisService
from app.services.fundamentals import FundamentalService
from app.services.memory import MemoryService
from app.agents.news_agent import NewsAgentService


def _dump(payload) -> str:
    return json.dumps(payload, default=str)


@tool
async def get_stock_profile(ticker: str) -> str:
    """Get the company profile and current quote for a stock ticker: name, sector,
    industry, current price, market cap, volume, 52-week high/low and currency.
    Call this first to learn what the company actually is before judging it."""
    try:
        info = await asyncio.to_thread(MarketDataService.get_stock_info, ticker.upper())
        return _dump(info)
    except Exception as e:
        return _dump({"error": f"profile unavailable for {ticker}: {e}"})


@tool
async def get_technical_indicators(ticker: str) -> str:
    """Get the latest technical indicators for a stock: price, RSI, EMA20, EMA50,
    MACD and ADX. Call this to judge momentum, trend direction and trend strength."""
    try:
        data = await asyncio.to_thread(
            TechnicalAnalysisService.get_technical_indicators, ticker.upper()
        )
        return _dump(data.get("latest", data))
    except Exception as e:
        return _dump({"error": f"technical data unavailable for {ticker}: {e}"})


@tool
async def get_fundamentals(ticker: str) -> str:
    """Get fundamental financials for a stock: revenue growth and margins, debt and
    liquidity ratios, cash flow, valuation multiples, plus a computed financial
    health score and label. Call this to judge business quality and balance-sheet
    risk."""
    try:
        data = await asyncio.to_thread(
            FundamentalService.get_fundamentals, ticker.upper()
        )
        return _dump(data)
    except Exception as e:
        return _dump({"error": f"fundamentals unavailable for {ticker}: {e}"})


@tool
async def get_recent_news(ticker: str) -> str:
    """Get a summary and sentiment score of recent news headlines for a stock.
    Call this to check for catalysts, upgrades/downgrades or red flags in the news
    flow that the numbers alone won't show."""
    try:
        news = await NewsAgentService.analyze(ticker.upper())
        return _dump(news.get("analysis", {}))
    except Exception as e:
        return _dump({"error": f"news unavailable for {ticker}: {e}"})


@tool
async def search_memory(query: str, ticker: str | None = None) -> str:
    """Search AlphaForge's long-term memory for prior lessons distilled from past
    closed trades and earlier analysis. Call this to avoid repeating past mistakes
    or to check whether a prior thesis on this name played out. Lessons transfer
    across stocks — a mistake made on one name is worth knowing about on any name
    in the same setup — so leave `ticker` unset and describe the SITUATION in the
    query (sector, trend, momentum, valuation) to find those; set `ticker` only
    when you specifically want this stock's own history."""
    try:
        hits = await MemoryService.search(query, k=3, ticker=ticker)
        return _dump([h.get("content") for h in hits])
    except Exception as e:
        return _dump({"error": f"memory search failed: {e}"})


# The toolset an equity-research agent gets. Reusable by any agent that should
# investigate a ticker autonomously (research, debate, scanner triage, ...).
RESEARCH_TOOLS = [
    get_stock_profile,
    get_technical_indicators,
    get_fundamentals,
    get_recent_news,
    search_memory,
]
