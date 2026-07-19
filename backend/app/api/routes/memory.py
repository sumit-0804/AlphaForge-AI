from fastapi import APIRouter

from app.models.memory import MemoryEntry, MEMORY_TYPES
from app.services.memory import MemoryService

# Read-only: only the agents write memory, so callers can't inject fake lessons.
router = APIRouter(prefix="/memory", tags=["Memory"])


@router.get("/recent")
async def recent_memory(type: str | None = None, ticker: str | None = None, user_id: str = "default_user", limit: int = 20):
    return await MemoryService.recent(type, ticker, user_id, limit)


@router.get("/health")
async def memory_health(user_id: str = "default_user"):
    """Report whether the learning loop is working by comparing Mongo counts against the FAISS index."""
    counts = {
        t: await MemoryEntry.find(
            MemoryEntry.user_id == user_id, MemoryEntry.type == t
        ).count()
        for t in MEMORY_TYPES
    }
    # Entries in Mongo that never made it into the index.
    failed = await MemoryEntry.find(
        MemoryEntry.user_id == user_id,
        {"metadata._index_error": {"$exists": True}},
    ).count()

    lessons = counts.get("lesson", 0)
    index_exists = MemoryService.index_exists()
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