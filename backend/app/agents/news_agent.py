import json
import asyncio
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import feedparser
from fastapi import HTTPException

from app.agents.schemas import NewsAnalysis
from app.services.llm_service import LLMService
from app.core.config import settings
from app.core.exchanges import news_query, news_country, split_ticker
from app.services.market_data import MarketDataService


# Corporate suffixes match everything, so they cannot identify a subject.
_NAME_NOISE = {"limited", "ltd", "inc", "corporation", "corp", "plc", "company", "the", "and"}


def _rss_url(query: str, country: str) -> str:
    # The ticker's own exchange wins; the setting is only a fallback. Reversing these
    # sent every Indian query to the US edition, which returned months-old coverage.
    url = f"https://news.google.com/rss/search?q={quote_plus(query)}&hl={settings.news_lang}"
    gl = country or settings.news_country
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
    def _company_name(ticker: str) -> str | None:
        # Cached alongside the profile node's own lookup, so this costs nothing.
        try:
            info = MarketDataService.get_stock_info(ticker)
        except Exception:
            return None
        return info.get("longName") or info.get("shortName")

    @staticmethod
    def _subject_terms(ticker: str, name: str | None) -> list[str]:
        # The symbol plus the distinctive words of the name, minus corporate suffixes.
        base = split_ticker(ticker)[0].lower()
        words = re.findall(r"[a-z]+", (name or "").lower())
        return [base] + [w for w in words if w not in _NAME_NOISE and len(w) > 2]

    @staticmethod
    def _is_about(title: str | None, terms: list[str]) -> bool:
        # Indian roundups ("8 stocks that hit upper circuit") name many tickers and say
        # nothing about any of them; scoring sentiment on those is worse than no news.
        low = (title or "").lower()
        return any(t in low for t in terms)

    @staticmethod
    def _is_recent(published: str | None, days: int) -> bool:
        # Google mostly honours when:, but drop anything older that slips through.
        if not published:
            return True
        try:
            age = datetime.now(timezone.utc) - parsedate_to_datetime(published)
        except Exception:
            return True
        return age <= timedelta(days=days)

    @classmethod
    def _fetch_rss_sync(cls, ticker: str, limit: int) -> list[dict]:
        days = max(1, settings.news_days)
        name = cls._company_name(ticker)
        query = f"{news_query(ticker, name)} when:{days}d"
        feed = feedparser.parse(_rss_url(query, news_country(ticker)))
        terms = cls._subject_terms(ticker, name)
        articles = []
        for entry in feed.entries:
            if len(articles) >= limit:
                break
            if not cls._is_recent(entry.get("published"), days):
                continue
            if not cls._is_about(entry.get("title"), terms):
                continue
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