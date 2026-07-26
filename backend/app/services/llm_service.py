import json
from fastapi import HTTPException

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import convert_to_messages, HumanMessage, ToolMessage

from app.core.config import settings
from app.core.ratelimit import QuotaExhausted, RateLimiter, estimate_tokens
from app.agents.util import parse_json

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
        _chat_limiter.settle(handle, _usage_total(resp))
        return resp

    @classmethod
    async def chat(cls, messages: list[dict], temperature: float = 0.4) -> dict:
        try:
            client = cls._client(temperature)
            resp = await cls._invoke(client, convert_to_messages(messages))
            return {"model": settings.gemini_model, "content": _to_text(resp.content)}
        except QuotaExhausted as e:
            # 429 with a reset time, not a 502 — nothing is broken, the budget is spent.
            raise HTTPException(
                429,
                str(e),
                headers={"Retry-After": str(_retry_after_seconds(e))},
            )
        except Exception as e:
            raise HTTPException(502, f"LLM request failed: {e}")

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
        fallback: dict,
        temperature: float = 0.3,
        max_retries: int = 2,
        validate=None,
    ) -> dict:
        """Chat but retry on bad JSON: show the model its error and ask for a fix, then
        fall back if it still fails. `validate` returns an error string or None."""
        convo = list(messages)
        model = settings.gemini_model
        for attempt in range(max_retries + 1):
            result = await cls.chat(convo, temperature=temperature)
            model = result["model"]
            raw = result["content"]
            obj, ok = parse_json(raw)

            problem = None
            if not ok:
                problem = "Your last response was not a valid JSON object."
            elif validate is not None:
                problem = validate(obj)

            if problem is None and ok:
                return {"model": model, "data": obj, "attempts": attempt + 1, "valid": True}

            # Show the model its bad output and ask for a corrected one.
            convo = messages + [
                {"role": "assistant", "content": raw},
                {
                    "role": "user",
                    "content": (
                        f"{problem} Return ONLY a single corrected JSON object — no "
                        "markdown fences, no commentary before or after."
                    ),
                },
            ]

        return {"model": model, "data": fallback, "attempts": max_retries + 1, "valid": False}

    @classmethod
    async def chat_with_tools(
        cls,
        messages: list[dict],
        tools: list,
        temperature: float = 0.3,
        max_iterations: int = 6,
    ) -> dict:
        """Let the model call tools in a loop until it answers or hits max_iterations,
        then force a final tool-free answer. Returns the text plus a trace of tool calls."""
        client = cls._client(temperature).bind_tools(tools)
        tool_map = {t.name: t for t in tools}
        convo = convert_to_messages(messages)
        trace: list[dict] = []

        try:
            for _ in range(max_iterations):
                ai = await cls._invoke(client, convo)
                convo.append(ai)

                calls = getattr(ai, "tool_calls", None) or []
                if not calls:
                    # No tool requested, so the model is done.
                    return {
                        "model": settings.gemini_model,
                        "content": _to_text(ai.content),
                        "tool_trace": trace,
                    }

                for tc in calls:
                    name, args = tc["name"], tc.get("args", {})
                    tool = tool_map.get(name)
                    if tool is None:
                        output = json.dumps({"error": f"unknown tool: {name}"})
                    else:
                        try:
                            output = await tool.ainvoke(args)
                        except Exception as e:
                            output = json.dumps({"error": str(e)})
                    output = output if isinstance(output, str) else str(output)
                    trace.append({"tool": name, "args": args, "result_preview": output[:240]})
                    convo.append(ToolMessage(content=output, tool_call_id=tc["id"]))

            # Hit the cap, so force a final answer with no more tool calls.
            final = await cls._invoke(
                cls._client(temperature),
                convo + [HumanMessage("Stop calling tools and return your final answer now.")],
            )
            return {
                "model": settings.gemini_model,
                "content": _to_text(final.content),
                "tool_trace": trace,
            }
        except QuotaExhausted as e:
            raise HTTPException(
                429, str(e), headers={"Retry-After": str(_retry_after_seconds(e))}
            )
        except Exception as e:
            raise HTTPException(502, f"Tool-using LLM request failed: {e}")
