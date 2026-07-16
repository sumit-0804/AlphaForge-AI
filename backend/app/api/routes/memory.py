from fastapi import APIRouter

from app.services.memory import MemoryService

# Read-only by design. Memory is WRITTEN only by the agents themselves — the
# reflection agent on a closed trade and the workflow on a completed analysis.
# The old POST /memory endpoint let any caller inject arbitrary "lessons" that
# `_recall_memory` then fed straight into the moderator's prompt on later runs,
# which made it a prompt-injection path into the decision loop. This endpoint
# exists to inspect what the system has learned, not to author it.
router = APIRouter(prefix="/memory", tags=["Memory"])


@router.get("/recent")
async def recent_memory(type: str | None = None, ticker: str | None = None, user_id: str = "default_user", limit: int = 20):
    return await MemoryService.recent(type, ticker, user_id, limit)