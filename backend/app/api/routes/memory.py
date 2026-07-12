from fastapi import APIRouter
from pydantic import BaseModel

from app.services.memory import MemoryService

router = APIRouter(prefix="/memory", tags=["Memory"])


class MemoryRequest(BaseModel):
    type: str 
    content: str
    ticker: str | None = None
    metadata: dict | None = None
    user_id: str = "default_user"


@router.post("/")
async def save_memory(req: MemoryRequest):
    entry = await MemoryService.save(
        req.type, req.content, req.ticker, req.metadata, req.user_id
    )
    return {"id": str(entry.id), "type": entry.type, "ticker": entry.ticker, "created_at": entry.created_at}


@router.get("/search")
async def search_memory(q: str, k: int = 5, type: str | None = None, user_id: str = "default_user"):
    return await MemoryService.search(q, k=k, type=type, user_id=user_id)


@router.get("/recent")
async def recent_memory(type: str | None = None, ticker: str | None = None, user_id: str = "default_user", limit: int = 20):
    return await MemoryService.recent(type, ticker, user_id, limit)