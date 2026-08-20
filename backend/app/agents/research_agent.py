import json

from fastapi import HTTPException

from app.agents.schemas import ResearchReport
from app.services.llm_service import LLMService

SYSTEM_PROMPT = (
    "You are AlphaForge Research Agent, an equity research analyst. The evidence has "
    "already been gathered for you: company profile, technical indicators, "
    "fundamentals with a computed health score, recent news, single-stock risk "
    "metrics, and AlphaForge's memory of lessons from past trades on this name and on "
    "other names in a similar setup. Do not ask for more data — form your view from "
    "what you are given, and cite specific numbers. Treat 'cross_ticker_lessons' as "
    "general pattern warnings from other stocks, not events at this company. "
    "This is educational analysis, not financial advice."
)

_FALLBACK = ResearchReport(
    summary="The research agent returned no usable view.",
    strengths=[],
    weaknesses=[],
    recommendation="HOLD",
    confidence="LOW",
    rationale="Model returned unstructured output.",
)


class ResearchAgentService:
    """Reads the workflow's evidence bundle and returns a defensible written view."""

    @classmethod
    async def research(cls, ticker: str, user_id: str, evidence: dict) -> dict:
        try:
            ticker = ticker.upper()
            # Research is not in the bundle yet — that is what this call produces.
            payload = {k: v for k, v in evidence.items() if k != "research"}
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Evidence for {ticker}:\n"
                        f"{json.dumps(payload, indent=2, default=str)}\n\n"
                        "Give your research view now."
                    ),
                },
            ]
            result = await LLMService.chat_json(
                messages, ResearchReport, fallback=_FALLBACK, temperature=0.1
            )
            return {
                "symbol": ticker,
                "model": result["model"],
                # Dumped here: this rides into the debate prompt and the SSE stream.
                "report": result["data"].model_dump(),
                "valid": result["valid"],
            }
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Research agent failed: {e}")
