from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings
from app.services.market_scanner import MarketScannerService
from app.services.risk import RiskService
from app.services.portfolio import PortfolioService
from app.services.trading import TradingService
from app.services.memory import MemoryService
from app.agents.risk_agent import RiskAgentService
from app.agents.portfolio_agent import PortfolioAgentService
from app.models.report import DailyReport
from app.core.exchanges import MARKETS, market_status

scheduler = AsyncIOScheduler(timezone=settings.scheduler_timezone)
_last_runs: dict = {}   # in-memory snapshot of each job's most recent run

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def run_scan(label: str = "scan", market: str = "ALL") -> dict:
    try:
        result = await MarketScannerService.scan(limit=10, market=market)
        top = ", ".join(c["symbol"] for c in result["candidates"][:5]) or "none"
        _last_runs[label] = {
            "at": _now(),
            "market": market,
            "matched": result["matched"],
            "top": top,
        }
        await MemoryService.save(
            "agent_output",
            f"{label} [{market}]: {result['matched']} candidates matched (top: {top}).",
            metadata={"job": label, "market": market, "matched": result["matched"]},
        )
        return result
    except Exception as e:
        _last_runs[label] = {"at": _now(), "market": market, "error": str(e)}
        return {"error": str(e)}


async def run_update() -> dict:
    return await run_scan("midday_update", "IN")


async def run_daily_report(user_id: str = "default_user") -> dict:
    report: dict = {}
    for key, coro in (
        ("portfolio", TradingService.get_portfolio_summary(user_id)),
        ("risk", RiskService.analyze(user_id)),
        ("scan", MarketScannerService.scan(limit=10)),
    ):
        try:
            report[key] = await coro
        except Exception as e:
            report[key] = {"error": str(e)}

    # --- Portfolio-level agentic pass -------------------------------------
    # Risk narration and capital allocation used to hang off standalone /risk
    # and /portfolio/allocate endpoints. Both reason over the whole book rather
    # than a single ticker, so they don't belong in the per-ticker workflow
    # graph — the daily report is the only place a portfolio-level view is
    # actually assembled, so they run here. Each is best-effort: a failed
    # narration must not cost us the computed numbers underneath it.
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
            # The scanner's signal score becomes the allocator's conviction
            # weight, so the strongest technical setups get the larger targets.
            plan = await PortfolioService.allocate(
                [
                    {"ticker": c["symbol"], "conviction": float(c.get("score", 1))}
                    for c in candidates
                ],
                user_id=user_id,
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
    _last_runs["daily_report"] = {"at": _now(), "id": str(doc.id)}

    pf = report.get("portfolio") or {}
    try:
        await MemoryService.save(
            "agent_output",
            f"Daily report: portfolio value {pf.get('total_portfolio_value')}, "
            f"total PnL {pf.get('total_pnl')}.",
            metadata={"job": "daily_report", "report_id": str(doc.id)},
        )
    except Exception:
        pass
    return {"id": str(doc.id), **report}


def start_scheduler() -> None:
    if scheduler.running:
        return

    IN_TZ = MARKETS["IN"].timezone      # Asia/Kolkata
    US_TZ = MARKETS["US"].timezone      # America/New_York

    # Indian session (09:15-15:30 IST).
    scheduler.add_job(run_scan, CronTrigger(hour=9, minute=20, timezone=IN_TZ),
                      args=["morning_scan", "IN"],
                      id="morning_scan", replace_existing=True)
    scheduler.add_job(run_update, CronTrigger(hour=12, minute=0, timezone=IN_TZ),
                      id="midday_update", replace_existing=True)
    scheduler.add_job(run_scan, CronTrigger(hour=15, minute=20, timezone=IN_TZ),
                      args=["final_scan", "IN"],
                      id="final_scan", replace_existing=True)

    # US session. Scheduled in EASTERN time, not a hardcoded IST offset — the US
    # market moves against IST by an hour twice a year for DST, so pinning these
    # to IST would drift the scans outside market hours for months at a time.
    # ZoneInfo handles the shift; for a viewer in Kolkata these fire at 19:00 IST
    # in summer and 20:00 in winter automatically.
    scheduler.add_job(run_scan, CronTrigger(hour=9, minute=35, timezone=US_TZ),
                      args=["us_open_scan", "US"],
                      id="us_open_scan", replace_existing=True)
    scheduler.add_job(run_scan, CronTrigger(hour=15, minute=30, timezone=US_TZ),
                      args=["us_close_scan", "US"],
                      id="us_close_scan", replace_existing=True)

    # Daily report after the Indian close, covering the whole book.
    scheduler.add_job(run_daily_report, CronTrigger(hour=16, minute=0, timezone=IN_TZ),
                      id="daily_report", replace_existing=True)
    scheduler.start()


def shutdown_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)