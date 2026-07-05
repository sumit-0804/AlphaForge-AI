import asyncio

import pandas as pd
import pandas_ta as ta
import yfinance as yf
from cachetools import TTLCache

from app.services.technical_analysis import safe_round

scan_cache = TTLCache(maxsize=32, ttl=300)

DEFAULT_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD",
    "NFLX", "INTC", "JPM", "V", "DIS", "BA", "PYPL", "CRM",
]

def _detect_signals(df: pd.DataFrame) -> dict | None:
    # df already carries the EMA/RSI columns appended by pandas_ta.
    df = df.dropna()
    if len(df) < 2:
        return None

    last, prev = df.iloc[-1], df.iloc[-2]
    signals: list[str] = []
    score = 0

    # Breakout — close above the highest high of the prior 20 bars.
    window = df["High"].iloc[-21:-1]
    if not window.empty and last["Close"] > window.max():
        signals.append("BREAKOUT")
        score += 2

    # High volume — today's volume well above its 20-bar average.
    vol_avg = df["Volume"].iloc[-21:-1].mean()
    vol_ratio = last["Volume"] / vol_avg if vol_avg else 0
    if vol_ratio >= 1.5:
        signals.append("HIGH_VOLUME")
        score += 1

    # Bullish EMA crossover — EMA20 crossed above EMA50 on the last bar.
    if prev["EMA_20"] <= prev["EMA_50"] and last["EMA_20"] > last["EMA_50"]:
        signals.append("EMA_CROSSOVER")
        score += 2

    # RSI recovery — crossing back up through 30 out of oversold territory.
    if prev["RSI_14"] < 30 <= last["RSI_14"]:
        signals.append("RSI_RECOVERY")
        score += 2

    if not signals:
        return None

    return {
        "signals": signals,
        "score": score,
        "price": safe_round(last["Close"]),
        "rsi": safe_round(last["RSI_14"]),
        "ema_20": safe_round(last["EMA_20"]),
        "ema_50": safe_round(last["EMA_50"]),
        "volume": int(last["Volume"]),
        "volume_ratio": safe_round(vol_ratio),
    }

class MarketScannerService:
    @staticmethod
    def _scan_sync(tickers: list[str], period: str, interval: str) -> list[dict]:
        results: list[dict] = []
        for ticker in tickers:
            try:
                df = yf.Ticker(ticker).history(period=period, interval=interval)
                if df.empty or len(df) < 50:
                    continue
                df.ta.ema(length=20, append=True)
                df.ta.ema(length=50, append=True)
                df.ta.rsi(length=14, append=True)
                hit = _detect_signals(df)
                if hit:
                    results.append({"symbol": ticker.upper(), **hit})
            except Exception:
                # A single bad ticker must not abort the whole scan.
                continue
        results.sort(key=lambda r: r["score"], reverse=True)
        return results
    @classmethod
    async def scan(
        cls,
        tickers: list[str] | None = None,
        period: str = "3mo",
        interval: str = "1d",
        limit: int = 10,
    ) -> dict:
        universe = [t.upper() for t in (tickers or DEFAULT_UNIVERSE)]
        key = (tuple(universe), period, interval, limit)
        if key in scan_cache:
            return scan_cache[key]
        
        candidates = await asyncio.to_thread(cls._scan_sync, universe, period, interval)
        payload = {
            "scanned": len(universe),
            "matched": len(candidates),
            "candidates": candidates[:limit],
        }
        scan_cache[key] = payload
        return payload