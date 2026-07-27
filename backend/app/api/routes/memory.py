from fastapi import APIRouter, Depends

from app.api.deps import current_user_id
from app.models.memory import MemoryEntry, MEMORY_TYPES
from app.services.memory import MemoryService

# Read-only: only the agents write memory, so callers can't inject fake lessons.
router = APIRouter(prefix="/memory", tags=["Memory"])


@router.get("/recent")
async def recent_memory(
    type: str | None = None,
    ticker: str | None = None,
    limit: int = 20,
    user_id: str = Depends(current_user_id),
):
    return await MemoryService.recent(type, ticker, user_id=user_id, limit=limit)


@router.get("/health")
async def memory_health(user_id: str = Depends(current_user_id)):
    """Report whether the learning loop is working: whether the Atlas vector index
    answers, and whether any entry is missing its embedding.
    """
    counts = {
        t: await MemoryEntry.find(
            MemoryEntry.user_id == user_id, MemoryEntry.type == t
        ).count()
        for t in MEMORY_TYPES
    }
    # Stored, but with no vector — so invisible to search until the backfill runs.
    failed = await MemoryService.unembedded_count(user_id)

    lessons = counts.get("lesson", 0)
    index_exists = await MemoryService.vector_index_ready()
    if failed:
        status = "index_degraded"
    elif lessons and not index_exists:
        status = "index_unavailable"
    elif not lessons:
        status = "no_lessons_yet"
    else:
        status = "ok"

    return {
        "user_id": user_id,
        "status": status,
        "counts": counts,
        "index_exists": index_exists,
        "unindexed_entries": failed,
    }