import json
import logging

from app.services.llm_service import LLMService
from app.services.memory import MemoryService

logger = logging.getLogger(__name__)

_OUTCOMES = ("WIN", "LOSS", "BREAKEVEN")

SYSTEM_PROMPT = (
    "You are AlphaForge Reflection Agent. A paper trade has just been closed. "
    "Given the trade result (and any prior lessons for this stock), explain why "
    "it succeeded or failed and distill ONE concrete, reusable lesson. Respond "
    "ONLY with a valid JSON object — no markdown:\n"
    "{\n"
    '  "outcome": "WIN | LOSS | BREAKEVEN",\n'
    '  "summary": "2-3 sentence review of how the trade played out",\n'
    '  "what_went_right": ["short bullet"],\n'
    '  "what_went_wrong": ["short bullet"],\n'
    '  "lesson": "one concrete, reusable takeaway for future trades"\n'
    "}\n"
    "This is educational analysis, not financial advice."
)


def _validate_reflection(obj: dict) -> str | None:
    # A lesson is stored permanently, so make sure it's well-formed before saving.
    if obj.get("outcome") not in _OUTCOMES:
        return f"'outcome' must be exactly one of {', '.join(_OUTCOMES)}."
    lesson = obj.get("lesson")
    if not isinstance(lesson, str) or not lesson.strip():
        return "The JSON is missing a non-empty 'lesson' string."
    if not isinstance(obj.get("summary"), str) or not obj["summary"].strip():
        return "The JSON is missing a non-empty 'summary' string."
    return None


class ReflectionAgentService:
    @classmethod
    async def reflect(
        cls,
        ticker: str,
        quantity: int,
        buy_price: float,
        sell_price: float,
        user_id: str,
    ) -> dict:
        ticker = ticker.upper()
        pnl = round((sell_price - buy_price) * quantity, 2)
        pnl_pct = round((sell_price - buy_price) / buy_price * 100, 2) if buy_price else 0.0

        try:
            prior = await MemoryService.search(
                f"trading lessons for {ticker}", k=3, type="lesson", user_id=user_id
            )
        except Exception:
            prior = []

        trade = {
            "ticker": ticker,
            "quantity": quantity,
            "avg_buy_price": round(buy_price, 2),
            "sell_price": round(sell_price, 2),
            "realized_pnl": pnl,
            "realized_pnl_pct": pnl_pct,
        }
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": (
                    f"Closed trade:\n{json.dumps(trade, indent=2)}\n\n"
                    f"Prior lessons for this stock:\n"
                    f"{json.dumps([p['content'] for p in prior], indent=2)}\n\n"
                    "Return the JSON reflection now."
                ),
            },
        ]
        result = await LLMService.chat_json(
            messages,
            fallback={
                # Outcome comes from the P&L, so it's correct even if the model fails.
                "outcome": "WIN" if pnl > 0 else "LOSS" if pnl < 0 else "BREAKEVEN",
                "summary": "The reflection agent did not return a usable review of this trade.",
                "what_went_right": [],
                "what_went_wrong": [],
                "lesson": "",
            },
            temperature=0.1,
            validate=_validate_reflection,
        )
        reflection = result["data"]
        valid = result["valid"]
        stored = False

        if not valid:
            # Store nothing rather than saving a bad lesson as a permanent prior.
            logger.warning(
                "Reflection for %s produced no usable lesson after %d attempt(s)",
                ticker, result["attempts"],
            )
        else:
            try:
                await MemoryService.save(
                    "lesson",
                    f"[{reflection['outcome']}] {ticker} realized {pnl_pct}% "
                    f"(buy {trade['avg_buy_price']} -> sell {trade['sell_price']}): "
                    f"{reflection['lesson']}",
                    ticker=ticker,
                    metadata={
                        "outcome": reflection["outcome"],
                        "realized_pnl": pnl,
                        "realized_pnl_pct": pnl_pct,
                    },
                    user_id=user_id,
                )
                stored = True
            except Exception as e:
                reflection["_memory_error"] = str(e)
                logger.exception("Could not store the lesson for %s", ticker)

        return {
            "symbol": ticker,
            "model": result["model"],
            "trade": trade,
            "reflection": reflection,
            # valid = model gave a good review; stored = a lesson actually got saved.
            "valid": valid,
            "stored": stored,
            "attempts": result["attempts"],
        }