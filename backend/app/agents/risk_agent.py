import json

from fastapi import HTTPException

from app.services.llm_service import LLMService
from app.agents.util import _parse

SYSTEM_PROMPT=(
    "You are AlphaForge Risk Agent. You are given computed portfolio risk metrics "
    "— volatility, beta, Sharpe ratio and sector exposure. Interpret the risk "
    "posture in plain language. Respond ONLY with a valid JSON object — no markdown:\n"
    "{\n"
    '  "summary": "2-3 sentences on the portfolio\'s overall risk profile",\n'
    '  "volatility_comment": "1 sentence on how volatile / market-sensitive it is",\n'
    '  "concentration_risks": ["short bullet on any name or sector overweight"],\n'
    '  "suggestions": ["short, practical risk-reduction idea"]\n'
    "}\n"
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
            result = await LLMService.chat(messages, temperature=0.3)
            return _parse(
                result["content"],
                {
                    "summary": result["content"].strip(),
                    "volatility_comment": "",
                    "concentration_risks": [],
                    "suggestions": [],
                },
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Risk agent failed: {e}")
