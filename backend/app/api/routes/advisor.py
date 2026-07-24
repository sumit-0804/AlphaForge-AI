from fastapi import APIRouter, Depends

from app.agents.advisor_agent import AdvisorAgentService
from app.api.deps import current_user_id

router = APIRouter(prefix="/advisor", tags=["Portfolio Advisor"])


@router.get("/suggestions")
async def suggestions(user_id: str = Depends(current_user_id)):
    """Suggest an action per held position. Advisory only — nothing here executes a trade."""
    return await AdvisorAgentService.advise(user_id)
