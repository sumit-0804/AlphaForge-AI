import json
import asyncio
from urllib.parse import quote_plus

import feedparser
from fastapi import HTTPException

from app.services.llm_service import LLMService
from app.core.config import settings
from app.core.exchanges import news_query, news_country


def _rss_url(query: str, country: str) -> str:
    # Explicit setting wins; otherwise auto-detect the edition from the ticker's
    # exchange; blank -> Google's global/IP-based English edition.
    url = f"https://news.google.com/rss/search?q={quote_plus(query)}&hl={settings.news_lang}"
    gl = settings.news_country or country
    if gl:
        url += f"&gl={gl}&ceid={gl}:{settings.news_lang}"
    return url


SYSTEM_PROMPT = (
    "You are AlphaForge News Agent. You are given recent news headlines for a "
    "single stock. Summarise the news and judge market sentiment. Respond ONLY "
    "with a valid JSON object — no markdown, no text outside the JSON:\n"
    "{\n"
    '  "summary": "3-4 sentence digest of the key themes across the headlines",\n'
    '  "overall_sentiment": "BULLISH | BEARISH | NEUTRAL",\n'
    '  "sentiment_score": 0.0,   // -1.0 (very bearish) to 1.0 (very bullish)\n'
    '  "highlights": ["short bullet of a notable item", "..."]\n'
    "}\n"
    "This is educational analysis, not financial advice."
)


class NewsAgentService:
    # Phase 8: fetch RSS headlines, then summarise + score sentiment via the LLM.
    # Query terms and the news edition both come from the central exchange registry.

    @staticmethod
    def _fetch_rss_sync(ticker: str, limit: int) -> list[dict]:
        feed = feedparser.parse(_rss_url(news_query(ticker), news_country(ticker)))
        articles = []
        for entry in feed.entries[:limit]:
            source = entry.get("source")
            articles.append(
                {
                    "title": entry.get("title"),
                    "link": entry.get("link"),
                    "published": entry.get("published"),
                    "source": source.get("title") if source else None,
                }
            )
        return articles

    @classmethod
    async def fetch_rss(cls, ticker: str, limit: int = 10) -> list[dict]:
        # feedparser.parse is blocking I/O — run it off the event loop.
        return await asyncio.to_thread(cls._fetch_rss_sync, ticker.upper(), limit)

    @classmethod
    async def analyze(cls, ticker: str, limit: int = 10) -> dict:
        try:
            articles = await cls.fetch_rss(ticker, limit)
            if not articles:
                return {
                    "symbol": ticker.upper(),
                    "model": None,
                    "articles": [],
                    "analysis": {
                        "summary": "No recent news found.",
                        "overall_sentiment": "NEUTRAL",
                        "sentiment_score": 0.0,
                        "highlights": [],
                    },
                }

            headlines = [
                {"title": a["title"], "source": a["source"]} for a in articles
            ]
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"News headlines for {ticker.upper()}:\n"
                        f"{json.dumps(headlines, indent=2)}\n\n"
                        "Return the JSON analysis now."
                    ),
                },
            ]
            result = await LLMService.chat_json(
                messages,
                fallback={
                    "summary": "Could not parse a structured news analysis.",
                    "overall_sentiment": "NEUTRAL",
                    "sentiment_score": 0.0,
                    "highlights": [],
                },
                temperature=0.3,
            )
            return {
                "symbol": ticker.upper(),
                "model": result["model"],
                "articles": articles,
                "analysis": result["data"],
            }
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"News agent failed: {e}")