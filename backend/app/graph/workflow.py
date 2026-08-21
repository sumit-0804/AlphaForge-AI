import asyncio
from datetime import datetime, timezone
from operator import add
from typing import Annotated, TypedDict
from uuid import uuid4

from fastapi import HTTPException
from langgraph.config import get_stream_writer
from langgraph.graph import StateGraph, START, END

from app.agents.research_agent import ResearchAgentService
from app.agents.news_agent import NewsAgentService
from app.agents.debate_agent import DebateAgentService
from app.agents.fundamental_agent import FundamentalAgentService
from app.core.exchanges import get_exchange
from app.db.mongo import client as mongo_client
from app.core.config import settings
from app.graph.checkpointer import MongoCheckpointer
from app.services.market_data import MarketDataService
from app.services.technical_analysis import TechnicalAnalysisService
from app.services.fundamentals import FundamentalService
from app.services.risk import RiskService
from app.services.memory import MemoryService
from app.models.recommendation import Recommendation

# The parallel data-gathering nodes. Everything downstream reads their output from
# state rather than fetching its own copy.
GATHER_NODES = frozenset({"profile", "technical", "fundamental", "news", "risk"})


class AnalysisState(TypedDict, total=False):
    ticker: str
    # Whose book this run belongs to. Only the memory-reading nodes use it, but it
    # rides in state so every node can be scoped without changing the graph shape.
    user_id: str
    include_news: bool
    max_rounds: int
    profile: dict
    research: dict
    technical: dict
    fundamental: dict
    fundamental_narrative: dict
    news: dict
    risk: dict
    memory: dict
    consensus: dict
    debate: dict
    recommendation: dict
    errors: Annotated[list[str], add]


# High volatility or beta makes a call less certain, so cap confidence at MEDIUM.
_RISK_CONF_CAP_VOL = 40.0    # annualized %, matching analyze_ticker's units
_RISK_CONF_CAP_BETA = 1.5


def _risk_caps_confidence(risk: dict | None) -> bool:
    if not risk:
        return False
    vol, beta = risk.get("volatility"), risk.get("beta")
    return (vol is not None and vol >= _RISK_CONF_CAP_VOL) or \
           (beta is not None and beta >= _RISK_CONF_CAP_BETA)


def _evidence(state: AnalysisState) -> dict:
    """The one bundle every downstream agent argues from, in the shape the Bull, Bear and
    moderator prompts expect. Without it the debate refetched and never saw news or research."""
    fundamental = dict(state.get("fundamental") or {})
    narrative = state.get("fundamental_narrative")
    if narrative:
        fundamental["narrative"] = narrative

    return {
        "profile": state.get("profile") or {},
        "technical": state.get("technical") or {},
        "fundamentals": fundamental,
        "news": (state.get("news") or {}).get("analysis"),
        "research": (state.get("research") or {}).get("report"),
        "risk": state.get("risk"),
        "memory": state.get("memory"),
    }


async def profile_node(state: AnalysisState) -> dict:
    try:
        info = await asyncio.to_thread(MarketDataService.get_stock_info, state["ticker"])
    except Exception as e:
        return {"errors": [f"profile: {e}"]}

    ex = get_exchange(state["ticker"])
    return {
        "profile": {
            "symbol": info.get("symbol"),
            "name": info.get("longName") or info.get("shortName"),
            "sector": info.get("sector"),
            "currentPrice": info.get("currentPrice"),
            "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
            "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
            "currency": info.get("currency") or ex.currency or "USD",
        }
    }


async def technical_node(state: AnalysisState) -> dict:
    try:
        # yfinance/pandas_ta is sync, so run it in a thread.
        data = await asyncio.to_thread(
            TechnicalAnalysisService.get_technical_indicators, state["ticker"]
        )
        return {"technical": data.get("latest", data)}
    except Exception as e:
        return {"errors": [f"technical: {e}"]}


async def fundamental_node(state: AnalysisState) -> dict:
    try:
        data = await asyncio.to_thread(
            FundamentalService.get_fundamentals, state["ticker"]
        )
    except Exception as e:
        return {"errors": [f"fundamental: {e}"]}

    # Add the plain-language read here; if it fails, keep the numbers anyway.
    out: dict = {"fundamental": data}
    try:
        out["fundamental_narrative"] = await FundamentalAgentService.narrate(data)
    except Exception as e:
        out["errors"] = [f"fundamental_narrative: {e}"]
    return out


async def news_node(state: AnalysisState) -> dict:
    if not state.get("include_news", True):
        return {}
    try:
        return {"news": await NewsAgentService.analyze(state["ticker"])}
    except Exception as e:
        return {"errors": [f"news: {e}"]}


async def risk_node(state: AnalysisState) -> dict:
    try:
        return {"risk": await RiskService.analyze_ticker(state["ticker"])}
    except Exception as e:
        return {"errors": [f"risk: {e}"]}


async def recall_node(state: AnalysisState) -> dict:
    """Long-term memory, recalled once into state instead of privately inside the debate."""
    # Runs after the gather fan-out because the cross-ticker query is built from
    # sector, trend and health — it needs the numbers to describe the setup.
    try:
        return {"memory": await DebateAgentService.recall_memory(
            state["ticker"], state["user_id"], context=state
        )}
    except Exception as e:
        return {
            "memory": {
                "prior_lessons": [], "cross_ticker_lessons": [],
                "past_recommendations": [], "status": "unavailable",
            },
            "errors": [f"recall: {e}"],
        }


async def research_node(state: AnalysisState) -> dict:
    # Handed the gathered evidence, so it usually answers in one call instead of
    # re-fetching the same data through its own tool loop.
    try:
        return {
            "research": await ResearchAgentService.research(
                state["ticker"], state["user_id"], evidence=_evidence(state)
            )
        }
    except Exception as e:
        return {"errors": [f"research: {e}"]}


async def debate_node(state: AnalysisState) -> dict:
    # Emits each round as it happens so the streaming endpoint can forward it live.
    writer = get_stream_writer()
    try:
        return {"debate": await DebateAgentService.debate(
            state["ticker"], state["user_id"],
            context=_evidence(state),
            max_rounds=state.get("max_rounds", 2),
            on_event=writer,
        )}
    except Exception as e:
        return {"errors": [f"debate: {e}"]}


# If every signal agrees, skip the expensive debate and decide directly.

def _signal_votes(state: AnalysisState) -> dict:
    votes: dict[str, int] = {}

    rec = ((state.get("research") or {}).get("report") or {}).get("recommendation")
    if rec in ("BUY", "SELL"):
        votes["research"] = 1 if rec == "BUY" else -1

    t = state.get("technical") or {}
    price, e20, e50 = t.get("price"), t.get("ema_20"), t.get("ema_50")
    if price and e20 and e50:
        if price > e20 > e50:
            votes["technical"] = 1
        elif price < e20 < e50:
            votes["technical"] = -1

    label = ((state.get("fundamental") or {}).get("health") or {}).get("label")
    if label in ("STRONG", "MODERATE"):
        votes["fundamental"] = 1
    elif label in ("WEAK", "POOR"):
        votes["fundamental"] = -1

    senti = ((state.get("news") or {}).get("analysis") or {}).get("overall_sentiment")
    if senti == "BULLISH":
        votes["news"] = 1
    elif senti == "BEARISH":
        votes["news"] = -1

    return votes


# Research reads the same evidence as the other nodes, so its vote is shown but not
# counted toward unanimity — only a dissent from it forces the debate.
_DERIVED_SIGNALS = {"research"}


def _gather_failed(state: AnalysisState) -> list[str]:
    # A crashed gather node must not shrink the vote count into a false unanimity.
    prefixes = tuple(f"{n}:" for n in GATHER_NODES)
    return [e for e in state.get("errors", []) if e.startswith(prefixes)]


def _consensus(state: AnalysisState) -> dict:
    votes = _signal_votes(state)
    independent = {
        k: v for k, v in votes.items() if k not in _DERIVED_SIGNALS and v != 0
    }
    total = sum(independent.values())
    n = len(independent)
    # Unanimous = at least two independent signals all pointing the same way.
    unanimous = n >= 2 and abs(total) == n

    # Research must not contradict them for the quick path.
    research = votes.get("research", 0)
    dissent = bool(unanimous and research and (research > 0) != (total > 0))

    # Risk has magnitude, not direction, so it vetoes the fast path rather than voting:
    # a high-vol or high-beta name always gets the committee, however aligned the signals.
    risk_veto = _risk_caps_confidence(state.get("risk"))
    incomplete = _gather_failed(state)

    skip_debate = unanimous and not dissent and not risk_veto and not incomplete
    action = confidence = None
    if skip_debate:
        action = "BUY" if total > 0 else "SELL"
        # HIGH only when all three signals line up.
        confidence = "HIGH" if n >= 3 else "MEDIUM"
    return {
        "votes": votes,
        "independent_votes": independent,
        "score": total,
        "signals": n,
        "unanimous": unanimous,
        "research_dissent": dissent,
        "risk_veto": risk_veto,
        "incomplete": incomplete,
        "route": "quick" if skip_debate else "debate",
        "action": action,
        "confidence": confidence,
    }


async def gate_node(state: AnalysisState) -> dict:
    return {"consensus": _consensus(state)}


def route_after_gate(state: AnalysisState) -> str:
    # Unanimous signals skip the committee.
    return "quick_decision" if (state.get("consensus") or {}).get("route") == "quick" else "debate"


async def quick_decision_node(state: AnalysisState) -> dict:
    # Signals agree, so decide directly. Memory was already recalled into state.
    c = state.get("consensus") or {}
    direction = "bullish" if c.get("score", 0) > 0 else "bearish"
    decision = {
        "decision": c.get("action", "HOLD"),
        "confidence": c.get("confidence", "MEDIUM"),
        "rationale": (
            f"All {c.get('signals', 0)} independent signals aligned {direction} and the "
            "research agent did not dissent; the Bull/Bear committee debate was "
            "skipped as unnecessary."
        ),
        "key_catalysts": [],
        "key_risks": [],
    }
    return {
        "debate": {
            "symbol": state["ticker"],
            "model": None,
            "memory": state.get("memory"),
            "skipped": True,
            "rounds": 0,
            "converged": True,
            "decision": decision,
        }
    }


def _technical_reasons(t: dict | None) -> list[str]:
    # Plain-English read of the indicators, no LLM needed.
    if not t:
        return []
    reasons: list[str] = []

    rsi = t.get("rsi")
    if rsi is not None:
        if rsi >= 70:
            reasons.append(f"RSI {rsi} — overbought, pullback risk.")
        elif rsi <= 30:
            reasons.append(f"RSI {rsi} — oversold, potential bounce.")
        else:
            reasons.append(f"RSI {rsi} — neutral momentum.")

    price, e20, e50 = t.get("price"), t.get("ema_20"), t.get("ema_50")
    if price and e20 and e50:
        if price > e20 > e50:
            reasons.append("Price above EMA20 and EMA50 — bullish trend alignment.")
        elif price < e20 < e50:
            reasons.append("Price below EMA20 and EMA50 — bearish trend alignment.")
        else:
            reasons.append("Mixed EMA alignment — no clear trend.")

    macd = t.get("macd")
    if macd is not None:
        reasons.append(f"MACD {'positive' if macd >= 0 else 'negative'} ({macd}).")

    adx = t.get("adx")
    if adx is not None:
        reasons.append(f"ADX {adx} — {'strong trend' if adx >= 25 else 'weak/ranging trend'}.")

    return reasons


async def recommendation_node(state: AnalysisState) -> dict:
    decision = (state.get("debate") or {}).get("decision") or {}
    research = (state.get("research") or {}).get("report") or {}
    fundamental = state.get("fundamental") or {}
    narrative = state.get("fundamental_narrative") or {}
    health = fundamental.get("health") or {}
    news = (state.get("news") or {}).get("analysis") or {}
    debate = state.get("debate") or {}
    technical = state.get("technical") or {}

    checks = health.get("checks", [])
    memory = state.get("memory") or {}
    consensus = state.get("consensus") or {}
    risk = state.get("risk") or {}

    # A high-risk name can only make us less sure, never flip the call: cap HIGH -> MEDIUM.
    confidence = decision.get("confidence", "LOW")
    risk_capped = confidence == "HIGH" and _risk_caps_confidence(risk)
    if risk_capped:
        confidence = "MEDIUM"

    # The explainability block behind every recommendation.
    explanation = {
        "confidence": confidence,
        "technical_reasons": _technical_reasons(technical),
        "news_summary": news.get("summary") or "No news analysed.",
        "news_sentiment": news.get("overall_sentiment", "NEUTRAL"),
        "fundamental_analysis": {
            "health_score": health.get("score"),
            "health_label": health.get("label"),
            "passed_checks": [c["name"] for c in checks if c.get("passed")],
            "failed_checks": [c["name"] for c in checks if not c.get("passed")],
            "narrative": narrative or None,
        },
        "debate_outcome": {
            "decision": decision.get("decision", "HOLD"),
            "rationale": decision.get("rationale"),
            "bull_case": (debate.get("bull") or {}).get("key_point"),
            "bear_case": (debate.get("bear") or {}).get("key_point"),
            "rounds": debate.get("rounds"),
            "converged": debate.get("converged"),
            # False means this HOLD is a fallback, not a real verdict.
            "decision_valid": debate.get("decision_valid", True),
        },
        "evidence": {
            "technical": technical,
            "fundamental_health": health,
            "news_sentiment": news.get("overall_sentiment"),
            "research_view": research.get("recommendation"),
        },
        "risk": {
            "volatility": risk.get("volatility"),
            "beta": risk.get("beta"),
            "risk_level": risk.get("risk_level"),
            "benchmark": risk.get("benchmark"),
            # True when high vol/beta pulled confidence down from HIGH to MEDIUM.
            "confidence_capped": risk_capped,
        },
        "learned_context": {
            "prior_lessons": memory.get("prior_lessons", []),
            # From other tickers in a similar setup — kept separate from this stock's own.
            "cross_ticker_lessons": memory.get("cross_ticker_lessons", []),
            "past_recommendations": memory.get("past_recommendations", []),
            # Tells "nothing learned yet" apart from "learning loop broken".
            "status": memory.get("status", "unknown"),
        },
        "routing": {
            "path": "quick_decision" if debate.get("skipped") else "debate",
            "signal_votes": consensus.get("votes", {}),
            "independent_votes": consensus.get("independent_votes", {}),
            "unanimous": consensus.get("unanimous", False),
            "research_dissent": consensus.get("research_dissent", False),
            # Why a unanimous read still went to committee.
            "risk_veto": consensus.get("risk_veto", False),
            "incomplete": consensus.get("incomplete", []),
        },
    }

    rationale = decision.get("rationale", "Insufficient data for a confident call.")
    if risk_capped:
        rationale += (
            f" Confidence was capped to MEDIUM because {state['ticker']} is high-risk "
            f"(volatility {risk.get('volatility')}%, beta {risk.get('beta')})."
        )

    recommendation = {
        "symbol": state["ticker"],
        "action": decision.get("decision", "HOLD"),
        "confidence": confidence,
        "rationale": rationale,
        "explanation": explanation,
        "catalysts": decision.get("key_catalysts", []),
        "risks": decision.get("key_risks", []),
    }
    return {"recommendation": recommendation}


async def persist_node(state: AnalysisState) -> dict:
    """Save the call and file it into long-term memory. Both entrypoints share this."""
    rec = state.get("recommendation") or {}
    if not rec:
        return {}

    ticker, user_id = state["ticker"], state["user_id"]
    consensus = state.get("consensus") or {}
    errors: list[str] = []

    try:
        await Recommendation(
            user_id=user_id,
            symbol=ticker,
            action=rec.get("action", "HOLD"),
            confidence=rec.get("confidence", "LOW"),
            rationale=rec.get("rationale"),
            explanation=rec.get("explanation", {}),
        ).insert()
    except Exception as e:
        errors.append(f"persist: {e}")

    try:
        await MemoryService.save(
            "agent_output",
            f"{ticker} recommendation: {rec.get('action')} "
            f"({rec.get('confidence')}) — {rec.get('rationale')}",
            ticker=ticker,
            metadata={
                "action": rec.get("action"),
                "confidence": rec.get("confidence"),
                # Lets a later trade-close reflection cite which path produced the call.
                "route": consensus.get("route"),
                "unanimous": consensus.get("unanimous"),
            },
            user_id=user_id,
        )
    except Exception as e:
        errors.append(f"memory: {e}")

    report = (state.get("research") or {}).get("report") or {}
    if report.get("summary"):
        try:
            await MemoryService.save(
                "research_report",
                f"{ticker} research: {report['summary']} "
                f"View: {report.get('recommendation')} ({report.get('confidence')}).",
                ticker=ticker,
                metadata={"recommendation": report.get("recommendation")},
                user_id=user_id,
            )
        except Exception as e:
            errors.append(f"memory_research: {e}")

    return {"errors": errors} if errors else {}


def build_workflow(checkpointer=None):
    g = StateGraph(AnalysisState)
    g.add_node("profile", profile_node)
    g.add_node("technical", technical_node)
    g.add_node("fundamental", fundamental_node)
    g.add_node("news", news_node)
    g.add_node("risk", risk_node)
    g.add_node("recall", recall_node)
    g.add_node("research", research_node)
    g.add_node("gate", gate_node)
    g.add_node("debate", debate_node)
    g.add_node("quick_decision", quick_decision_node)
    g.add_node("recommendation", recommendation_node)
    g.add_node("persist", persist_node)

    #        ┌─ profile ─────┐
    #        ├─ technical ───┤                                  ┌─(contested)→ debate ─────┐
    # START ─┼─ fundamental ─┼→ recall → research → gate ──────┤                           ├→ recommendation → persist → END
    #        ├─ news ────────┤                                  └─(unanimous)→ quick_decision ┘
    #        └─ risk ────────┘
    # recall follows the fan-out because its cross-ticker query needs the gathered numbers;
    # research follows recall so it argues from the same evidence everyone else sees.
    for node in GATHER_NODES:
        g.add_edge(START, node)
        g.add_edge(node, "recall")

    g.add_edge("recall", "research")
    g.add_edge("research", "gate")

    # Route to the committee only when signals conflict.
    g.add_conditional_edges(
        "gate",
        route_after_gate,
        {"debate": "debate", "quick_decision": "quick_decision"},
    )
    g.add_edge("debate", "recommendation")
    g.add_edge("quick_decision", "recommendation")
    g.add_edge("recommendation", "persist")
    g.add_edge("persist", END)

    return g.compile(checkpointer=checkpointer)


_workflow = None
_checkpointer: MongoCheckpointer | None = None


async def init_workflow() -> None:
    """Compile the graph against a live checkpointer. Called once from the app lifespan."""
    global _workflow, _checkpointer
    _checkpointer = MongoCheckpointer(
        mongo_client,
        settings.mongodb_db,
        checkpoint_collection=settings.checkpoint_collection,
        writes_collection=settings.checkpoint_writes_collection,
        ttl=settings.checkpoint_ttl_seconds,
    )
    await _checkpointer.setup()
    _workflow = build_workflow(_checkpointer)


def get_workflow():
    if _workflow is None:
        raise RuntimeError("Workflow not initialised — init_workflow() runs at startup.")
    return _workflow


def _thread_id(user_id: str, ticker: str, fresh: bool) -> str:
    # user_id leads so no account can resume another's thread; the date scopes a run to
    # one trading day, and `fresh` opts out of resuming altogether.
    if fresh:
        return f"{user_id}:{ticker}:{uuid4().hex}"
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"{user_id}:{ticker}:{day}"


def _initial_state(ticker: str, user_id: str, include_news: bool, rounds: int) -> AnalysisState:
    return {
        "ticker": ticker.upper(),
        "user_id": user_id,
        "include_news": include_news,
        "max_rounds": max(1, rounds),
    }


# The state key each pipeline node fills, so a resumed run can tell the UI what is
# already done rather than showing finished stages as still running.
_NODE_STATE_KEY = {
    "profile": "profile", "technical": "technical", "fundamental": "fundamental",
    "news": "news", "risk": "risk", "recall": "memory", "research": "research",
}


async def _pending_snapshot(graph, config):
    """The thread's state if it has unfinished work, else None. Only `None` as input
    resumes: pass the input again and LangGraph restarts from START, re-paying for everything."""
    try:
        snap = await graph.aget_state(config)
    except Exception:
        return None
    return snap if snap and snap.next else None


class WorkflowService:
    # Runs every agent through LangGraph to produce one recommendation.
    @staticmethod
    async def run(
        ticker: str, user_id: str, include_news: bool = True, rounds: int = 2,
        fresh: bool = False,
    ) -> dict:
        ticker = ticker.upper()
        try:
            graph = get_workflow()
            config = {"configurable": {"thread_id": _thread_id(user_id, ticker, fresh)}}
            state = _initial_state(ticker, user_id, include_news, rounds)
            resuming = await _pending_snapshot(graph, config)

            final = await graph.ainvoke(None if resuming else state, config)
            return {
                "symbol": ticker,
                "recommendation": final.get("recommendation"),
                "research": final.get("research"),
                "technical": final.get("technical"),
                "fundamental": final.get("fundamental"),
                "news": final.get("news"),
                "risk": final.get("risk"),
                "debate": final.get("debate"),
                "errors": final.get("errors", []),
            }
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Workflow failed: {e}")

    @staticmethod
    async def run_stream(
        ticker: str, user_id: str, include_news: bool = True, rounds: int = 2,
        fresh: bool = False,
    ):
        """Stream the same graph run() executes, translating node updates into UI events."""
        ticker = ticker.upper()
        try:
            graph = get_workflow()
            config = {"configurable": {"thread_id": _thread_id(user_id, ticker, fresh)}}
            state = _initial_state(ticker, user_id, include_news, rounds)
            resuming = await _pending_snapshot(graph, config)
            done = resuming.values if resuming else {}

            yield {"type": "status",
                   "message": f"Resuming {ticker}…" if resuming else f"Analysing {ticker}…"}

            # Replay what a previous attempt already finished, so the UI does not show
            # completed stages as still running.
            for name, key in _NODE_STATE_KEY.items():
                if name == "news" and not include_news:
                    continue
                if key in done:
                    yield {"type": "node", "node": name, "status": "done",
                           "data": {key: done[key]}, "warnings": []}
                elif name in GATHER_NODES:
                    yield {"type": "node", "node": name, "status": "running"}
            if done.get("consensus"):
                yield {"type": "routing", "consensus": done["consensus"]}

            debate_started = False
            errors: list[str] = list(done.get("errors", []))
            # Seeded with what is already settled: replayed nodes, and news when skipped.
            finished = {n for n, k in _NODE_STATE_KEY.items() if k in done}
            if not include_news:
                finished.add("news")

            async for mode, chunk in graph.astream(
                None if resuming else state, config, stream_mode=["updates", "custom"],
            ):
                # Debate rounds arrive from inside the node via get_stream_writer().
                if mode == "custom":
                    if not debate_started:
                        debate_started = True
                        yield {"type": "debate_start"}
                    yield {"type": "debate", "event": chunk}
                    continue

                for node, data in chunk.items():
                    data = dict(data or {})
                    errs = data.pop("errors", None)
                    if errs:
                        errors.extend(errs)

                    if node in _NODE_STATE_KEY:
                        # A skipped news node returns nothing and is not a failure.
                        if node == "news" and not include_news:
                            continue
                        yield {
                            "type": "node", "node": node,
                            "status": "done" if data else "error",
                            "data": data, "warnings": errs or [],
                        }
                        finished.add(node)
                        # updates only fire on completion, so infer the next stage's start.
                        if node in GATHER_NODES and GATHER_NODES <= finished:
                            yield {"type": "node", "node": "recall", "status": "running"}
                        elif node == "recall":
                            yield {"type": "node", "node": "research", "status": "running"}
                    elif node == "gate":
                        yield {"type": "routing", "consensus": data.get("consensus", {})}
                    elif node == "quick_decision":
                        d = data.get("debate") or {}
                        yield {"type": "quick_decision",
                               "decision": d.get("decision"), "memory": d.get("memory")}
                    elif node == "recommendation":
                        yield {"type": "recommendation",
                               "recommendation": data.get("recommendation")}
                    elif node == "persist" and errs:
                        yield {"type": "warn", "message": "; ".join(errs)}

            yield {"type": "done", "symbol": ticker, "errors": errors}
        except Exception as e:
            yield {"type": "error", "message": str(e)}

    @staticmethod
    async def history(user_id: str, ticker: str | None = None, limit: int = 20) -> list[Recommendation]:
        # Scoped to the caller: past calls feed the UI's history panel and, via
        # recall_memory, future debates — another user's calls belong in neither.
        q = Recommendation.find(Recommendation.user_id == user_id)
        if ticker:
            q = q.find(Recommendation.symbol == ticker.upper())
        return await q.sort("-created_at").limit(limit).to_list()
