from fastapi import APIRouter, HTTPException

from app.services.scheduler import (
    scheduler, _last_runs, run_scan, run_update, run_daily_report,
)
from app.models.report import DailyReport

router = APIRouter(prefix="/scheduler", tags=["Scheduler"])


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
        "last_runs": _last_runs,
    }


@router.post("/run/{job_id}")
async def run_now(job_id: str):
    jobs_map = {
        "morning_scan": lambda: run_scan("morning_scan"),
        "midday_update": run_update,
        "final_scan": lambda: run_scan("final_scan"),
        "daily_report": run_daily_report,
    }
    if job_id not in jobs_map:
        raise HTTPException(404, f"Unknown job '{job_id}'. Valid: {list(jobs_map)}")
    return await jobs_map[job_id]()


@router.get("/report/latest")
async def latest_report(user_id: str = "default_user"):
    doc = await DailyReport.find(DailyReport.user_id == user_id).sort("-date").first_or_none()
    if not doc:
        raise HTTPException(404, "No report generated yet")
    return doc