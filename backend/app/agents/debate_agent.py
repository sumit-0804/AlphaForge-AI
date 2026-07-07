import json
import asyncio

from fastapi import HTTPException

from app.services.market_data import MarketDataService
from app.services.technical_analysis import TechnicalAnalysisService
from app.services.fundamentals import FundamentalService
from app.services.llm_service import LLMService
from app.agents.news_agent import NewsAgentService
from app.agents.util import _parse
from app.core.exchanges import get_exchange

BULL_PROMPT = (
    "You are the BULL analyst at AlphaForge. Given the evidence, argue the "
    "strongest possible BUY case for this stock. Be specific and cite the "
    "numbers. Respond ONLY with a valid JSON object — no markdown:\n"
    "{\n"
    '  "stance": "BULL",\n'
    '  "arguments": ["specific point citing data", "..."],\n'
    '  "key_point": "your single strongest argument"\n'
    "}\n"
    "This is educational analysis, not financial advice."
)

BEAR_PROMPT = (
    "You are the BEAR analyst at AlphaForge. Given the evidence, argue the "
    "strongest possible case to AVOID or SELL this stock. Be specific and cite "
    "the numbers. Respond ONLY with a valid JSON object — no markdown:\n"
    "{\n"
    '  "stance": "BEAR",\n'
    '  "arguments": ["specific point citing data", "..."],\n'
    '  "key_point": "your single strongest argument"\n'
    "}\n"
    "This is educational analysis, not financial advice."
)

MODERATOR_PROMPT = (
    "You are the MODERATOR at AlphaForge, a neutral investment committee chair. "
    "You are given the raw evidence plus the Bull and Bear arguments. Weigh both "
    "sides objectively and issue a final, explainable decision. Respond ONLY with "
    "a valid JSON object — no markdown:\n"
    "{\n"
    '  "decision": "BUY | HOLD | SELL",\n'
    '  "confidence": "LOW | MEDIUM | HIGH",\n'
    '  "rationale": "2-3 sentences explaining the verdict",\n'
    '  "bull_summary": "1 sentence steelman of the bull case",\n'
    '  "bear_summary": "1 sentence steelman of the bear case",\n'
    '  "key_catalysts": ["what could prove the bull right"],\n'
    '  "key_risks": ["what could prove the bear right"]\n'
    "}\n"
    "This is educational analysis, not financial advice."
)

class DebateAgentService:

    @classmethod
    async def _gather_context(cls, ticker:str,include_news:bool)->dict:
        def _sync():
            info = MarketDataService.get_stock_info(ticker)
            tech = TechnicalAnalysisService.get_technical_indicators(ticker).get("latest", {})
            fund = FundamentalService.get_fundamentals(ticker)
            ex = get_exchange(ticker)
            return {
                "profile": {
                    "symbol": info.get("symbol"),
                    "name": info.get("longName") or info.get("shortName"),
                    "sector": info.get("sector"),
                    "currentPrice": info.get("currentPrice"),
                    "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
                    "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
                    "currency": info.get("currency") or ex.currency or "USD",
                },
                "technical": tech,
                "fundamentals": {
                    "revenue": fund["revenue"],
                    "debt": fund["debt"],
                    "cashFlow": fund["cashFlow"],
                    "valuation": fund["valuation"],
                    "health": fund["health"],
                },
            }
        
        context= await asyncio.to_thread(_sync)
        if include_news:
            try:
                news = await NewsAgentService.analyze(ticker)
                context["news"] = news.get("analysis")
            except Exception:
                context["news"] = None
        else:
            context["news"] = None
        return context
    
    @classmethod
    async def _argue(cls, prompt:str, context:dict, ticker:str, stance:str) -> dict:
        messages = [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": (
                    f"Evidence for {ticker}:\n"
                    f"{json.dumps(context, indent=2, default=str)}\n\n"
                    "Return your JSON now."
                ),
            },
        ]
        result = await LLMService.chat(messages, temperature=0.5)
        return _parse(
            result["content"],
            {"stance": stance, "arguments": [result["content"].strip()], "key_point": ""},
        )
    
    @classmethod
    async def debate(cls, ticker: str, include_news: bool = True) -> dict:
        try:
            context = await cls._gather_context(ticker, include_news)

            # Bull and Bear are independent — run them concurrently.
            bull, bear = await asyncio.gather(
                cls._argue(BULL_PROMPT, context, ticker, "BULL"),
                cls._argue(BEAR_PROMPT, context, ticker, "BEAR"),
            )

            mod_messages = [
                {"role": "system", "content": MODERATOR_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Evidence for {ticker}:\n{json.dumps(context, indent=2, default=str)}\n\n"
                        f"Bull argument:\n{json.dumps(bull, indent=2)}\n\n"
                        f"Bear argument:\n{json.dumps(bear, indent=2)}\n\n"
                        "Return your JSON decision now."
                    ),
                },
            ]
            result = await LLMService.chat(mod_messages, temperature=0.3)
            decision = _parse(
                result["content"],
                {
                    "decision": "HOLD",
                    "confidence": "LOW",
                    "rationale": result["content"].strip(),
                    "bull_summary": bull.get("key_point", ""),
                    "bear_summary": bear.get("key_point", ""),
                    "key_catalysts": [],
                    "key_risks": [],
                },
            )

            return {
                "symbol": ticker.upper(),
                "model": result["model"],
                "bull": bull,
                "bear": bear,
                "decision": decision,
            }
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Debate agent failed: {e}")

