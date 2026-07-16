"""Portfolio advisor — turns held positions into suggested actions.

Answers the question nothing else in the system does: "given what I already own,
what should I do about it?" The entry scanner only ever looks for reasons to buy
and RiskService only reports volatility and beta, so a position quietly breaking
down produced no signal anywhere.

Like the scanner triage this is ONE LLM call for the whole book, not one per
holding — the model needs to see positions relative to each other anyway to
reason about concentration, and per-position calls would not survive the shared
rate limiter.
"""

import json

from fastapi import HTTPException

from app.services.llm_service import LLMService
from app.services.trading import TradingService
from app.services.market_scanner import MarketScannerService

_ACTIONS = ("HOLD", "SELL", "TRIM", "ADD")

SYSTEM_PROMPT = (
    "You are AlphaForge Portfolio Advisor. You are given the user's current "
    "paper-trading positions: cost basis, unrealised P&L, position weight, and "
    "any bearish technical signals now firing on each name. Recommend an action "
    "per position and explain it in plain language.\n"
    "Guidance:\n"
    "- SELL when the technical picture has broken down or the original thesis "
    "looks invalidated. TRIM when the position is simply oversized or extended.\n"
    "- ADD only on genuine strength, never to average down a loser.\n"
    "- HOLD is the correct answer when nothing meaningful has changed — say so "
    "plainly rather than inventing activity.\n"
    "- A large loss is not by itself a reason to sell, and a large gain is not by "
    "itself a reason to hold. Reason from the signals, not the P&L alone.\n"
    "Respond ONLY with a valid JSON object — no markdown:\n"
    "{\n"
    '  "suggestions": [\n'
    "    {\n"
    '      "ticker": "TICKER",\n'
    '      "action": "HOLD | SELL | TRIM | ADD",\n'
    '      "urgency": "HIGH | MEDIUM | LOW",\n'
    '      "rationale": "1-2 sentences citing the specific signals or numbers",\n'
    '      "suggested_quantity": 0\n'
    "    }\n"
    "  ],\n"
    '  "portfolio_summary": "2-3 sentences on the book\'s overall posture"\n'
    "}\n"
    "`suggested_quantity` is how many shares to act on (0 for HOLD); never exceed "
    "the quantity held. Cover EVERY ticker you are given, exactly once. "
    "This is educational analysis, not financial advice."
)


def _make_validator(holdings: dict[str, int]):
    tickers = set(holdings)

    def _validate(obj: dict) -> str | None:
        s = obj.get("suggestions")
        if not isinstance(s, list) or not s:
            return "The 'suggestions' field must be a non-empty array."
        got = [r.get("ticker") for r in s if isinstance(r, dict)]
        missing, unknown = tickers - set(got), set(got) - tickers
        if missing:
            return f"These positions are missing from 'suggestions': {sorted(missing)}."
        if unknown:
            return f"These tickers are not held: {sorted(unknown)}."
        for r in s:
            if r.get("action") not in _ACTIONS:
                return f"'action' for {r.get('ticker')} must be one of {', '.join(_ACTIONS)}."
            # A suggestion to sell more shares than are held would render as an
            # action button that can only fail at execution.
            q = r.get("suggested_quantity", 0)
            if not isinstance(q, int) or q < 0:
                return f"'suggested_quantity' for {r.get('ticker')} must be a non-negative integer."
            if q > holdings.get(r["ticker"], 0):
                return (
                    f"'suggested_quantity' for {r['ticker']} is {q} but only "
                    f"{holdings.get(r['ticker'], 0)} shares are held."
                )
        return None

    return _validate


class AdvisorAgentService:
    @classmethod
    async def advise(cls, user_id: str = "default_user") -> dict:
        try:
            summary = await TradingService.get_portfolio_summary(user_id)
            positions = summary.get("positions") or []
            if not positions:
                return {
                    "positions": [],
                    "suggestions": [],
                    "portfolio_summary": "No open positions to advise on.",
                    "valid": True,
                }

            # Deterministic exit signals first — the LLM reasons over these
            # rather than being asked to eyeball price action itself.
            exits = await MarketScannerService.scan_positions(
                [p["ticker"] for p in positions]
            )

            total = summary.get("total_portfolio_value") or 0
            enriched = [
                {
                    "ticker": p["ticker"],
                    "quantity": p["quantity"],
                    "avg_buy_price": p["average_buy_price"],
                    "current_price": p["current_price"],
                    "pnl": p["pnl"],
                    "pnl_percent": p["pnl_percent"],
                    "weight_pct": round(p["current_value"] / total * 100, 2) if total else 0.0,
                    "bearish_signals": exits.get(p["ticker"], {}).get("signals", []),
                    "bearish_score": exits.get(p["ticker"], {}).get("score", 0),
                }
                for p in positions
            ]
            holdings = {p["ticker"]: p["quantity"] for p in positions}

            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Cash balance: {summary.get('cash_balance')}\n"
                        f"Total portfolio value: {total}\n\n"
                        f"Positions:\n{json.dumps(enriched, indent=2, default=str)}\n\n"
                        "Return the JSON suggestions now."
                    ),
                },
            ]
            result = await LLMService.chat_json(
                messages,
                fallback={
                    # Degrade to the deterministic read: flag whatever is actually
                    # breaking down, hold everything else. Never fabricate a SELL.
                    "suggestions": [
                        {
                            "ticker": e["ticker"],
                            "action": "SELL" if e["bearish_score"] >= 5 else "HOLD",
                            "urgency": "HIGH" if e["bearish_score"] >= 5 else "LOW",
                            "rationale": (
                                f"Rule-based signals: {', '.join(e['bearish_signals'])}."
                                if e["bearish_signals"]
                                else "No bearish signals firing."
                            ),
                            "suggested_quantity": e["quantity"] if e["bearish_score"] >= 5 else 0,
                        }
                        for e in enriched
                    ],
                    "portfolio_summary": "Rule-based read only; the advisor's narrative was unavailable.",
                },
                temperature=0.3,
                validate=_make_validator(holdings),
            )
            return {
                "positions": enriched,
                **result["data"],
                "valid": result["valid"],
            }
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(502, f"Advisor agent failed: {e}")
