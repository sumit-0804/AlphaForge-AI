import json

from fastapi import HTTPException

from app.agents.schemas import PortfolioRead
from app.services.llm_service import LLMService

SYSTEM_PROMPT = (
    "You are AlphaForge Portfolio Agent. You are given a computed allocation plan "
    "— capital, per-name weights, share counts and sector exposure. Explain the "
    "plan's diversification and risk posture in plain language. "
    "This is educational analysis, not financial advice."
)


class PortfolioAgentService:
    @classmethod
    async def explain(cls, plan: dict) -> dict:
        try:
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Allocation plan:\n{json.dumps(plan, indent=2)}\n\n"
                        "Return the JSON explanation now."
                    ),
                },
            ]
            result = await LLMService.chat_json(
                messages,
                PortfolioRead,
                fallback=PortfolioRead(
                    summary="Could not produce a structured allocation explanation.",
                    diversification="", concentration_risks=[], notes=[],
                ),
                temperature=0.1,
            )
            return result["data"].model_dump()
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Portfolio agent failed: {e}")