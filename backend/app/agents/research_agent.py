import json
from fastapi import HTTPException

from app.services.llm_service import LLMService
from app.agents.tools import RESEARCH_TOOLS
from app.agents.util import _parse

SYSTEM_PROMPT = (
    "You are AlphaForge Research Agent, an autonomous equity research analyst. "
    "You have TOOLS that pull live data: company profile, technical indicators, "
    "fundamentals, recent news, and AlphaForge's memory of lessons from past "
    "trades. Investigate the given stock by calling whatever tools you need — YOU "
    "decide which ones and in what order, and you may skip tools that aren't "
    "relevant. Gather enough evidence to form a defensible view, then STOP calling "
    "tools and respond ONLY with a valid JSON object — no markdown, no text "
    "outside the JSON. Use this exact schema:\n"
    "{\n"
    '  "summary": "2-3 sentence overview of the stock\'s current state",\n'
    '  "strengths": ["short bullet", "short bullet"],\n'
    '  "weaknesses": ["short bullet", "short bullet"],\n'
    '  "recommendation": "BUY | HOLD | SELL",\n'
    '  "confidence": "LOW | MEDIUM | HIGH",\n'
    '  "rationale": "1-2 sentence justification"\n'
    "}\n"
    "This is educational analysis, not financial advice."
)


class ResearchAgentService:
    # Autonomous, tool-using research agent. Instead of pre-fetching a fixed
    # context and stuffing it into one prompt, the agent decides at run time which
    # tools to call (profile / technical / fundamentals / news / memory) and loops
    # until it has enough evidence, then emits a structured research report.

    @classmethod
    async def research(cls, ticker: str, news: list[dict] | None = None) -> dict:
        try:
            ticker = ticker.upper()
            task = f"Research {ticker} and return the JSON research object."
            if news:
                # Caller already has headlines — hand them over so the agent can
                # skip the news tool if it wants.
                task += f"\n\nCaller-provided news:\n{json.dumps(news, indent=2)}"

            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": task},
            ]
            result = await LLMService.chat_with_tools(
                messages, RESEARCH_TOOLS, temperature=0.3
            )
            return {
                "symbol": ticker,
                "model": result["model"],
                # The agent's decision trail — which tools it chose to call.
                "steps": result.get("tool_trace", []),
                "report": _parse(
                    result["content"],
                    {
                        "summary": result["content"].strip(),
                        "strengths": [],
                        "weaknesses": [],
                        "recommendation": "HOLD",
                        "confidence": "LOW",
                        "rationale": "Model returned unstructured output.",
                    },
                ),
            }
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Research agent failed: {e}")
