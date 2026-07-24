import asyncio
from operator import add
from typing import Annotated, TypedDict

from fastapi import HTTPException
from langgraph.graph import StateGraph, START, END

from app.agents.research_agent import ResearchAgentService
from app.agents.news_agent import NewsAgentService
from app.agents.debate_agent import DebateAgentService
from app.agents.fundamental_agent import FundamentalAgentService
from app.services.technical_analysis import TechnicalAnalysisService
from app.services.fundamentals import FundamentalService
from app.services.risk import RiskService
from app.services.memory import MemoryService
from app.models.recommendation import Recommendation

class AnalysisState(TypedDict, total=False):
    ticker: str
    # Whose book this run belongs to. Only the memory-reading nodes use it, but it
    # rides in state so every node can be scoped without changing the graph shape.
    user_id: str
    include_news: bool
    research: dict
    technical: dict
    fundamental: dict
    fundamental_narrative: dict
    news: dict
    risk: dict
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


async def research_node(state: AnalysisState) -> dict:
    try:
        return {
            "research": await ResearchAgentService.research(
                state["ticker"], state["user_id"]
            )
        }
    except Exception as e:
        return {"errors": [f"research: {e}"]}

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

async def debate_node(state: AnalysisState) -> dict:
    try:
        # News runs in its own node, so skip it here to avoid summarising it twice.
        # Risk is already computed, so hand it over rather than refetching.
        return {"debate": await DebateAgentService.debate(
            state["ticker"], state["user_id"], include_news=False, risk=state.get("risk")
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


# Research reads the same data as the other nodes, so its vote is shown but not
# counted toward unanimity — only a dissent from it forces the debate.
_DERIVED_SIGNALS = {"research"}


def _consensus(votes: dict) -> dict:
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

    skip_debate = unanimous and not dissent
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
        "route": "quick" if skip_debate else "debate",
        "action": action,
        "confidence": confidence,
    }


async def gate_node(state: AnalysisState) -> dict:
    return {"consensus": _consensus(_signal_votes(state))}


def route_after_gate(state: AnalysisState) -> str:
    # Unanimous signals skip the committee.
    return "quick_decision" if (state.get("consensus") or {}).get("route") == "quick" else "debate"


async def quick_decision_node(state: AnalysisState) -> dict:
    # Signals agree, so decide directly but still recall memory for learned_context.
    c = state.get("consensus") or {}
    ticker = state["ticker"]
    try:
        # State works as the situation key — _recall_memory reads technical/fundamental from it.
        memory = await DebateAgentService._recall_memory(
            ticker, state["user_id"], context=state
        )
    except Exception:
        memory = {
            "prior_lessons": [],
            "cross_ticker_lessons": [],
            "past_recommendations": [],
            "status": "unavailable",
        }

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
            "symbol": ticker,
            "model": None,
            "memory": memory,
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
    memory = debate.get("memory") or {}
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

def build_workflow():
    g = StateGraph(AnalysisState)
    g.add_node("research", research_node)
    g.add_node("technical", technical_node)
    g.add_node("fundamental", fundamental_node)
    g.add_node("news", news_node)
    g.add_node("risk", risk_node)
    g.add_node("gate", gate_node)
    g.add_node("debate", debate_node)
    g.add_node("quick_decision", quick_decision_node)
    g.add_node("recommendation", recommendation_node)

    #                      ┌─ research ───┐
    #                      ├─ technical ──┤          ┌─(contested)→ debate ─┐
    #  START ─(fan-out)────┼─ fundamental ┼─→ gate ─┤                      ├─→ recommendation → END
    #                      ├─ news ───────┤          └─(unanimous)→ quick_decision ┘
    #                      └─ risk ───────┘

    # Run the data-gathering nodes at once; gate waits for all of them.
    for node in ("research", "technical", "fundamental", "news", "risk"):
        g.add_edge(START, node)
        g.add_edge(node, "gate")

    # Route to the committee only when signals conflict.
    g.add_conditional_edges(
        "gate",
        route_after_gate,
        {"debate": "debate", "quick_decision": "quick_decision"},
    )
    g.add_edge("debate", "recommendation")
    g.add_edge("quick_decision", "recommendation")
    g.add_edge("recommendation", END)

    return g.compile()

workflow = build_workflow()

class WorkflowService:
    # Runs every agent through LangGraph to produce one recommendation.
    @staticmethod
    async def run(ticker: str, user_id: str, include_news: bool = True) -> dict:
        try:
            final = await workflow.ainvoke(
                {"ticker": ticker.upper(), "user_id": user_id, "include_news": include_news}
            )
            rec = final.get("recommendation") or {}
            if rec:
                await Recommendation(
                    user_id=user_id,
                    symbol=ticker.upper(),
                    action=rec.get("action", "HOLD"),
                    confidence=rec.get("confidence", "LOW"),
                    rationale=rec.get("rationale"),
                    explanation=rec.get("explanation", {}),
                ).insert()
                await MemoryService.save(
                    "agent_output",
                    f"{ticker.upper()} recommendation: {rec.get('action')} "
                    f"({rec.get('confidence')}) — {rec.get('rationale')}",
                    ticker=ticker,
                    metadata={"action": rec.get("action"), "confidence": rec.get("confidence")},
                    user_id=user_id,
                )
            return {
                "symbol": ticker.upper(),
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
    async def run_stream(ticker: str, user_id: str, include_news: bool = True, rounds: int = 2):
        """Run the same pipeline as run() but stream a progress event at each stage for the UI."""
        ticker = ticker.upper()
        state: AnalysisState = {
            "ticker": ticker, "user_id": user_id, "include_news": include_news
        }
        try:
            yield {"type": "status", "message": f"Analysing {ticker}…"}

            gather = {
                "research": research_node,
                "technical": technical_node,
                "fundamental": fundamental_node,
                "news": news_node,
                "risk": risk_node,
            }
            active = {
                name: fn for name, fn in gather.items()
                if not (name == "news" and not include_news)
            }
            for name in active:
                yield {"type": "node", "node": name, "status": "running"}

            async def _run(name, fn):
                return name, await fn(state)

            # Run the gathering nodes at once and emit each as it finishes.
            pending = [asyncio.create_task(_run(n, f)) for n, f in active.items()]
            for fut in asyncio.as_completed(pending):
                name, res = await fut
                # A node can return data and a warning; keep the data, only flag error if empty.
                res = dict(res)
                errs = res.pop("errors", None)
                if errs:
                    state["errors"] = state.get("errors", []) + errs
                if res:
                    state.update(res)
                    yield {"type": "node", "node": name, "status": "done",
                           "data": res, "warnings": errs or []}
                else:
                    yield {"type": "node", "node": name, "status": "error", "error": errs or []}

            consensus = _consensus(_signal_votes(state))
            state["consensus"] = consensus
            yield {"type": "routing", "consensus": consensus}

            if consensus["route"] == "quick":
                qd = await quick_decision_node(state)
                state.update(qd)
                yield {"type": "quick_decision",
                       "decision": qd["debate"]["decision"],
                       "memory": qd["debate"]["memory"]}
            else:
                # Stream the committee live while rebuilding the debate dict the rec node needs.
                yield {"type": "debate_start"}
                bull = bear = None
                decision: dict = {}
                model = memory = None
                rounds_done = 0
                converged = False
                decision_valid = True
                async for ev in DebateAgentService.debate_stream(
                    ticker, user_id, include_news=False, max_rounds=rounds,
                    risk=state.get("risk"),
                ):
                    yield {"type": "debate", "event": ev}
                    if ev["type"] == "memory":
                        memory = ev["memory"]
                    elif ev["type"] in ("opening", "rebuttal"):
                        bull, bear = ev["bull"], ev["bear"]
                        rounds_done = ev["round"]
                        converged = ev.get("converged", False)
                    elif ev["type"] == "decision":
                        decision, model = ev["decision"], ev["model"]
                        decision_valid = ev.get("decision_valid", True)
                state["debate"] = {
                    "symbol": ticker, "model": model, "memory": memory,
                    "bull": bull, "bear": bear, "decision": decision,
                    "rounds": rounds_done, "converged": converged,
                    "decision_valid": decision_valid,
                }

            rec_update = await recommendation_node(state)
            state.update(rec_update)
            rec = rec_update["recommendation"]
            yield {"type": "recommendation", "recommendation": rec}

            # Save the recommendation and a memory entry, same as run().
            try:
                await Recommendation(
                    user_id=user_id,
                    symbol=ticker,
                    action=rec.get("action", "HOLD"),
                    confidence=rec.get("confidence", "LOW"),
                    rationale=rec.get("rationale"),
                    explanation=rec.get("explanation", {}),
                ).insert()
                await MemoryService.save(
                    "agent_output",
                    f"{ticker} recommendation: {rec.get('action')} "
                    f"({rec.get('confidence')}) — {rec.get('rationale')}",
                    ticker=ticker,
                    metadata={"action": rec.get("action"), "confidence": rec.get("confidence")},
                    user_id=user_id,
                )
            except Exception as e:
                yield {"type": "warn", "message": f"persist failed: {e}"}

            yield {"type": "done", "symbol": ticker, "errors": state.get("errors", [])}
        except Exception as e:
            yield {"type": "error", "message": str(e)}

    @staticmethod
    async def history(user_id: str, ticker: str | None = None, limit: int = 20) -> list[Recommendation]:
        # Scoped to the caller: past calls feed the UI's history panel and, via
        # _recall_memory, future debates — another user's calls belong in neither.
        q = Recommendation.find(Recommendation.user_id == user_id)
        if ticker:
            q = q.find(Recommendation.symbol == ticker.upper())
        return await q.sort("-created_at").limit(limit).to_list()