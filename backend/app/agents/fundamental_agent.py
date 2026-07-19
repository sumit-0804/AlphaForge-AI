import json

from fastapi import HTTPException

from app.services.llm_service import LLMService

SYSTEM_PROMPT = (
    "You are AlphaForge Fundamental Agent. You are given pre-computed financial "
    "metrics for one company — revenue, debt, cash flow, valuation and a health "
    "score. Interpret them in plain language. Respond ONLY with a valid JSON "
    "object — no markdown, no text outside the JSON:\n"
    "{\n"
    '  "summary": "3-4 sentence read on the company\'s financial health",\n'
    '  "revenue_analysis": "1-2 sentences on growth and margins",\n'
    '  "debt_analysis": "1-2 sentences on leverage and liquidity",\n'
    '  "cash_flow_analysis": "1-2 sentences on cash generation",\n'
    '  "strengths": ["short bullet"],\n'
    '  "weaknesses": ["short bullet"],\n'
    '  "verdict": "STRONG | MODERATE | WEAK | POOR"\n'
    "}\n"
    "This is educational analysis, not financial advice."
)

_VERDICTS = ("STRONG", "MODERATE", "WEAK", "POOR")


def _validate(obj: dict) -> str | None:
    if not isinstance(obj.get("summary"), str) or not obj["summary"].strip():
        return "The JSON is missing a non-empty 'summary' string."
    if obj.get("verdict") not in _VERDICTS:
        return f"The 'verdict' field must be exactly one of {', '.join(_VERDICTS)}."
    return None


class FundamentalAgentService:
    """Turns already-computed fundamentals into a plain-language read.

    Runs as part of the workflow graph's `fundamental` node rather than behind
    its own endpoint, so the graph stays the single path through which an
    analysis is produced.
    """

    @classmethod
    async def narrate(cls, data: dict) -> dict:
        # Uses pre-fetched metrics so it doesn't refetch or describe a different snapshot.
        try:
            metrics = {
                k: data[k]
                for k in ("revenue", "debt", "cashFlow", "valuation", "health")
                if k in data
            }
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Financial metrics for {data.get('name')} ({data.get('symbol')}), "
                        f"currency {data.get('currency')}:\n"
                        f"{json.dumps(metrics, indent=2, default=str)}\n\n"
                        "Return the JSON analysis now."
                    ),
                },
            ]
            result = await LLMService.chat_json(
                messages,
                fallback={
                    "summary": "Could not produce a structured fundamental read.",
                    "revenue_analysis": "",
                    "debt_analysis": "",
                    "cash_flow_analysis": "",
                    "strengths": [],
                    "weaknesses": [],
                    "verdict": "MODERATE",
                },
                temperature=0.3,
                validate=_validate,
            )
            return {**result["data"], "valid": result["valid"]}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Fundamental agent failed: {e}")
