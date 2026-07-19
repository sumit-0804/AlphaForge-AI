from fastapi import APIRouter

from app.agents.advisor_agent import AdvisorAgentService

router = APIRouter(prefix="/advisor", tags=["Portfolio Advisor"])


@router.get("/suggestions")
async def suggestions(user_id: str = "default_user"):
    """Suggest an action per held position. Advisory only — nothing here executes a trade."""
    return await AdvisorAgentService.advise(user_id)
