from fastapi import APIRouter

from app.services.market_scanner import MarketScannerService
from app.agents.scanner_agent import ScannerAgentService

router = APIRouter(prefix="/scanner", tags=["Scanner"])


@router.get("/")
async def scan(
    period: str = "3mo",
    interval: str = "1d",
    limit: int = 10,
    triage: bool = True,
    market: str = "ALL",
):
    """Scan a market universe for technical entry setups.

    `market` selects the universe: NSE, BSE, IN (both Indian), US, or ALL.

    Two tiers: the rule-based scan is free and always runs, while `triage=true`
    adds a single LLM pass that ranks and explains the shortlist. Deep per-ticker
    analysis is deliberately NOT run here — that is `/workflow/{ticker}`, and it
    is the user's choice which candidates are worth it.
    """
    result = await MarketScannerService.scan(None, period, interval, limit, market)
    if triage and result["candidates"]:
        result["triage"] = await ScannerAgentService.triage(result["candidates"])
    return result
