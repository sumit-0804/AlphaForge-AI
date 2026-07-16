import json
import asyncio
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
from app.agents.util import _parse
from app.core.exchanges import get_exchange
from app.models.recommendation import Recommendation

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
    "You are given the raw evidence plus the FULL multi-round debate transcript "
    "between the Bull and Bear analysts (opening arguments followed by rebuttals). "
    "Judge which side's points survived rebuttal and weigh both sides objectively. "
    "The evidence may include a 'memory' block with prior lessons learned from past "
    "closed trades and previous recommendations on this stock — if present, "
    "explicitly weigh those lessons and note in your rationale when history informs "
    "the call (e.g. repeating a past mistake or confirming a prior thesis). Issue a "
    "final, explainable decision. Respond ONLY with a valid JSON object — no "
    "markdown:\n"
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


def _validate_decision(obj: dict) -> str | None:
    # Semantic gate on the moderator's verdict. This is the single most important
    # LLM output in the system — everything downstream (the recommendation, the
    # stored history, the next run's memory) is built from it. A silent fallback
    # to HOLD/LOW here is indistinguishable from a genuine HOLD, so we insist the
    # model produces a well-formed verdict and only fall back once retries fail.
    if obj.get("decision") not in ("BUY", "HOLD", "SELL"):
        return "The 'decision' field must be exactly one of BUY, HOLD or SELL."
    if obj.get("confidence") not in ("LOW", "MEDIUM", "HIGH"):
        return "The 'confidence' field must be exactly one of LOW, MEDIUM or HIGH."
    if not isinstance(obj.get("rationale"), str) or not obj["rationale"].strip():
        return "The JSON is missing a non-empty 'rationale' string."
    return None


def _rebuttal_prompt(stance: str, goal: str) -> str:
    # System prompt for a rebuttal turn. The analyst sees the opponent's latest
    # argument and must counter it — and honestly signal whether the debate still
    # has anywhere to go, which is what lets the loop exit early on convergence.
    return (
        f"You are the {stance} analyst at AlphaForge in a live investment debate. "
        f"You are arguing the {goal} case. You are now shown the opposing analyst's "
        "latest argument. Directly REBUT their strongest points, citing specific "
        "numbers from the evidence, and sharpen your own case. Be intellectually "
        "honest: if the opposing case is genuinely decisive, concede. Respond ONLY "
        "with a valid JSON object — no markdown:\n"
        "{\n"
        f'  "stance": "{stance}",\n'
        '  "rebuttals": ["direct counter to a specific opposing point, citing data"],\n'
        '  "arguments": ["your sharpened key points"],\n'
        '  "key_point": "your single strongest argument after this exchange",\n'
        '  "has_new_points": true,   // false if you have nothing material left to add\n'
        '  "concede": false          // true only if the opposing case is decisively stronger\n'
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
    async def _recall_memory(cls, ticker: str, user_id: str = "default_user") -> dict:
        # Close the learning loop: before arguing the case, pull what AlphaForge
        # already knows about THIS stock — lessons distilled from past closed
        # trades and the recommendations it issued before — so today's decision is
        # informed by prior outcomes instead of starting from a blank slate.
        ticker = ticker.upper()
        try:
            lessons = await MemoryService.search(
                f"trading lessons and outcomes for {ticker}",
                k=3, type="lesson", ticker=ticker, user_id=user_id,
            )
        except Exception:
            lessons = []

        try:
            past = (
                await Recommendation.find(Recommendation.symbol == ticker)
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
            "past_recommendations": past_recs,
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
                    "Return your JSON rebuttal now."
                ),
            },
        ]
        result = await LLMService.chat(messages, temperature=0.5)
        return _parse(
            result["content"],
            {
                "stance": stance,
                "rebuttals": [result["content"].strip()],
                "arguments": own_last.get("arguments", []),
                "key_point": own_last.get("key_point", ""),
                # If the model returned unparseable output, assume it had nothing
                # new to add so the debate can converge rather than loop pointlessly.
                "has_new_points": False,
                "concede": False,
            },
        )

    @classmethod
    async def debate(
        cls, ticker: str, include_news: bool = True, max_rounds: int = 2
    ) -> dict:
        try:
            context = await cls._gather_context(ticker, include_news)
            # Recall prior lessons + past calls on this ticker so the committee
            # argues with memory of what happened last time, not from scratch.
            context["memory"] = await cls._recall_memory(ticker)

            # Run the multi-round debate loop: opening -> (rebut -> rebut -> ...) ->
            # moderate. The graph cycles on the "rebut" node until the analysts
            # converge (concede / no new points) or max_rounds is reached.
            final = await _debate_graph.ainvoke(
                {
                    "ticker": ticker.upper(),
                    "context": context,
                    "max_rounds": max(1, max_rounds),
                }
            )

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
        cls, ticker: str, include_news: bool = True, max_rounds: int = 2
    ):
        """Async generator that yields the debate as it unfolds, round by round.

        Same loop as `debate()`, but instead of returning only the final result it
        streams a semantic event after each phase — evidence gathered, memory
        recalled, opening statements, every rebuttal round, and the moderator's
        verdict — so the UI can render the committee arguing live.
        """
        ticker = ticker.upper()
        try:
            yield {"type": "status", "phase": "evidence",
                   "message": f"Gathering evidence for {ticker}…"}
            context = await cls._gather_context(ticker, include_news)

            memory = await cls._recall_memory(ticker)
            context["memory"] = memory
            yield {"type": "memory", "memory": memory}

            yield {"type": "status", "phase": "debate",
                   "message": "Committee convening — opening statements…"}

            # stream_mode="updates" emits each node's return as it completes, which
            # is exactly one debate phase per event.
            async for update in _debate_graph.astream(
                {"ticker": ticker, "context": context, "max_rounds": max(1, max_rounds)},
                stream_mode="updates",
            ):
                for node, data in update.items():
                    if node == "opening":
                        yield {"type": "opening", "round": data.get("round"),
                               "bull": data.get("bull"), "bear": data.get("bear")}
                    elif node == "rebut":
                        yield {"type": "rebuttal", "round": data.get("round"),
                               "bull": data.get("bull"), "bear": data.get("bear"),
                               "converged": data.get("converged")}
                    elif node == "moderate":
                        yield {"type": "decision", "model": data.get("model"),
                               "decision": data.get("decision"),
                               "decision_valid": data.get("decision_valid", False)}

            yield {"type": "done", "symbol": ticker}
        except Exception as e:
            yield {"type": "error", "message": str(e)}


# --- Multi-round debate loop (LangGraph cycle) ------------------------------
# opening -> should_continue? -> rebut -> should_continue? -> ... -> moderate
# The conditional edge is the loop: it routes back to "rebut" until the two
# analysts converge or the round cap is hit, then hands off to the moderator.

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
    # Bull and Bear open independently — run them concurrently.
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
    # Each side rebuts the OTHER side's most recent argument, concurrently.
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
    # The loop's exit test: stop once the sides converge or the cap is reached.
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
        fallback={
            "decision": "HOLD",
            "confidence": "LOW",
            "rationale": (
                "The moderator did not return a well-formed verdict after retries. "
                "Defaulting to HOLD — treat this as a failed analysis, not a judgement."
            ),
            "bull_summary": bull.get("key_point", ""),
            "bear_summary": bear.get("key_point", ""),
            "key_catalysts": [],
            "key_risks": [],
        },
        temperature=0.3,
        validate=_validate_decision,
    )
    # Surface whether the verdict is real or a fallback, so callers can tell a
    # genuine HOLD apart from a parse failure instead of guessing.
    return {
        "decision": result["data"],
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
    # The conditional edges ARE the loop: opening/rebut both route to either
    # another rebuttal round or the moderator.
    g.add_conditional_edges("opening", _should_continue,
                            {"rebut": "rebut", "moderate": "moderate"})
    g.add_conditional_edges("rebut", _should_continue,
                            {"rebut": "rebut", "moderate": "moderate"})
    g.add_edge("moderate", END)
    return g.compile()


_debate_graph = _build_debate_graph()

