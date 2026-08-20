import json

from fastapi import HTTPException

from app.agents.schemas import RiskRead
from app.services.llm_service import LLMService

SYSTEM_PROMPT=(
    "You are AlphaForge Risk Agent. You are given computed portfolio risk metrics "
    "— volatility, beta, Sharpe ratio and sector exposure. Interpret the risk "
    "posture in plain language. "
    "This is educational analysis, not financial advice."
)

class RiskAgentService:
    @classmethod
    async def explain(cls, report: dict) -> dict:
        try:
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Portfolio risk metrics:\n{json.dumps(report, indent=2)}\n\n"
                        "Return the JSON explanation now."
                    ),
                },
            ]
            # Self-correcting since this runs unattended in the daily report.
            result = await LLMService.chat_json(
                messages,
                RiskRead,
                fallback=RiskRead(
                    summary="Could not produce a structured risk read.",
                    volatility_comment="", concentration_risks=[], suggestions=[],
                ),
                temperature=0.1,
            )
            return {**result["data"].model_dump(), "valid": result["valid"]}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Risk agent failed: {e}")
