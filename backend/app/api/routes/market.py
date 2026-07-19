from fastapi import APIRouter
from app.services.market_data import MarketDataService

router = APIRouter(prefix="/market", tags=["Market Data"])

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


