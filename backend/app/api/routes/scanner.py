from fastapi import APIRouter, Depends

from app.api.deps import current_user_id
from app.services.market_scanner import MarketScannerService
from app.agents.scanner_agent import ScannerAgentService

# The scan universe is market-wide, so nothing here is per-user — but triage spends
# an LLM call per scan, so it needs an account behind it.
router = APIRouter(
    prefix="/scanner", tags=["Scanner"], dependencies=[Depends(current_user_id)]
)


@router.get("/")
async def scan(
    period: str = "3mo",
    interval: str = "1d",
    limit: int = 10,
    triage: bool = True,
    market: str = "ALL",
):
    """Scan a market universe for entry setups; triage=true adds an LLM pass to rank them."""
    result = await MarketScannerService.scan(None, period, interval, limit, market)
    if triage and result["candidates"]:
        result["triage"] = await ScannerAgentService.triage(result["candidates"])
    return result
