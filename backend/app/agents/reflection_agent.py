import json

from app.services.llm_service import LLMService
from app.services.memory import MemoryService
from app.agents.util import _parse

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


class ReflectionAgentService:
    @classmethod
    async def reflect(
        cls,
        ticker: str,
        quantity: int,
        buy_price: float,
        sell_price: float,
        user_id: str = "default_user",
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
        result = await LLMService.chat(messages, temperature=0.3)
        reflection = _parse(
            result["content"],
            {
                "outcome": "WIN" if pnl > 0 else "LOSS" if pnl < 0 else "BREAKEVEN",
                "summary": result["content"].strip(),
                "what_went_right": [],
                "what_went_wrong": [],
                "lesson": "",
            },
        )

        lesson_text = reflection.get("lesson") or reflection.get("summary", "")
        try:
            await MemoryService.save(
                "lesson",
                f"[{reflection.get('outcome')}] {ticker} realized {pnl_pct}% "
                f"(buy {trade['avg_buy_price']} -> sell {trade['sell_price']}): {lesson_text}",
                ticker=ticker,
                metadata={
                    "outcome": reflection.get("outcome"),
                    "realized_pnl": pnl,
                    "realized_pnl_pct": pnl_pct,
                },
                user_id=user_id,
            )
        except Exception as e:
            reflection["_memory_error"] = str(e)

        return {"symbol": ticker, "model": result["model"], "trade": trade, "reflection": reflection}