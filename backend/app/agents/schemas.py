"""Output contracts for every LLM-backed agent, bound as Gemini `response_json_schema`
so the shape is constrained at decode time. Field descriptions reach the model.
"""

from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field

Action = Literal["BUY", "HOLD", "SELL"]
Confidence = Literal["LOW", "MEDIUM", "HIGH"]
Sentiment = Literal["BULLISH", "BEARISH", "NEUTRAL"]
Verdict = Literal["STRONG", "MODERATE", "WEAK", "POOR"]
Outcome = Literal["WIN", "LOSS", "BREAKEVEN"]
Stance = Literal["BULL", "BEAR"]


def _non_empty(v: str) -> str:
    if not v.strip():
        raise ValueError("must not be blank")
    return v


# Enforced after parsing rather than as a schema minLength, which Gemini may ignore.
Text = Annotated[str, AfterValidator(_non_empty)]


class AgentOutput(BaseModel):
    """Reject unknown keys so a drifting prompt surfaces instead of being silently dropped."""

    model_config = {"extra": "forbid"}


# --- debate ---------------------------------------------------------------

class DebateArgument(AgentOutput):
    stance: Stance
    arguments: list[str] = Field(description="Specific points, each citing the numbers")
    key_point: str = Field(description="Your single strongest argument")


class DebateRebuttal(AgentOutput):
    stance: Stance
    rebuttals: list[str] = Field(
        description="Direct counters to specific opposing points, citing data"
    )
    arguments: list[str] = Field(description="Your sharpened key points")
    key_point: str = Field(description="Your strongest argument after this exchange")
    has_new_points: bool = Field(
        description="False if you have nothing material left to add"
    )
    concede: bool = Field(
        description="True only if the opposing case is decisively stronger"
    )


class DebateDecision(AgentOutput):
    decision: Action
    confidence: Confidence
    rationale: Text = Field(description="2-3 sentences explaining the verdict")
    bull_summary: str = Field(description="1 sentence steelman of the bull case")
    bear_summary: str = Field(description="1 sentence steelman of the bear case")
    key_catalysts: list[str] = Field(description="What could prove the bull right")
    key_risks: list[str] = Field(description="What could prove the bear right")


# --- research -------------------------------------------------------------

class ResearchReport(AgentOutput):
    summary: Text = Field(description="2-3 sentence overview of the stock's current state")
    strengths: list[str]
    weaknesses: list[str]
    recommendation: Action
    confidence: Confidence
    rationale: str = Field(description="1-2 sentence justification")


# --- fundamentals ---------------------------------------------------------

class FundamentalRead(AgentOutput):
    summary: Text = Field(description="3-4 sentence read on the company's financial health")
    revenue_analysis: str = Field(description="1-2 sentences on growth and margins")
    debt_analysis: str = Field(description="1-2 sentences on leverage and liquidity")
    cash_flow_analysis: str = Field(description="1-2 sentences on cash generation")
    strengths: list[str]
    weaknesses: list[str]
    verdict: Verdict


# --- news -----------------------------------------------------------------

class NewsAnalysis(AgentOutput):
    summary: Text = Field(description="3-4 sentence digest of the key themes")
    overall_sentiment: Sentiment
    sentiment_score: float = Field(
        ge=-1.0, le=1.0, description="-1.0 very bearish to 1.0 very bullish"
    )
    highlights: list[str] = Field(description="Short bullets of notable items")


# --- portfolio-level narration -------------------------------------------

class RiskRead(AgentOutput):
    summary: Text = Field(description="2-3 sentences on the portfolio's overall risk profile")
    volatility_comment: str = Field(
        description="1 sentence on how volatile or market-sensitive it is"
    )
    concentration_risks: list[str] = Field(
        description="Short bullets on any name or sector overweight"
    )
    suggestions: list[str] = Field(description="Short, practical risk-reduction ideas")


class PortfolioRead(AgentOutput):
    summary: Text = Field(
        description="2-3 sentences on how capital is deployed and why it is balanced"
    )
    diversification: str = Field(description="1-2 sentences on sector and position spread")
    concentration_risks: list[str] = Field(
        description="Short bullets on any name or sector to watch"
    )
    notes: list[str] = Field(description="Short practical notes, e.g. uninvested capital")


# --- reflection -----------------------------------------------------------

class Reflection(AgentOutput):
    outcome: Outcome
    summary: Text = Field(description="2-3 sentence review of how the trade played out")
    what_went_right: list[str]
    what_went_wrong: list[str]
    lesson: Text = Field(description="One concrete, reusable takeaway for future trades")


# --- advisor --------------------------------------------------------------

class AdvisorSuggestion(AgentOutput):
    ticker: str
    action: Literal["HOLD", "SELL", "TRIM", "ADD"]
    urgency: Confidence
    rationale: str = Field(description="1-2 sentences citing the specific signals or numbers")
    suggested_quantity: int = Field(
        ge=0, description="Shares to act on, 0 for HOLD; never more than the quantity held"
    )


class AdvisorSuggestions(AgentOutput):
    suggestions: list[AdvisorSuggestion] = Field(
        description="Cover every ticker you are given, exactly once"
    )
    portfolio_summary: Text = Field(description="2-3 sentences on the book's overall posture")


# --- scanner --------------------------------------------------------------

class ScannerRanking(AgentOutput):
    symbol: str
    rank: int = Field(ge=1)
    conviction: Confidence
    thesis: str = Field(description="1-2 sentences on what the setup implies, citing numbers")
    invalidation: str = Field(description="What would prove this setup wrong")
    worth_deep_analysis: bool


class ScannerTriage(AgentOutput):
    ranked: list[ScannerRanking] = Field(
        description="Rank every symbol you are given, exactly once"
    )
    summary: Text = Field(description="1-2 sentences on the overall tone of this scan")
