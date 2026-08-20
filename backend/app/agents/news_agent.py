import json
import asyncio
from urllib.parse import quote_plus

import feedparser
from fastapi import HTTPException

from app.agents.schemas import NewsAnalysis
from app.services.llm_service import LLMService
from app.core.config import settings
from app.core.exchanges import news_query, news_country


def _rss_url(query: str, country: str) -> str:
    # Use the configured edition, else the ticker's exchange, else the global one.
    url = f"https://news.google.com/rss/search?q={quote_plus(query)}&hl={settings.news_lang}"
    gl = settings.news_country or country
    if gl:
        url += f"&gl={gl}&ceid={gl}:{settings.news_lang}"
    return url


SYSTEM_PROMPT = (
    "You are AlphaForge News Agent. You are given recent news headlines for a "
    "single stock. Summarise the news and judge market sentiment. "
    "This is educational analysis, not financial advice."
)


class NewsAgentService:
    # Fetch RSS headlines, then summarise and score sentiment via the LLM.

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
        # feedparser.parse blocks, so run it in a thread.
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
                NewsAnalysis,
                fallback=NewsAnalysis(
                    summary="Could not parse a structured news analysis.",
                    overall_sentiment="NEUTRAL",
                    sentiment_score=0.0,
                    highlights=[],
                ),
                temperature=0.1,
            )
            return {
                "symbol": ticker.upper(),
                "model": result["model"],
                "articles": articles,
                # Dumped here: this rides into prompts and SSE, where a model would
                # serialise as a Python repr.
                "analysis": result["data"].model_dump(),
            }
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"News agent failed: {e}")