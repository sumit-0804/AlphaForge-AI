from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings
from app.services.market_scanner import MarketScannerService
from app.services.risk import RiskService
from app.services.trading import TradingService
from app.services.memory import MemoryService
from app.models.report import DailyReport

scheduler = AsyncIOScheduler(timezone=settings.scheduler_timezone)
_last_runs: dict = {}   # in-memory snapshot of each job's most recent run

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def run_scan(label: str = "scan") -> dict:
    try:
        result = await MarketScannerService.scan(limit=10)
        top = ", ".join(c["symbol"] for c in result["candidates"][:5]) or "none"
        _last_runs[label] = {"at": _now(), "matched": result["matched"], "top": top}
        await MemoryService.save(
            "agent_output",
            f"{label}: {result['matched']} candidates matched (top: {top}).",
            metadata={"job": label, "matched": result["matched"]},
        )
        return result
    except Exception as e:
        _last_runs[label] = {"at": _now(), "error": str(e)}
        return {"error": str(e)}


async def run_update() -> dict:
    return await run_scan("midday_update")


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

    doc = DailyReport(
        user_id=user_id,
        portfolio=report.get("portfolio"),
        risk=report.get("risk"),
        scan=report.get("scan"),
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
    scheduler.add_job(run_scan, CronTrigger(hour=9, minute=15), args=["morning_scan"],
                      id="morning_scan", replace_existing=True)
    scheduler.add_job(run_update, CronTrigger(hour=11, minute=0),
                      id="midday_update", replace_existing=True)
    scheduler.add_job(run_scan, CronTrigger(hour=15, minute=30), args=["final_scan"],
                      id="final_scan", replace_existing=True)
    scheduler.add_job(run_daily_report, CronTrigger(hour=16, minute=0),
                      id="daily_report", replace_existing=True)
    scheduler.start()


def shutdown_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)