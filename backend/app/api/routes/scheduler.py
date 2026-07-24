from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import current_user_id
from app.services.scheduler import (
    scheduler, _last_runs, run_scan, run_update, run_daily_report,
)
from app.core.exchanges import MARKETS, market_status

router = APIRouter(
    prefix="/scheduler", tags=["Scheduler"], dependencies=[Depends(current_user_id)]
)


@router.get("/jobs")
def list_jobs():
    return [
        {"id": j.id, "next_run": j.next_run_time.isoformat() if j.next_run_time else None}
        for j in scheduler.get_jobs()
    ]


@router.get("/status")
def status():
    return {
        "running": scheduler.running,
        "timezone": str(scheduler.timezone),
        # Per-market session state so the UI can show which exchange is live.
        "sessions": {k: market_status(k) for k in MARKETS},
        "last_runs": _last_runs,
    }


@router.post("/run/{job_id}")
async def run_now(job_id: str, user_id: str = Depends(current_user_id)):
    jobs_map = {
        "morning_scan": lambda: run_scan("morning_scan", "IN"),
        "midday_update": run_update,
        "final_scan": lambda: run_scan("final_scan", "IN"),
        "us_open_scan": lambda: run_scan("us_open_scan", "US"),
        "us_close_scan": lambda: run_scan("us_close_scan", "US"),
        # Manual trigger reports on the caller's own book, not every user's.
        "daily_report": lambda: run_daily_report(user_id),
    }
    if job_id not in jobs_map:
        raise HTTPException(404, f"Unknown job '{job_id}'. Valid: {list(jobs_map)}")
    return await jobs_map[job_id]()