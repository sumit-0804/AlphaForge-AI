from fastapi import APIRouter

from app.services.risk import RiskService
from app.agents.risk_agent import RiskAgentService

router = APIRouter(prefix="/risk", tags=["Risk Agent"])


@router.get("/")
async def analyze_risk(
    user_id: str = "default_user",
    benchmark: str = "^GSPC",
    risk_free: float = 0.04,
    period: str = "1y",
    explain: bool = True,
):
    report = await RiskService.analyze(user_id, benchmark, risk_free, period)
    if explain and report.get("positions"):
        report["analysis"] = await RiskAgentService.explain(report)
    return report