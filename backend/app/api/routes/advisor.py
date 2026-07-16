from fastapi import APIRouter

from app.agents.advisor_agent import AdvisorAgentService

router = APIRouter(prefix="/advisor", tags=["Portfolio Advisor"])


@router.get("/suggestions")
async def suggestions(user_id: str = "default_user"):
    """Suggested action per held position, with the reasoning behind it.

    Advisory only — nothing here executes. Acting on a suggestion still goes
    through POST /trading/execute as an explicit, user-initiated trade.
    """
    return await AdvisorAgentService.advise(user_id)
