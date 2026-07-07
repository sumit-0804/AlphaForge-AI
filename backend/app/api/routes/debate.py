from fastapi import APIRouter

from app.agents.debate_agent import DebateAgentService

router = APIRouter(prefix="/debate", tags=["Debate Agents"])

@router.get("/{ticker}")
async def debate(ticker: str, news: bool = True):
    # Runs Bull vs Bear vs Moderator and returns the explainable decision.
    # Pass ?news=false to skip the RSS/news round-trip for a faster debate.
    return await DebateAgentService.debate(ticker.upper(), include_news=news)