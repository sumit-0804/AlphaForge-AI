from fastapi import APIRouter, Depends

from app.api.deps import current_user_id
from app.core.exchanges import MARKETS, market_status
from app.services.market_data import MarketDataService

# Not user-scoped, but still gated: these hit Yahoo on every call, and an open
# endpoint is a free way for anyone to get this deployment rate-limited.
router = APIRouter(
    prefix="/market", tags=["Market Data"], dependencies=[Depends(current_user_id)]
)

@router.get("/sessions")
def get_sessions():
    # Per-market open/closed state. Purely local clock arithmetic, no Yahoo call.
    return {k: market_status(k) for k in MARKETS}

@router.get("/search")
async def search_symbols(q: str, limit: int = 10):
    # Find tickers matching a company name or partial symbol.
    return MarketDataService.search_symbols(q, limit)

@router.get("/info/{ticker}")
async def get_stock_info(ticker:str):
    # Return general info for a stock ticker.
    return MarketDataService.get_stock_info(ticker)

@router.get("/history/{ticker}")
async def get_stock_history(ticker:str, period:str="1mo", interval:str="1d"):
    # Fetch OHLCV data.
    return MarketDataService.get_ohlcv_data(ticker.upper(), period,interval)


