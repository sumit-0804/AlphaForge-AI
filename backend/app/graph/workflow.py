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

async def recommendation_node(state: AnalysisState) -> dict:
    decision = (state.get("debate") or {}).get("decision") or {}
    research = (state.get("research") or {}).get("report") or {}
    fundamental = state.get("fundamental") or {}
    news = (state.get("news") or {}).get("analysis") or {}
    debate = state.get("debate") or {}

    recommendation = {
        "symbol": state["ticker"],
        "action": decision.get("decision", "HOLD"),
        "confidence": decision.get("confidence", "LOW"),
        "rationale": decision.get("rationale", "Insufficient data for a confident call."),
        "evidence": {
            "technical": state.get("technical"),
            "fundamental_health": fundamental.get("health"),
            "news_sentiment": news.get("overall_sentiment"),
            "research_view": research.get("recommendation"),
            "bull_case": (debate.get("bull") or {}).get("key_point"),
            "bear_case": (debate.get("bear") or {}).get("key_point"),
        },
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