from fastapi import APIRouter, Depends

from app.api.deps import current_user_id
from app.models.report import DailyReport
from app.services.llm_service import LLMService
from app.services.memory import MemoryService
from app.services.reports import build_daily_report

# Generating a report spends two chat calls and one embedding, so it is POST and
# it is per-caller — never a fan-out across every account.
router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("/quota")
async def quota(_: str = Depends(current_user_id)):
    """What's left of today's model budget. Cheap enough for the UI to poll."""
    return {
        "chat": await LLMService.quota_snapshot(),
        "embedding": await MemoryService.quota_snapshot(),
    }


@router.post("/daily")
async def create_daily_report(user_id: str = Depends(current_user_id)):
    """Build a whole-book report: portfolio, risk, a market scan and an allocation plan.

    429 if the daily quota can't cover it or too many reports are already running;
    409 if this account already has one in flight.
    """
    return await build_daily_report(user_id)


@router.get("/recent")
async def recent_reports(limit: int = 10, user_id: str = Depends(current_user_id)):
    return (
        await DailyReport.find(DailyReport.user_id == user_id)
        .sort(-DailyReport.date)
        .limit(limit)
        .to_list()
    )


@router.get("/latest")
async def latest_report(user_id: str = Depends(current_user_id)):
    """The most recent report, or null if none has been generated yet."""
    return (
        await DailyReport.find(DailyReport.user_id == user_id)
        .sort(-DailyReport.date)
        .first_or_none()
    )
