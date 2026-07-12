from typing import AsyncGenerator
from fastapi import HTTPException

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import convert_to_messages
from langchain_core.rate_limiters import InMemoryRateLimiter

from app.core.config import settings

# Gemini Flash free tier allows ~10 requests/minute. A single shared limiter caps
# us just under that so concurrent agents (Bull + Bear) and the scheduler never
# trip a 429. Blocks (does not drop) until a slot frees up.
_rate_limiter = InMemoryRateLimiter(
    requests_per_second=10 / 60,   # ~0.167 rps -> 10 per minute
    check_every_n_seconds=0.1,
    max_bucket_size=10,
)


def _to_text(content) -> str:
    # Gemini 3.x models return structured content blocks (a list of dicts) rather
    # than a plain string. Flatten them back to text so every agent keeps
    # receiving a str it can .strip()/json-parse.
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in content
        )
    return str(content)


class LLMService:
    @staticmethod
    def _client(temperature: float) -> ChatGoogleGenerativeAI:
        return ChatGoogleGenerativeAI(
            model=settings.gemini_model,
            google_api_key=settings.google_api_key,
            temperature=temperature,
            rate_limiter=_rate_limiter,
        )

    @classmethod
    async def chat(cls, messages: list[dict], temperature: float = 0.4) -> dict:
        try:
            client = cls._client(temperature)
            resp = await client.ainvoke(convert_to_messages(messages))
            return {"model": settings.gemini_model, "content": _to_text(resp.content)}
        except Exception as e:
            raise HTTPException(502, f"LLM request failed: {e}")

    @classmethod
    async def chat_stream(cls, messages: list[dict], temperature: float = 0.4) -> AsyncGenerator[str, None]:
        client = cls._client(temperature)
        async for chunk in client.astream(convert_to_messages(messages)):
            text = _to_text(chunk.content)
            if text:
                yield text
