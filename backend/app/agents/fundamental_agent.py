import json

from fastapi import HTTPException

from app.agents.schemas import FundamentalRead
from app.services.llm_service import LLMService

SYSTEM_PROMPT = (
    "You are AlphaForge Fundamental Agent. You are given pre-computed financial "
    "metrics for one company — revenue, debt, cash flow, valuation and a health "
    "score. Interpret them in plain language. "
    "This is educational analysis, not financial advice."
)


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
                FundamentalRead,
                fallback=FundamentalRead(
                    summary="Could not produce a structured fundamental read.",
                    revenue_analysis="", debt_analysis="", cash_flow_analysis="",
                    strengths=[], weaknesses=[], verdict="MODERATE",
                ),
                temperature=0.1,
            )
            return {**result["data"].model_dump(), "valid": result["valid"]}
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Fundamental agent failed: {e}")
