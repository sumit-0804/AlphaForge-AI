import json
import asyncio
import logging
from operator import add
from typing import Annotated, TypedDict

from fastapi import HTTPException
from langgraph.graph import StateGraph, START, END

from app.services.market_data import MarketDataService
from app.services.technical_analysis import TechnicalAnalysisService
from app.services.fundamentals import FundamentalService
from app.services.llm_service import LLMService
from app.services.memory import MemoryService
from app.agents.news_agent import NewsAgentService
from app.agents.schemas import DebateArgument, DebateDecision, DebateRebuttal
from app.core.exchanges import get_exchange
from app.models.recommendation import Recommendation

BULL_PROMPT = (
    "You are the BULL analyst at AlphaForge. Given the evidence, argue the "
    "strongest possible BUY case for this stock. Be specific and cite the "
    "numbers. This is educational analysis, not financial advice."
)

BEAR_PROMPT = (
    "You are the BEAR analyst at AlphaForge. Given the evidence, argue the "
    "strongest possible case to AVOID or SELL this stock. Be specific and cite "
    "the numbers. This is educational analysis, not financial advice."
)

MODERATOR_PROMPT = (
    "You are the MODERATOR at AlphaForge, a neutral investment committee chair. "
    "You are given the raw evidence plus the FULL multi-round debate transcript "
    "between the Bull and Bear analysts (opening arguments followed by rebuttals). "
    "Judge which side's points survived rebuttal and weigh both sides objectively. "
    "The evidence may include a 'memory' block: 'prior_lessons' and "
    "'past_recommendations' are this stock's own history, while "
    "'cross_ticker_lessons' are lessons learned on OTHER stocks that were in a "
    "similar setup — treat those as general pattern warnings, not as events that "
    "happened to this company, and say which stock a lesson came from if you cite "
    "it. If present, explicitly weigh these lessons and note in your rationale when "
    "history informs the call (e.g. repeating a past mistake or confirming a prior "
    "thesis). The evidence may also include a 'risk' block (volatility, beta, "
    "risk_level): a high-risk name does not change whether to buy or sell, but it "
    "should make you more cautious about a HIGH confidence rating. The evidence may "
    "also carry a 'research' block — an analyst's earlier written view on this stock — "
    "and a 'fundamentals.narrative' block reading the financials in plain language. "
    "Weigh both as inputs alongside everything else; neither is a verdict to defer to, "
    "and you may overrule either where the debate or the numbers contradict it. "
    "Issue a final, explainable decision. "
    "This is educational analysis, not financial advice."
)


logger = logging.getLogger(__name__)

# Keep this small or other stocks' lessons drown out this one's own history.
_CROSS_TICKER_K = 3


def _debate_event(node: str, data: dict) -> dict | None:
    # One mapping from debate-graph node to UI event, shared by debate() and debate_stream().
    if node == "opening":
        return {"type": "opening", "round": data.get("round"),
                "bull": data.get("bull"), "bear": data.get("bear")}
    if node == "rebut":
        return {"type": "rebuttal", "round": data.get("round"),
                "bull": data.get("bull"), "bear": data.get("bear"),
                "converged": data.get("converged")}
    if node == "moderate":
        return {"type": "decision", "model": data.get("model"),
                "decision": data.get("decision"),
                "decision_valid": data.get("decision_valid", False)}
    return None


def _rebuttal_prompt(stance: str, goal: str) -> str:
    # has_new_points/concede are what let the debate loop stop early.
    return (
        f"You are the {stance} analyst at AlphaForge in a live investment debate. "
        f"You are arguing the {goal} case. You are now shown the opposing analyst's "
        "latest argument. Directly REBUT their strongest points, citing specific "
        "numbers from the evidence, and sharpen your own case. Be intellectually "
        "honest: if the opposing case is genuinely decisive, concede. "
        f"Report your stance as {stance}. "
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

    @staticmethod
    def _situation_query(context: dict | None) -> str:
        # Describe the setup in words (no company name) to find lessons from similar trades.
        ctx = context or {}
        parts: list[str] = []

        sector = (ctx.get("profile") or {}).get("sector") or ctx.get("sector")
        if sector:
            parts.append(f"{sector} sector")

        t = ctx.get("technical") or {}
        price, e20, e50 = t.get("price"), t.get("ema_20"), t.get("ema_50")
        if price and e20 and e50:
            if price > e20 > e50:
                parts.append("uptrend, price above EMA20 and EMA50")
            elif price < e20 < e50:
                parts.append("downtrend, price below EMA20 and EMA50")
            else:
                parts.append("choppy trend, mixed EMA alignment")

        rsi = t.get("rsi")
        if rsi is not None:
            parts.append(
                f"RSI {round(rsi)} overbought" if rsi >= 70
                else f"RSI {round(rsi)} oversold" if rsi <= 30
                else f"RSI {round(rsi)} neutral momentum"
            )

        macd = t.get("macd")
        if macd is not None:
            parts.append(f"{'positive' if macd >= 0 else 'negative'} MACD")

        adx = t.get("adx")
        if adx is not None:
            parts.append("strong trend" if adx >= 25 else "weak or ranging trend")

        # Debate calls it "fundamentals", the workflow calls it "fundamental" — accept both.
        health = (
            (ctx.get("fundamentals") or {}).get("health")
            or (ctx.get("fundamental") or {}).get("health")
            or {}
        )
        if health.get("label"):
            parts.append(f"{str(health['label']).lower()} financial health")

        if not parts:
            return "trading lessons and mistakes from past closed trades"
        return "trading lessons for a setup like: " + ", ".join(parts)

    @staticmethod
    async def _lesson_status(recalled_any: bool, user_id: str) -> str:
        # Say WHY recall is empty: nothing learned yet, or the index is broken. The
        # document count is the source of truth — it holds even if the index does not.
        if recalled_any:
            return "ok"
        try:
            stored = await MemoryService.recent(type="lesson", user_id=user_id, limit=20)
        except Exception:
            logger.exception("Could not read stored lessons to diagnose empty recall")
            return "unknown"
        if not stored:
            return "no_lessons_yet"

        # Lessons are stored but none came back. Either the index isn't answering at
        # all, or it is and these particular entries never got a vector written.
        index_ready = await MemoryService.vector_index_ready()
        status = "index_degraded" if index_ready else "index_unavailable"
        logger.warning(
            "Learning loop %s: %d stored lesson(s) for %s, none searchable "
            "(vector_index_ready=%s, entries_with_embed_error=%d)",
            status, len(stored), user_id, index_ready,
            sum(1 for e in stored if e.metadata.get("_index_error")),
        )
        return status

    @classmethod
    async def recall_memory(
        cls, ticker: str, user_id: str, context: dict | None = None
    ) -> dict:
        # Pull what we've learned about this stock before arguing the case.
        ticker = ticker.upper()
        try:
            lessons = await MemoryService.search(
                f"trading lessons and outcomes for {ticker}",
                k=3, type="lesson", ticker=ticker, user_id=user_id,
            )
        except Exception:
            lessons = []

        # Also pull lessons from other stocks in a similar setup — a mistake costs the same anywhere.
        seen = {l.get("id") for l in lessons}
        cross: list[dict] = []
        try:
            hits = await MemoryService.search(
                cls._situation_query(context),
                # Fetch extra since same-ticker hits and duplicates get dropped below.
                k=_CROSS_TICKER_K + len(seen) + 2,
                type="lesson", user_id=user_id,
            )
            for h in hits:
                if h.get("id") in seen or (h.get("ticker") or "").upper() == ticker:
                    continue
                seen.add(h.get("id"))
                cross.append({"ticker": h.get("ticker"), "content": h["content"]})
                if len(cross) >= _CROSS_TICKER_K:
                    break
        except Exception:
            cross = []

        status = await cls._lesson_status(bool(lessons or cross), user_id)

        try:
            past = (
                await Recommendation.find(
                    Recommendation.user_id == user_id,
                    Recommendation.symbol == ticker,
                )
                .sort("-created_at").limit(3).to_list()
            )
            past_recs = [
                {
                    "action": r.action,
                    "confidence": r.confidence,
                    "rationale": r.rationale,
                    "at": r.created_at.isoformat(),
                }
                for r in past
            ]
        except Exception:
            past_recs = []

        return {
            "prior_lessons": [l["content"] for l in lessons],
            # Kept separate — these happened to other stocks, not this one.
            "cross_ticker_lessons": cross,
            "past_recommendations": past_recs,
            "status": status,
        }
    
    @classmethod
    async def _argue(cls, prompt:str, context:dict, ticker:str, stance:str) -> dict:
        messages = [
            {"role": "system", "content": prompt},
            {
                "role": "user",
                "content": (
                    f"Evidence for {ticker}:\n"
                    f"{json.dumps(context, indent=2, default=str)}\n\n"
                    "Make your case now."
                ),
            },
        ]
        result = await LLMService.chat_json(
            messages,
            DebateArgument,
            fallback=DebateArgument(stance=stance, arguments=[], key_point=""),
            temperature=0.1,
        )
        return result["data"].model_dump()

    @classmethod
    async def _rebut(
        cls,
        stance: str,
        goal: str,
        context: dict,
        ticker: str,
        own_last: dict,
        opponent_last: dict,
    ) -> dict:
        messages = [
            {"role": "system", "content": _rebuttal_prompt(stance, goal)},
            {
                "role": "user",
                "content": (
                    f"Evidence for {ticker}:\n{json.dumps(context, indent=2, default=str)}\n\n"
                    f"Your previous argument:\n{json.dumps(own_last, indent=2)}\n\n"
                    f"Opposing analyst's latest argument:\n{json.dumps(opponent_last, indent=2)}\n\n"
                    "Rebut them now."
                ),
            },
        ]
        result = await LLMService.chat_json(
            messages,
            DebateRebuttal,
            # Only reached after retries; assume nothing new so the debate can end.
            fallback=DebateRebuttal(
                stance=stance,
                rebuttals=[],
                arguments=own_last.get("arguments", []),
                key_point=own_last.get("key_point", ""),
                has_new_points=False,
                concede=False,
            ),
            temperature=0.1,
        )
        return result["data"].model_dump()

    @classmethod
    async def _context_for(
        cls, ticker: str, user_id: str, include_news: bool, risk: dict | None
    ) -> dict:
        """Gather evidence for a standalone debate. The workflow passes its own instead."""
        context = await cls._gather_context(ticker, include_news)
        if risk:
            context["risk"] = risk
        # Recall past lessons and calls so the committee argues with memory, not blind.
        context["memory"] = await cls.recall_memory(ticker, user_id, context=context)
        return context

    @classmethod
    async def debate(
        cls, ticker: str, user_id: str, include_news: bool = True, max_rounds: int = 2,
        risk: dict | None = None, context: dict | None = None, on_event=None,
    ) -> dict:
        """Run the committee. `context` skips gathering; `on_event` streams each round."""
        try:
            if context is None:
                context = await cls._context_for(ticker, user_id, include_news, risk)
            if on_event:
                on_event({"type": "memory", "memory": context.get("memory")})

            # Loop: opening -> rebuttals -> moderate, cycling until they converge or hit max_rounds.
            final: dict = {}
            async for mode, chunk in _debate_graph.astream(
                {
                    "ticker": ticker.upper(),
                    "context": context,
                    "max_rounds": max(1, max_rounds),
                },
                stream_mode=["values", "updates"],
            ):
                if mode == "values":
                    final = chunk
                elif on_event:
                    for node, data in chunk.items():
                        if ev := _debate_event(node, data):
                            on_event(ev)

            transcript = final.get("transcript", [])
            return {
                "symbol": ticker.upper(),
                "model": final.get("model"),
                "memory": context.get("memory"),
                "rounds": len(transcript),
                "converged": final.get("converged", False),
                "transcript": transcript,
                "bull": final.get("bull"),
                "bear": final.get("bear"),
                "decision": final.get("decision", {}),
                "decision_valid": final.get("decision_valid", False),
            }
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Debate agent failed: {e}")

    @classmethod
    async def debate_stream(
        cls, ticker: str, user_id: str, include_news: bool = True, max_rounds: int = 2,
        risk: dict | None = None,
    ):
        """Same as debate() but yields an event after each phase so the UI can show it live."""
        ticker = ticker.upper()
        try:
            yield {"type": "status", "phase": "evidence",
                   "message": f"Gathering evidence for {ticker}…"}
            context = await cls._context_for(ticker, user_id, include_news, risk)
            yield {"type": "memory", "memory": context.get("memory")}

            yield {"type": "status", "phase": "debate",
                   "message": "Committee convening — opening statements…"}

            # "updates" mode emits one event per node as it finishes.
            async for update in _debate_graph.astream(
                {"ticker": ticker, "context": context, "max_rounds": max(1, max_rounds)},
                stream_mode="updates",
            ):
                for node, data in update.items():
                    if ev := _debate_event(node, data):
                        yield ev

            yield {"type": "done", "symbol": ticker}
        except Exception as e:
            yield {"type": "error", "message": str(e)}


# Debate loop: opening -> rebut -> ... -> moderate, looping on rebut until they converge.

class DebateState(TypedDict, total=False):
    ticker: str
    context: dict
    max_rounds: int
    round: int
    bull: dict
    bear: dict
    transcript: Annotated[list, add]
    converged: bool
    decision: dict
    decision_valid: bool
    decision_attempts: int
    model: str


async def _opening_node(state: DebateState) -> dict:
    ctx, ticker = state["context"], state["ticker"]
    # Bull and Bear open independently, so run them at the same time.
    bull, bear = await asyncio.gather(
        DebateAgentService._argue(BULL_PROMPT, ctx, ticker, "BULL"),
        DebateAgentService._argue(BEAR_PROMPT, ctx, ticker, "BEAR"),
    )
    return {
        "round": 1,
        "bull": bull,
        "bear": bear,
        "transcript": [{"round": 1, "bull": bull, "bear": bear}],
        "converged": False,
    }


async def _rebut_node(state: DebateState) -> dict:
    ctx, ticker = state["context"], state["ticker"]
    bull_prev, bear_prev = state["bull"], state["bear"]
    # Each side rebuts the other's latest argument, at the same time.
    bull, bear = await asyncio.gather(
        DebateAgentService._rebut("BULL", "BUY", ctx, ticker, bull_prev, bear_prev),
        DebateAgentService._rebut("BEAR", "SELL or AVOID", ctx, ticker, bear_prev, bull_prev),
    )
    rnd = state["round"] + 1
    converged = (
        bool(bull.get("concede"))
        or bool(bear.get("concede"))
        or (not bull.get("has_new_points", True) and not bear.get("has_new_points", True))
    )
    return {
        "round": rnd,
        "bull": bull,
        "bear": bear,
        "transcript": [{"round": rnd, "bull": bull, "bear": bear}],
        "converged": converged,
    }


def _should_continue(state: DebateState) -> str:
    # Stop once the sides converge or we hit the round cap.
    if state.get("converged"):
        return "moderate"
    if state["round"] >= state.get("max_rounds", 2):
        return "moderate"
    return "rebut"


async def _moderate_node(state: DebateState) -> dict:
    ctx, ticker = state["context"], state["ticker"]
    transcript = state.get("transcript", [])
    bull, bear = state.get("bull", {}), state.get("bear", {})
    mod_messages = [
        {"role": "system", "content": MODERATOR_PROMPT},
        {
            "role": "user",
            "content": (
                f"Evidence for {ticker}:\n{json.dumps(ctx, indent=2, default=str)}\n\n"
                f"Full debate transcript ({len(transcript)} round(s)):\n"
                f"{json.dumps(transcript, indent=2, default=str)}\n\n"
                "Return your JSON decision now."
            ),
        },
    ]
    result = await LLMService.chat_json(
        mod_messages,
        DebateDecision,
        fallback=DebateDecision(
            decision="HOLD",
            confidence="LOW",
            rationale=(
                "The moderator did not return a well-formed verdict after retries. "
                "Defaulting to HOLD — treat this as a failed analysis, not a judgement."
            ),
            bull_summary=bull.get("key_point", ""),
            bear_summary=bear.get("key_point", ""),
            key_catalysts=[],
            key_risks=[],
        ),
        temperature=0.1,
    )
    # decision_valid=False means this HOLD is a fallback, not a real verdict.
    return {
        "decision": result["data"].model_dump(),
        "model": result["model"],
        "decision_valid": result["valid"],
        "decision_attempts": result["attempts"],
    }


def _build_debate_graph():
    g = StateGraph(DebateState)
    g.add_node("opening", _opening_node)
    g.add_node("rebut", _rebut_node)
    g.add_node("moderate", _moderate_node)

    g.add_edge(START, "opening")
    # These conditional edges form the loop back to rebut, or exit to moderate.
    g.add_conditional_edges("opening", _should_continue,
                            {"rebut": "rebut", "moderate": "moderate"})
    g.add_conditional_edges("rebut", _should_continue,
                            {"rebut": "rebut", "moderate": "moderate"})
    g.add_edge("moderate", END)
    return g.compile()


_debate_graph = _build_debate_graph()

