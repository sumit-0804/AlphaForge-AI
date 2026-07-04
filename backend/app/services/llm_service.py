from typing import AsyncGenerator
from fastapi import HTTPException

from langchain_ollama import ChatOllama
from langchain_core.messages import convert_to_messages

from app.core.config import settings

class LLMService:
    @staticmethod
    def _client(temperature:float ) -> ChatOllama:
        return ChatOllama(
            model = settings.llm_model,
            base_url = settings.ollama_base_url,
            temperature=temperature
        )
    
    @classmethod
    async def chat(cls, messages: list[dict], temperature: float = 0.4) -> dict:
        try:
            client = cls._client(temperature)
            resp = await client.ainvoke(convert_to_messages(messages))
            return {"model": settings.llm_model, "content": resp.content}
        except Exception as e:
            raise HTTPException(502, f"LLM request failed: {e}")
    
    @classmethod
    async def chat_stream(cls, messages: list[dict], temperature:float = 0.4) -> AsyncGenerator[str, None]:
        client = cls._client(temperature)
        async for chunk in client.astream(convert_to_messages(messages)):
            if chunk.content : 
                yield chunk.content