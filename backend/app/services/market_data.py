import yfinance as yf
from fastapi import HTTPException
from typing import Dict, Any
from cachetools import TTLCache, cached

from app.core.exchanges import get_exchange

stock_cache = TTLCache(maxsize=100, ttl=300)
ohlcv_cache = TTLCache(maxsize=100, ttl=300)
search_cache = TTLCache(maxsize=200, ttl=300)

class MarketDataService:
    @staticmethod
    @cached(cache=stock_cache)
    def get_stock_info(ticker:str)-> Dict[str, Any]:
        # Fetch info and current price for a stock.
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
                # Exchange info from the registry, falling back to yfinance's currency.
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
    @cached(cache=search_cache)
    def search_symbols(query: str, limit: int = 10) -> list:
        # Search tickers by company name or partial symbol via Yahoo.
        query = query.strip()
        if not query:
            return []
        try:
            quotes = yf.Search(query, max_results=limit).quotes
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Symbol search failed: {str(e)}")

        results = []
        for q in quotes:
            symbol = q.get("symbol")
            if not symbol:
                continue
            results.append({
                "symbol": symbol,
                "name": q.get("shortname") or q.get("longname") or symbol,
                "exchange": q.get("exchDisp") or q.get("exchange"),
                "type": q.get("quoteType") or q.get("typeDisp"),
            })
        return results

    @staticmethod
    @cached(cache=ohlcv_cache)
    def get_ohlcv_data(ticker: str, period:str = "1mo", interval:str = "1d") -> list:
        # Fetch historical OHLCV data for charts.
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
            