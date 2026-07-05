import json
from fastapi import HTTPException

from app.services.market_data import MarketDataService
from app.services.technical_analysis import TechnicalAnalysisService
from app.services.llm_service import LLMService
from app.core.exchanges import get_exchange

SYSTEM_PROMPT = (
    "You are AlphaForge Research Agent, an equity research assistant. "
    "You are given market data, technical indicators and (optionally) recent news "
    "for a single stock. Analyse it objectively and respond ONLY with a valid JSON "
    "object — no markdown, no text outside the JSON. Use this exact schema:\n"
    "{\n"
    '  "summary": "2-3 sentence overview of the stock\'s current state",\n'
    '  "strengths": ["short bullet", "short bullet"],\n'
    '  "weaknesses": ["short bullet", "short bullet"],\n'
    '  "recommendation": "BUY | HOLD | SELL",\n'
    '  "confidence": "LOW | MEDIUM | HIGH",\n'
    '  "rationale": "1-2 sentence justification"\n'
    "}\n"
    "This is educational analysis, not financial advice."
)


class ResearchAgentService:
    # Phase 7: gathers market + technical (+ optional news) context and asks the
    # local LLM for a structured research report.

    @staticmethod
    def _build_context(ticker: str, news: list[dict] | None = None) -> dict:
        info = MarketDataService.get_stock_info(ticker)
        indicators = TechnicalAnalysisService.get_technical_indicators(ticker)
        ex = get_exchange(ticker)
        return {
            "profile": {
                "symbol": info.get("symbol"),
                "name": info.get("longName") or info.get("shortName"),
                "exchange": ex.name,
                "currency": info.get("currency") or ex.currency or "USD",
                "sector": info.get("sector"),
                "industry": info.get("industry"),
                "currentPrice": info.get("currentPrice"),
                "marketCap": info.get("marketCap"),
                "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
                "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
                "volume": info.get("volume"),
                "averageVolume": info.get("averageVolume"),
            },
            "technical": indicators.get("latest", {}),
            "news": news or [],
        }

    @staticmethod
    def _build_messages(ticker: str, context: dict) -> list[dict]:
        prompt = (
            f"Produce a research report for {ticker.upper()}.\n\n"
            f"Market & fundamentals:\n{json.dumps(context['profile'], indent=2)}\n\n"
            f"Latest technical indicators:\n{json.dumps(context['technical'], indent=2)}\n\n"
        )
        prompt += (
            f"Recent news:\n{json.dumps(context['news'], indent=2)}\n\n"
            if context["news"]
            else "Recent news: none provided.\n\n"
        )
        prompt += "Return the JSON research object now."
        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]

    @staticmethod
    def _parse(content: str) -> dict:
        # Local models sometimes wrap JSON in ```fences``` or add stray text.
        text = content.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:]
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end != -1:
            text = text[start : end + 1]
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {
                "summary": content.strip(),
                "strengths": [],
                "weaknesses": [],
                "recommendation": "HOLD",
                "confidence": "LOW",
                "rationale": "Model returned unstructured output.",
            }

    @classmethod
    async def research(cls, ticker: str, news: list[dict] | None = None) -> dict:
        try:
            context = cls._build_context(ticker, news)
            messages = cls._build_messages(ticker, context)
            result = await LLMService.chat(messages, temperature=0.3)
            return {
                "symbol": ticker.upper(),
                "model": result["model"],
                "report": cls._parse(result["content"]),
            }
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Research agent failed: {e}")
