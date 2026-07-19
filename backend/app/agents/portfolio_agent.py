import json

from fastapi import HTTPException

from app.services.llm_service import LLMService


def _validate_plan(obj: dict) -> str | None:
    # Require a summary — an explanation without one is useless.
    if not isinstance(obj.get("summary"), str) or not obj["summary"].strip():
        return "The JSON is missing a non-empty 'summary' string."
    return None

SYSTEM_PROMPT = (
    "You are AlphaForge Portfolio Agent. You are given a computed allocation plan "
    "— capital, per-name weights, share counts and sector exposure. Explain the "
    "plan's diversification and risk posture in plain language. Respond ONLY with "
    "a valid JSON object — no markdown:\n"
    "{\n"
    '  "summary": "2-3 sentences on how capital is deployed and why it is balanced",\n'
    '  "diversification": "1-2 sentences on sector/position spread",\n'
    '  "concentration_risks": ["short bullet on any name/sector to watch"],\n'
    '  "notes": ["short practical note, e.g. cash buffer or uninvested capital"]\n'
    "}\n"
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
                fallback={
                    "summary": "Could not produce a structured allocation explanation.",
                    "diversification": "",
                    "concentration_risks": [],
                    "notes": [],
                },
                temperature=0.3,
                validate=_validate_plan,
            )
            return result["data"]
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Portfolio agent failed: {e}")