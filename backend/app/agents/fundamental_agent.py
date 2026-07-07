import json
from fastapi import HTTPException

from app.services.fundamentals import FundamentalService
from app.services.llm_service import LLMService
from app.agents.util import _parse

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

class FundamentalAgentService:
    @classmethod
    async def analyze(cls, ticker:str) ->dict:
        try:
            data = FundamentalService.get_fundamentals(ticker)
            messages =[{
                "role":"system", "content" : SYSTEM_PROMPT
            }, 
                {
                    "role":"user",
                    "content": (
                        f"Financial Metrics for {data['name']} ({data['symbol']}),"
                        f"currency {data['currency']}:\n"
                        f"{json.dumps({k:data[k] for k in ('revenue', 'debt', 'cashFlow', 'valuation','health')}, indent=2)}\n\n"
                        "Return the JSON analysis now."
                    )
                }
            ]
            result = await LLMService.chat(messages, temperature=0.3)

            return {
                "symbol": data["symbol"],
                "model": result["model"],
                "fundamentals": data,
                "analysis": _parse(
                    result["content"],
                    {
                        "summary": result["content"].strip(),
                        "revenue_analysis": "",
                        "debt_analysis": "",
                        "cash_flow_analysis": "",
                        "strengths": [],
                        "weaknesses": [],
                        "verdict": "MODERATE",
                    },
                ),
            }
        except HTTPException:
            raise
        except Exception as e :
            raise HTTPException(502, f"Fundamental agent failed: {e}")


        