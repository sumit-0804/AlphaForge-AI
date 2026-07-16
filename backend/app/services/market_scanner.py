import asyncio

import pandas as pd
import pandas_ta as ta
import yfinance as yf
from cachetools import TTLCache

from app.services.technical_analysis import safe_round
from app.core.exchanges import (
    MARKETS,
    get_exchange,
    market_for_ticker,
    market_status,
)

scan_cache = TTLCache(maxsize=32, ttl=300)

# --- Universes -------------------------------------------------------------
# yfinance suffixes decide the market: ".NS" = NSE, ".BO" = BSE, bare = US.
# The BSE list is deliberately short — the large Indian names are dual-listed
# and NSE carries far more volume, so scanning both suffixes for the same
# company would just surface duplicates. The .BO entries here are for coverage
# of the BSE feed itself rather than to double up on names already in NSE.

NSE_UNIVERSE = [
    "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
    "SBIN.NS", "BHARTIARTL.NS", "ITC.NS", "LT.NS", "KOTAKBANK.NS",
    "HINDUNILVR.NS", "AXISBANK.NS", "BAJFINANCE.NS", "MARUTI.NS",
    "SUNPHARMA.NS", "TATAMOTORS.NS", "TATASTEEL.NS", "WIPRO.NS",
    "HCLTECH.NS", "ADANIENT.NS",
]

BSE_UNIVERSE = [
    "RELIANCE.BO", "TCS.BO", "HDFCBANK.BO", "INFY.BO", "BAJAJ-AUTO.BO",
]

US_UNIVERSE = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD",
    "NFLX", "INTC", "JPM", "V", "DIS", "BA", "PYPL", "CRM",
    "AVGO", "QCOM", "MU", "ADBE",
]

UNIVERSES: dict[str, list[str]] = {
    "NSE": NSE_UNIVERSE,
    "BSE": BSE_UNIVERSE,
    "IN": NSE_UNIVERSE + BSE_UNIVERSE,
    "US": US_UNIVERSE,
    "ALL": NSE_UNIVERSE + BSE_UNIVERSE + US_UNIVERSE,
}

# Kept for backwards compatibility with existing callers.
DEFAULT_UNIVERSE = US_UNIVERSE


def resolve_universe(market: str | None) -> list[str]:
    return UNIVERSES.get((market or "ALL").upper(), UNIVERSES["ALL"])

def _snapshot(last, vol_ratio: float) -> dict:
    return {
        "price": safe_round(last["Close"]),
        "rsi": safe_round(last["RSI_14"]),
        "ema_20": safe_round(last["EMA_20"]),
        "ema_50": safe_round(last["EMA_50"]),
        "volume": int(last["Volume"]),
        "volume_ratio": safe_round(vol_ratio),
    }


def _detect_exit_signals(df: pd.DataFrame) -> dict | None:
    """Bearish / exit setups — the mirror of `_detect_signals`.

    The entry scanner only ever looked for reasons to BUY, so a position that
    was breaking down produced no signal at all. This is what lets the portfolio
    advisor say "this one is rolling over" instead of only ever finding new
    things to buy. Score is severity: higher = more urgent to act on.
    """
    df = df.dropna()
    if len(df) < 2:
        return None

    last, prev = df.iloc[-1], df.iloc[-2]
    signals: list[str] = []
    score = 0

    # Breakdown — close below the lowest low of the prior 20 bars.
    window = df["Low"].iloc[-21:-1]
    if not window.empty and last["Close"] < window.min():
        signals.append("BREAKDOWN")
        score += 3

    # Death cross — EMA20 crossed below EMA50 on the last bar.
    if prev["EMA_20"] >= prev["EMA_50"] and last["EMA_20"] < last["EMA_50"]:
        signals.append("EMA_DEATH_CROSS")
        score += 3

    # Lost the trend — price gave up its 50-day EMA.
    if prev["Close"] >= prev["EMA_50"] and last["Close"] < last["EMA_50"]:
        signals.append("LOST_EMA50")
        score += 2

    # Momentum rolling over out of overbought.
    if prev["RSI_14"] > 70 >= last["RSI_14"]:
        signals.append("RSI_ROLLOVER")
        score += 2

    # Distribution — a down bar on well-above-average volume.
    vol_avg = df["Volume"].iloc[-21:-1].mean()
    vol_ratio = last["Volume"] / vol_avg if vol_avg else 0
    if vol_ratio >= 1.5 and last["Close"] < prev["Close"]:
        signals.append("HIGH_VOLUME_SELLOFF")
        score += 2

    if not signals:
        return None
    return {"signals": signals, "score": score, **_snapshot(last, vol_ratio)}


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

    return {"signals": signals, "score": score, **_snapshot(last, vol_ratio)}

def _load_indicators(ticker: str, period: str, interval: str) -> pd.DataFrame | None:
    df = yf.Ticker(ticker).history(period=period, interval=interval)
    if df.empty or len(df) < 50:
        return None
    df.ta.ema(length=20, append=True)
    df.ta.ema(length=50, append=True)
    df.ta.rsi(length=14, append=True)
    return df


class MarketScannerService:
    @staticmethod
    def _scan_sync(tickers: list[str], period: str, interval: str) -> list[dict]:
        results: list[dict] = []
        for ticker in tickers:
            try:
                df = _load_indicators(ticker, period, interval)
                if df is None:
                    continue
                hit = _detect_signals(df)
                if hit:
                    results.append({"symbol": ticker.upper(), **hit})
            except Exception:
                # A single bad ticker must not abort the whole scan.
                continue
        results.sort(key=lambda r: r["score"], reverse=True)
        return results

    @staticmethod
    def _scan_positions_sync(tickers: list[str], period: str, interval: str) -> dict[str, dict]:
        # Exit-signal scan over names the user already HOLDS. Unlike the entry
        # scan this returns an entry for every ticker, including the quiet ones —
        # "no bearish signal" is itself information the advisor needs in order to
        # say "hold", so silence must be distinguishable from a failed lookup.
        out: dict[str, dict] = {}
        for ticker in tickers:
            t = ticker.upper()
            try:
                df = _load_indicators(ticker, period, interval)
                if df is None:
                    out[t] = {"signals": [], "score": 0, "error": "insufficient history"}
                    continue
                hit = _detect_exit_signals(df)
                out[t] = hit or {"signals": [], "score": 0}
            except Exception as e:
                out[t] = {"signals": [], "score": 0, "error": str(e)}
        return out

    @classmethod
    async def scan_positions(
        cls, tickers: list[str], period: str = "3mo", interval: str = "1d"
    ) -> dict[str, dict]:
        if not tickers:
            return {}
        return await asyncio.to_thread(
            cls._scan_positions_sync, [t.upper() for t in tickers], period, interval
        )
    @classmethod
    async def scan(
        cls,
        tickers: list[str] | None = None,
        period: str = "3mo",
        interval: str = "1d",
        limit: int = 10,
        market: str | None = None,
    ) -> dict:
        universe = [t.upper() for t in (tickers or resolve_universe(market))]
        key = (tuple(universe), period, interval, limit)
        if key in scan_cache:
            return scan_cache[key]

        candidates = await asyncio.to_thread(cls._scan_sync, universe, period, interval)
        # Tag each hit with the market it belongs to so a mixed scan can be
        # grouped, and so the UI can show which session the name trades in.
        for c in candidates:
            c["market"] = market_for_ticker(c["symbol"])
            c["currency"] = get_exchange(c["symbol"]).currency or "USD"

        payload = {
            "scanned": len(universe),
            "matched": len(candidates),
            "market": (market or "ALL").upper(),
            "sessions": {k: market_status(k) for k in MARKETS},
            "candidates": candidates[:limit],
        }
        scan_cache[key] = payload
        return payload