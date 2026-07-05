from fastapi import APIRouter
from pydantic import BaseModel

from app.services.market_scanner import MarketScannerService

router = APIRouter(prefix="/scanner", tags=["Market Scanner"])


class ScanRequest(BaseModel):
    tickers: list[str] | None = None
    period: str = "3mo"
    interval: str = "1d"
    limit: int = 10


@router.get("/")
async def scan_default(period: str = "3mo", interval: str = "1d", limit: int = 10):
    # Scans the built-in default universe.
    return await MarketScannerService.scan(None, period, interval, limit)


@router.post("/")
async def scan_custom(req: ScanRequest):
    # Scans a caller-supplied watchlist.
    return await MarketScannerService.scan(
        req.tickers, req.period, req.interval, req.limit
    )