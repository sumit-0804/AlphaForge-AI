import json
from fastapi import HTTPException

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.messages import convert_to_messages, HumanMessage, ToolMessage
from langchain_core.rate_limiters import InMemoryRateLimiter

from app.core.config import settings
from app.agents.util import parse_json

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
    async def chat_json(
        cls,
        messages: list[dict],
        fallback: dict,
        temperature: float = 0.3,
        max_retries: int = 2,
        validate=None,
    ) -> dict:
        """Chat with a self-correction loop that insists on valid JSON.

        Rather than silently falling back the first time the model returns prose or
        broken JSON, we show the model its own bad output and the specific problem,
        and ask it to fix it — up to `max_retries` times. `validate`, if given, is a
        callable that returns an error string for a semantically bad (but
        JSON-valid) object, or None if it passes. Returns the parsed object (or
        `fallback` if every attempt fails) plus loop metadata.
        """
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

            # Self-correct: reflect the bad output back and demand a clean fix.
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
        """Run an agentic tool-calling loop (the ReAct pattern).

        The model is bound to `tools` and, on each turn, decides whether to call a
        tool or answer. We execute any requested tools, feed the results back, and
        repeat — so the model, not our Python, drives what data gets gathered. The
        loop exits when the model stops requesting tools or `max_iterations` is hit,
        at which point we force one final tool-free synthesis. Returns the final
        text plus a `tool_trace` recording every tool the agent chose to call.
        """
        client = cls._client(temperature).bind_tools(tools)
        tool_map = {t.name: t for t in tools}
        convo = convert_to_messages(messages)
        trace: list[dict] = []

        try:
            for _ in range(max_iterations):
                ai = await client.ainvoke(convo)
                convo.append(ai)

                calls = getattr(ai, "tool_calls", None) or []
                if not calls:
                    # Model answered without asking for more data — we're done.
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

            # Iteration cap reached: force a final, tool-free answer so callers
            # always get a synthesis rather than a dangling tool request.
            final = await cls._client(temperature).ainvoke(
                convo + [HumanMessage("Stop calling tools and return your final answer now.")]
            )
            return {
                "model": settings.gemini_model,
                "content": _to_text(final.content),
                "tool_trace": trace,
            }
        except Exception as e:
            raise HTTPException(502, f"Tool-using LLM request failed: {e}")
