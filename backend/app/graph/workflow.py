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
from app.services.memory import MemoryService
from app.models.recommendation import Recommendation

class AnalysisState(TypedDict, total=False):
    ticker: str
    include_news: bool
    research: dict
    technical: dict
    fundamental: dict
    fundamental_narrative: dict
    news: dict
    consensus: dict
    debate: dict
    recommendation: dict
    errors: Annotated[list[str], add]


async def research_node(state: AnalysisState) -> dict:
    try:
        return {"research": await ResearchAgentService.research(state["ticker"])}
    except Exception as e:
        return {"errors": [f"research: {e}"]}

async def technical_node(state: AnalysisState) -> dict:
    try:
        # Sync yfinance/pandas_ta call -> keep it off the event loop.
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

    # The plain-language read is folded in here rather than sitting behind its
    # own endpoint. It runs in the parallel fan-out alongside the research and
    # news nodes, which are already LLM-bound, so it costs no extra wall-clock
    # on the critical path — and a narration failure must never lose us the
    # numbers, so it degrades to metrics-only instead of failing the node.
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

async def debate_node(state: AnalysisState) -> dict:
    try:
        # News has its own node above; run the debate with include_news=False so
        # the local model isn't asked to summarise the same headlines twice.
        return {"debate": await DebateAgentService.debate(state["ticker"], include_news=False)}
    except Exception as e:
        return {"errors": [f"debate: {e}"]}

# --- Conditional routing --------------------------------------------------
# After the data-gathering nodes, a deterministic gate reads how strongly the
# signals agree. If every available signal points the same way, we skip the
# (expensive, multi-LLM-call) debate and issue the decision directly; only genuinely
# contested cases pay for the Bull/Bear/Moderator committee.

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


# The research agent reaches its recommendation by calling the SAME technical,
# fundamental and news tools the other three nodes read. Counting its vote as a
# peer of those three double-counts the identical evidence and manufactures
# unanimity — which then skips the committee precisely on the high-conviction
# calls that most deserve scrutiny. We keep the vote visible for transparency but
# exclude it from the unanimity test, using it only as corroboration: an
# explicitly dissenting research agent forces the debate.
_DERIVED_SIGNALS = {"research"}


def _consensus(votes: dict) -> dict:
    independent = {
        k: v for k, v in votes.items() if k not in _DERIVED_SIGNALS and v != 0
    }
    total = sum(independent.values())
    n = len(independent)
    # Unanimous = at least two INDEPENDENT signals, all pointing the same way.
    unanimous = n >= 2 and abs(total) == n

    # Corroboration check: the derived research view must not contradict them.
    research = votes.get("research", 0)
    dissent = bool(unanimous and research and (research > 0) != (total > 0))

    skip_debate = unanimous and not dissent
    action = confidence = None
    if skip_debate:
        action = "BUY" if total > 0 else "SELL"
        # HIGH only when all three independent signals line up.
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
    # The conditional edge: unanimous signals bypass the committee.
    return "quick_decision" if (state.get("consensus") or {}).get("route") == "quick" else "debate"


async def quick_decision_node(state: AnalysisState) -> dict:
    # Fast path: signals already agree, so synthesise the decision deterministically
    # and skip the debate — but still recall memory so the recommendation keeps its
    # learned_context, exactly as the debate path would.
    c = state.get("consensus") or {}
    ticker = state["ticker"]
    try:
        memory = await DebateAgentService._recall_memory(ticker)
    except Exception:
        memory = {"prior_lessons": [], "past_recommendations": []}

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
    # Deterministic, Python-generated read of the latest indicators -> the
    # "technical reasons" component. No LLM: the numbers speak for themselves.
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
    explanation = {
        # 1. Confidence
        "confidence": decision.get("confidence", "LOW"),
        # 2. Technical reasons
        "technical_reasons": _technical_reasons(technical),
        # 3. News summary
        "news_summary": news.get("summary") or "No news analysed.",
        "news_sentiment": news.get("overall_sentiment", "NEUTRAL"),
        # 4. Fundamental analysis — deterministic checks plus the agent's read.
        "fundamental_analysis": {
            "health_score": health.get("score"),
            "health_label": health.get("label"),
            "passed_checks": [c["name"] for c in checks if c.get("passed")],
            "failed_checks": [c["name"] for c in checks if not c.get("passed")],
            "narrative": narrative or None,
        },
        # 5. Debate outcome
        "debate_outcome": {
            "decision": decision.get("decision", "HOLD"),
            "rationale": decision.get("rationale"),
            "bull_case": (debate.get("bull") or {}).get("key_point"),
            "bear_case": (debate.get("bear") or {}).get("key_point"),
            "rounds": debate.get("rounds"),
            "converged": debate.get("converged"),
            # False means the moderator never produced a well-formed verdict and
            # this HOLD is a fallback, not a judgement. Surfaced so the UI can
            # distinguish the two instead of presenting a failure as a call.
            "decision_valid": debate.get("decision_valid", True),
        },
        # 6. Evidence (consolidated raw signals)
        "evidence": {
            "technical": technical,
            "fundamental_health": health,
            "news_sentiment": news.get("overall_sentiment"),
            "research_view": research.get("recommendation"),
        },
        # 7. Learned context — what past trades/recommendations informed this call
        "learned_context": {
            "prior_lessons": memory.get("prior_lessons", []),
            "past_recommendations": memory.get("past_recommendations", []),
        },
        # 8. Routing — which path the graph took and why
        "routing": {
            "path": "quick_decision" if debate.get("skipped") else "debate",
            "signal_votes": consensus.get("votes", {}),
            "independent_votes": consensus.get("independent_votes", {}),
            "unanimous": consensus.get("unanimous", False),
            "research_dissent": consensus.get("research_dissent", False),
        },
    }

    recommendation = {
        "symbol": state["ticker"],
        "action": decision.get("decision", "HOLD"),
        "confidence": decision.get("confidence", "LOW"),
        "rationale": decision.get("rationale", "Insufficient data for a confident call."),
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
    g.add_node("gate", gate_node)
    g.add_node("debate", debate_node)
    g.add_node("quick_decision", quick_decision_node)
    g.add_node("recommendation", recommendation_node)

    #                      ┌─ research ─┐
    #                      ├─ technical ┤          ┌─(contested)→ debate ─┐
    #  START ─(fan-out)────┼─ fundamental┼─→ gate ─┤                      ├─→ recommendation → END
    #                      └─ news ──────┘          └─(unanimous)→ quick_decision ┘

    # The four data-gathering nodes are independent — run them concurrently.
    for node in ("research", "technical", "fundamental", "news"):
        g.add_edge(START, node)
        g.add_edge(node, "gate")  # gate waits for all four (fan-in barrier)

    # Conditional edge: the gate routes to the committee only when signals conflict.
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
    # Phase 12: orchestrate every agent through LangGraph into one recommendation.
    @staticmethod
    async def run(ticker: str, include_news: bool = True) -> dict:
        try:
            final = await workflow.ainvoke(
                {"ticker": ticker.upper(), "include_news": include_news}
            )
            rec = final.get("recommendation") or {}
            if rec:
                await Recommendation(
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
                )
            return {
                "symbol": ticker.upper(),
                "recommendation": final.get("recommendation"),
                "research": final.get("research"),
                "technical": final.get("technical"),
                "fundamental": final.get("fundamental"),
                "news": final.get("news"),
                "debate": final.get("debate"),
                "errors": final.get("errors", []),
            }
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Workflow failed: {e}")
    
    @staticmethod
    async def run_stream(ticker: str, include_news: bool = True, rounds: int = 2):
        """Async generator: run the full pipeline while streaming progress events.

        Mirrors the compiled graph's order (parallel data-gathering → routing gate →
        debate or fast-path → recommendation) but emits a Server-Sent event as each
        stage happens, and forwards the committee debate round-by-round — so the UI
        can show exactly what is being analysed in real time. Reuses the same node
        functions and routing helpers as `run()`, so there is no logic divergence.
        """
        ticker = ticker.upper()
        state: AnalysisState = {"ticker": ticker, "include_news": include_news}
        try:
            yield {"type": "status", "message": f"Analysing {ticker}…"}

            gather = {
                "research": research_node,
                "technical": technical_node,
                "fundamental": fundamental_node,
                "news": news_node,
            }
            active = {
                name: fn for name, fn in gather.items()
                if not (name == "news" and not include_news)
            }
            for name in active:
                yield {"type": "node", "node": name, "status": "running"}

            async def _run(name, fn):
                return name, await fn(state)

            # Fan-out the independent gathering nodes; emit as each completes.
            pending = [asyncio.create_task(_run(n, f)) for n, f in active.items()]
            for fut in asyncio.as_completed(pending):
                name, res = await fut
                # A node may return data AND a non-fatal error — the fundamental
                # node yields its metrics even when the narration call fails. Keep
                # whatever data came back instead of discarding the whole result,
                # and only report `error` status when nothing usable arrived.
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

            # Routing gate — the conditional branch.
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
                # Stream the committee live, forwarding each event, while
                # reassembling the debate dict the recommendation node needs.
                yield {"type": "debate_start"}
                bull = bear = None
                decision: dict = {}
                model = memory = None
                rounds_done = 0
                converged = False
                decision_valid = True
                async for ev in DebateAgentService.debate_stream(
                    ticker, include_news=False, max_rounds=rounds
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

            # Persist, exactly as run() does.
            try:
                await Recommendation(
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
                )
            except Exception as e:
                yield {"type": "warn", "message": f"persist failed: {e}"}

            yield {"type": "done", "symbol": ticker, "errors": state.get("errors", [])}
        except Exception as e:
            yield {"type": "error", "message": str(e)}

    @staticmethod
    async def history(ticker: str | None = None, limit: int = 20) -> list[Recommendation]:
        q = Recommendation.find()
        if ticker:
            q = q.find(Recommendation.symbol == ticker.upper())
        return await q.sort("-created_at").limit(limit).to_list()