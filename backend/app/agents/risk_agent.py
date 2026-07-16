import json

from fastapi import HTTPException

from app.services.llm_service import LLMService


def _validate(obj: dict) -> str | None:
    if not isinstance(obj.get("summary"), str) or not obj["summary"].strip():
        return "The JSON is missing a non-empty 'summary' string."
    return None

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
            # Self-correcting: this now runs inside the unattended daily-report
            # job, where a silently unstructured fallback would sit in the stored
            # report unnoticed rather than being caught by a caller.
            result = await LLMService.chat_json(
                messages,
                fallback={
                    "summary": "Could not produce a structured risk read.",
                    "volatility_comment": "",
                    "concentration_risks": [],
                    "suggestions": [],
                },
                temperature=0.3,
                validate=_validate,
            )
            return {**result["data"], "valid": result["valid"]}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Risk agent failed: {e}")
