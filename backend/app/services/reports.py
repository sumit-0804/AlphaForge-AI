"""On-demand whole-book report: portfolio, risk, a scan, and an allocation plan.

This used to run unattended on a 16:00 IST cron. It is now user-triggered, which
matters for quota: the daily Gemini allowance is small enough that spending it on
reports nobody asked for is how you find the tank empty when you want to analyse
a ticker.
"""

import asyncio
import logging

from fastapi import HTTPException

from app.agents.portfolio_agent import PortfolioAgentService
from app.agents.risk_agent import RiskAgentService
from app.models.report import DailyReport
from app.services.llm_service import LLMService
from app.services.market_scanner import MarketScannerService
from app.services.memory import MemoryService
from app.services.portfolio import PortfolioService
from app.services.risk import RiskService
from app.services.trading import TradingService

logger = logging.getLogger(__name__)

# Risk narration + allocation narration. Checked up front so a report that cannot
# finish never starts and never half-spends the budget.
_CHAT_CALLS_PER_REPORT = 2

# A report is minutes of work dominated by waiting on the rate limiter, so letting
# many run at once just means everyone waits longer for the same throughput.
_MAX_CONCURRENT = 2
_slots = asyncio.Semaphore(_MAX_CONCURRENT)
# Guards the obvious double-click, which would otherwise cost a second full budget.
_in_flight: set[str] = set()


async def _assert_budget() -> None:
    quota = await LLMService.quota_snapshot()
    rpd = quota.get("rpd")
    if rpd is None:
        return
    remaining = rpd - quota.get("requests_today", 0)
    if remaining < _CHAT_CALLS_PER_REPORT:
        raise HTTPException(
            429,
            f"Not enough daily AI quota left for a report "
            f"({remaining} of {rpd} requests remaining, {_CHAT_CALLS_PER_REPORT} needed). "
            f"Resets at {quota.get('resets_at')}.",
            headers={"Retry-After": "3600"},
        )


async def build_daily_report(user_id: str) -> dict:
    """Build and persist one report for a single user. Raises 409/429 rather than queueing forever."""
    if user_id in _in_flight:
        raise HTTPException(409, "A report is already being generated for this account.")

    await _assert_budget()

    try:
        # Reject fast instead of holding the connection open behind other reports.
        await asyncio.wait_for(_slots.acquire(), timeout=0.1)
    except asyncio.TimeoutError:
        raise HTTPException(
            429,
            f"{_MAX_CONCURRENT} reports are already running. Try again in a few minutes.",
            headers={"Retry-After": "120"},
        )

    _in_flight.add(user_id)
    try:
        return await _build(user_id)
    finally:
        _in_flight.discard(user_id)
        _slots.release()


async def _build(user_id: str) -> dict:
    report: dict = {}
    # Deterministic first and each independently guarded: a Yahoo hiccup on one
    # section shouldn't cost the whole report.
    for key, coro in (
        ("portfolio", TradingService.get_portfolio_summary(user_id)),
        ("risk", RiskService.analyze(user_id)),
        ("scan", MarketScannerService.scan(limit=10)),
    ):
        try:
            report[key] = await coro
        except Exception as e:
            report[key] = {"error": str(e)}

    # Add whole-book risk narration and allocation; keep the numbers if narration fails.
    risk = report.get("risk")
    if isinstance(risk, dict) and risk.get("positions"):
        try:
            risk["analysis"] = await RiskAgentService.explain(risk)
        except Exception as e:
            risk["analysis"] = {"error": str(e)}

    scan = report.get("scan")
    candidates = scan.get("candidates") if isinstance(scan, dict) else None
    if candidates:
        try:
            # Use each scan score as its allocation conviction weight.
            plan = await PortfolioService.allocate(
                [
                    {"ticker": c["symbol"], "conviction": float(c.get("score", 1))}
                    for c in candidates
                ],
                user_id,
            )
            try:
                plan["analysis"] = await PortfolioAgentService.explain(plan)
            except Exception as e:
                plan["analysis"] = {"error": str(e)}
            report["allocation"] = plan
        except Exception as e:
            report["allocation"] = {"error": str(e)}

    doc = DailyReport(
        user_id=user_id,
        portfolio=report.get("portfolio"),
        risk=report.get("risk"),
        scan=report.get("scan"),
        allocation=report.get("allocation"),
    )
    await doc.insert()

    pf = report.get("portfolio") or {}
    try:
        await MemoryService.save(
            "agent_output",
            f"Daily report: portfolio value {pf.get('total_portfolio_value')}, "
            f"total PnL {pf.get('total_pnl')}.",
            metadata={"job": "daily_report", "report_id": str(doc.id)},
            user_id=user_id,
        )
    except Exception:
        # Costs one embedding call; the report itself is already safely in Mongo.
        logger.exception("Could not file the daily report into memory for user %s", user_id)

    return {"id": str(doc.id), "date": doc.date, **report}
