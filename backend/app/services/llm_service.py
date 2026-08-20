from collections.abc import Callable
from typing import TypeVar

from fastapi import HTTPException
from pydantic import BaseModel, ValidationError

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import convert_to_messages

from app.core.config import settings
from app.core.ratelimit import QuotaExhausted, RateLimiter, estimate_tokens

M = TypeVar("M", bound=BaseModel)

# One shared limiter so every chat call draws from the same per-minute and daily budget.
_chat_limiter = RateLimiter(
    settings.gemini_rpm,
    settings.gemini_tpm,
    "gemini-chat",
    rpd=settings.gemini_rpd,
    reset_timezone=settings.quota_reset_timezone,
)

# Reserve budget for the reply up front since its size isn't known yet; settle() corrects it.
_RESERVED_OUTPUT_TOKENS = 1200


def _to_text(content) -> str:
    # Gemini can return content as a list of blocks; flatten it back to a string.
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in content
        )
    return str(content)


def _usage_total(resp) -> int | None:
    # Pull the real token count LangChain attaches as usage_metadata.
    u = getattr(resp, "usage_metadata", None) or {}
    total = u.get("total_tokens")
    if total:
        return int(total)
    parts = (u.get("input_tokens") or 0) + (u.get("output_tokens") or 0)
    return int(parts) or None


def _estimate(messages) -> int:
    return sum(estimate_tokens(_to_text(m.content)) for m in messages) + _RESERVED_OUTPUT_TOKENS


def _retry_after_seconds(e: QuotaExhausted) -> int:
    from datetime import datetime, timezone

    return max(1, int((e.resets_at - datetime.now(timezone.utc)).total_seconds()))


def _as_http(e: Exception) -> HTTPException:
    # A spent budget is a 429 with a reset time, not a 502 — nothing is broken.
    if isinstance(e, QuotaExhausted):
        return HTTPException(429, str(e), headers={"Retry-After": str(_retry_after_seconds(e))})
    return HTTPException(502, f"LLM request failed: {e}")


def _repair_hint(exc: ValidationError) -> str:
    # Pydantic names the exact field and reason, which beats a hand-written message.
    return "; ".join(
        f"{'.'.join(str(p) for p in e['loc']) or 'root'}: {e['msg']}"
        for e in exc.errors()[:5]
    )


class LLMService:
    @staticmethod
    def _client(temperature: float) -> ChatGoogleGenerativeAI:
        return ChatGoogleGenerativeAI(
            model=settings.gemini_model,
            google_api_key=settings.google_api_key,
            temperature=temperature,
            # The SDK defaults to 6 internal retries, and each one is a real request
            # against RPM/RPD that the limiter above never sees — so a call it counted
            # as 1 could spend 6. Worse, 429s are what trigger them, so brushing the
            # quota made it stampede. 1 means "no retries"; 0 means "use the default".
            max_retries=1,
        )

    @staticmethod
    async def _invoke(client, msgs):
        # Every outbound call goes through here so nothing skips the rate limiter.
        handle = await _chat_limiter.acquire(_estimate(msgs))
        resp = await client.ainvoke(msgs)
        # with_structured_output(include_raw=True) hands back a dict; the AIMessage
        # carrying usage_metadata is under "raw", and settle() needs the real count.
        usage = resp["raw"] if isinstance(resp, dict) and "raw" in resp else resp
        _chat_limiter.settle(handle, _usage_total(usage))
        return resp

    @classmethod
    async def chat(cls, messages: list[dict], temperature: float = 0.4) -> dict:
        try:
            client = cls._client(temperature)
            resp = await cls._invoke(client, convert_to_messages(messages))
            return {"model": settings.gemini_model, "content": _to_text(resp.content)}
        except Exception as e:
            raise _as_http(e)

    @staticmethod
    def quota() -> dict:
        return _chat_limiter.usage()

    @staticmethod
    async def quota_snapshot() -> dict:
        return await _chat_limiter.snapshot()

    @classmethod
    async def chat_json(
        cls,
        messages: list[dict],
        schema: type[M],
        fallback: M,
        temperature: float = 0.3,
        max_retries: int = 2,
        validate: Callable[[M], str | None] | None = None,
    ) -> dict:
        """Chat constrained to `schema` at decode time, so a retry only fires for rules a
        schema cannot express — `validate` returns an error string or None."""
        client = cls._client(temperature).with_structured_output(
            schema, method="json_schema", include_raw=True
        )
        convo = list(messages)

        for attempt in range(max_retries + 1):
            try:
                result = await cls._invoke(client, convert_to_messages(convo))
            except Exception as e:
                raise _as_http(e)

            parsed, err = result.get("parsed"), result.get("parsing_error")
            if err is not None:
                problem = _repair_hint(err) if isinstance(err, ValidationError) else str(err)
            elif parsed is None:
                problem = "the response was empty"
            else:
                problem = validate(parsed) if validate else None

            if problem is None:
                return {"model": settings.gemini_model, "data": parsed,
                        "attempts": attempt + 1, "valid": True}

            # Show the model its rejected output and what was wrong with it.
            convo = messages + [
                {"role": "assistant", "content": _to_text(result["raw"].content)},
                {"role": "user", "content":
                 f"That response was rejected — {problem}. Return a corrected object."},
            ]

        return {"model": settings.gemini_model, "data": fallback,
                "attempts": max_retries + 1, "valid": False}
