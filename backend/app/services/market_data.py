import yfinance as yf
from fastapi import HTTPException
from typing import Dict, Any
from cachetools import TTLCache, cached

from app.core.exchanges import get_exchange

stock_cache = TTLCache(maxsize=100, ttl=300)
ohlcv_cache = TTLCache(maxsize=100, ttl=300)

class MarketDataService:
    @staticmethod
    @cached(cache=stock_cache)
    def get_stock_info(ticker:str)-> Dict[str, Any]:
        #fetch info and current state of stock
        try:
            stock = yf.Ticker(ticker)
            info = stock.info

            if not info or ('regularMarketPrice' not in info and 'currentPrice' not in info):
                raise HTTPException(status_code=404, detail=f"Ticker {ticker} not found")

            ex = get_exchange(ticker)
            return {
                "symbol": info.get("symbol"),
                 "shortName": info.get("shortName"),
                "longName": info.get("longName"),
                "sector": info.get("sector"),
                "industry": info.get("industry"),
                "currentPrice": info.get("currentPrice", info.get("regularMarketPrice")),
                "marketCap": info.get("marketCap"),
                "volume": info.get("volume"),
                "averageVolume": info.get("averageVolume"),
                "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
                "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
                # Exchange context from the central registry (falls back to
                # yfinance's own currency when available).
                "exchange": ex.code or None,
                "exchangeName": ex.name,
                "country": ex.country or None,
                "currency": info.get("currency") or ex.currency or "USD",
            }
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=500, detail=f"Failed to fetch data: {str(e)}")

    @staticmethod
    @cached(cache=ohlcv_cache)
    def get_ohlcv_data(ticker: str, period:str = "1mo", interval:str = "1d") -> list:
        #Fetch historical OHLCV data for charts.
        try:
            stock = yf.Ticker(ticker)
            hist = stock.history(period=period, interval=interval)
            if hist.empty:
                raise HTTPException(status_code=404, detail="No data found for this ticker and period")
            
            data = []
            for index, row in hist.iterrows():
                data.append({
                    "time": index.strftime('%Y-%m-%d'),
                    "open": round(row["Open"],2),
                    "high": round(row["High"],2),
                    "low" : round(row["Low"], 2),
                    "close": round(row["Close"], 2),
                    "volume": int(row["Volume"])
                })
            
            return data
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(status_code=500, detail=f"Failed to fetch OHLCV data: {str(e)}")
            