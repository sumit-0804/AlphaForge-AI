import asyncio
from operator import add
from typing import Annotated, TypedDict

from fastapi import HTTPException
from langgraph.graph import StateGraph, START, END

from app.agents.research_agent import ResearchAgentService
from app.agents.news_agent import NewsAgentService
from app.agents.debate_agent import DebateAgentService
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
    news: dict
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
        return {"fundamental": data}
    except Exception as e:
        return {"errors": [f"fundamental: {e}"]}

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
    health = fundamental.get("health") or {}
    news = (state.get("news") or {}).get("analysis") or {}
    debate = state.get("debate") or {}
    technical = state.get("technical") or {}

    checks = health.get("checks", [])
    explanation = {
        # 1. Confidence
        "confidence": decision.get("confidence", "LOW"),
        # 2. Technical reasons
        "technical_reasons": _technical_reasons(technical),
        # 3. News summary
        "news_summary": news.get("summary") or "No news analysed.",
        "news_sentiment": news.get("overall_sentiment", "NEUTRAL"),
        # 4. Fundamental analysis
        "fundamental_analysis": {
            "health_score": health.get("score"),
            "health_label": health.get("label"),
            "passed_checks": [c["name"] for c in checks if c.get("passed")],
            "failed_checks": [c["name"] for c in checks if not c.get("passed")],
        },
        # 5. Debate outcome
        "debate_outcome": {
            "decision": decision.get("decision", "HOLD"),
            "rationale": decision.get("rationale"),
            "bull_case": (debate.get("bull") or {}).get("key_point"),
            "bear_case": (debate.get("bear") or {}).get("key_point"),
        },
        # 6. Evidence (consolidated raw signals)
        "evidence": {
            "technical": technical,
            "fundamental_health": health,
            "news_sentiment": news.get("overall_sentiment"),
            "research_view": research.get("recommendation"),
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
    g.add_node("debate", debate_node)
    g.add_node("recommendation", recommendation_node)

    # User -> Research -> Technical -> Fundamental -> News -> Debate -> Recommendation

    g.add_edge(START, "research")
    g.add_edge("research", "technical")
    g.add_edge("technical", "fundamental")
    g.add_edge("fundamental", "news")
    g.add_edge("news", "debate")
    g.add_edge("debate", "recommendation")
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
    async def history(ticker: str | None = None, limit: int = 20) -> list[Recommendation]:
        q = Recommendation.find()
        if ticker:
            q = q.find(Recommendation.symbol == ticker.upper())
        return await q.sort("-created_at").limit(limit).to_list()