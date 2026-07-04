from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services.llm_service import LLMService
from app.core.config import settings

router = APIRouter(prefix="/llm", tags=["LLM"])


class ChatRequest(BaseModel):
    messages: list[dict]
    temperature: float = 0.4


@router.get("/state")
async def get_state():
    return {"provider": "ollama", "model": settings.llm_model}


@router.post("/chat")
async def chat(req: ChatRequest):
    return await LLMService.chat(req.messages, req.temperature)


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    return StreamingResponse(
        LLMService.chat_stream(req.messages, req.temperature),
        media_type="text/event-stream",
    )