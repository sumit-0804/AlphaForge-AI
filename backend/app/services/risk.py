import asyncio

import pandas as pd
import yfinance as yf
from fastapi import HTTPException
from cachetools import TTLCache

from app.services.trading import TradingService
from app.services.market_data import MarketDataService
from app.core.exchanges import benchmark_for_ticker

risk_cache = TTLCache(maxsize=32, ttl=300)
TRADING_DAYS = 252


def _annualized_vol(returns: pd.Series) -> float:
    return float(returns.std() * (TRADING_DAYS ** 0.5))


def _beta(asset_ret: pd.Series, bench_ret: pd.Series) -> float | None:
    df = pd.concat([asset_ret, bench_ret], axis=1).dropna()
    if len(df) < 2:
        return None
    var = df.iloc[:, 1].var()
    return float(df.cov().iloc[0, 1] / var) if var else None


def _risk_level(vol: float | None, beta: float | None) -> str:
    # vol is a fraction (0.22 == 22% annualized).
    if vol is None or pd.isna(vol):
        return "UNKNOWN"
    if vol < 0.15 and (beta or 0) < 1:
        return "LOW"
    if vol < 0.30:
        return "MODERATE"
    return "HIGH"


class RiskService:
    # Portfolio volatility, beta, Sharpe and sector exposure from ~1y of daily returns.

    @staticmethod
    def _price_history(tickers: list[str], period: str) -> dict[str, pd.Series]:
        closes: dict[str, pd.Series] = {}
        for t in tickers:
            try:
                h = yf.Ticker(t).history(period=period)
                if not h.empty:
                    close = h["Close"]
                    # Index to calendar date: US and Indian series carry different
                    # timezones, so without this a mixed book fails to align and
                    # every cross-market join drops to NaN.
                    close.index = close.index.tz_localize(None).normalize()
                    closes[t] = close
            except Exception:
                continue
        return closes

    @classmethod
    def _compute(cls, summary: dict, benchmark: str, risk_free: float, period: str) -> dict:
        positions = summary["positions"]
        total_equity = sum(p["current_value"] for p in positions)

        # Fetch every position plus each benchmark we need: one per position's own
        # market, and the portfolio-level index for the aggregate beta.
        tickers = [p["ticker"] for p in positions]
        benches = {benchmark_for_ticker(t) for t in tickers} | {benchmark}
        closes = cls._price_history(tickers + sorted(benches), period)

        def _ret(series):
            return series.pct_change(fill_method=None).dropna() if series is not None else None

        bench_rets = {b: _ret(closes.get(b)) for b in benches}
        bench_ret = bench_rets.get(benchmark)   # portfolio-level index

        per_position: list[dict] = []
        ret_frame: dict[str, pd.Series] = {}
        weights: dict[str, float] = {}
        sector_value: dict[str, float] = {}

        for p in positions:
            t = p["ticker"]
            w = p["current_value"] / total_equity if total_equity else 0.0
            weights[t] = w

            try:
                sector = MarketDataService.get_stock_info(t).get("sector") or "Unknown"
            except Exception:
                sector = "Unknown"
            sector_value[sector] = sector_value.get(sector, 0.0) + p["current_value"]

            c = closes.get(t)
            if c is None:
                per_position.append({"ticker": t, "weight": round(w, 4), "volatility": None, "beta": None})
                continue

            r = c.pct_change(fill_method=None).dropna()
            ret_frame[t] = r
            # Each name's beta is measured against its OWN market index.
            own_bench = bench_rets.get(benchmark_for_ticker(t))
            beta = _beta(r, own_bench) if own_bench is not None else None
            per_position.append({
                "ticker": t,
                "sector": sector,
                "weight": round(w, 4),
                "current_value": p["current_value"],
                "volatility": round(_annualized_vol(r) * 100, 2),
                "beta": round(beta, 3) if beta is not None else None,
            })

        portfolio_metrics = None
        R = pd.DataFrame(ret_frame).dropna() if ret_frame else pd.DataFrame()
        # Need at least two overlapping days across the priced names to say anything.
        if len(R) >= 2:
            wvec = pd.Series({t: weights[t] for t in R.columns})
            wvec = wvec / wvec.sum()                     # renormalize over priced names
            port_ret = R.mul(wvec, axis=1).sum(axis=1)

            port_vol = _annualized_vol(port_ret)
            port_beta = _beta(port_ret, bench_ret) if bench_ret is not None else None
            ann_return = float(port_ret.mean() * TRADING_DAYS)
            sharpe = (ann_return - risk_free) / port_vol if port_vol else None

            portfolio_metrics = {
                "total_equity": round(total_equity, 2),
                "volatility": round(port_vol * 100, 2),
                "beta": round(port_beta, 3) if port_beta is not None else None,
                "sharpe_ratio": round(sharpe, 2) if sharpe is not None else None,
                "annualized_return": round(ann_return * 100, 2),
                "risk_level": _risk_level(port_vol, port_beta),
            }

        return {
            "user_id": summary["user_id"],
            "benchmark": benchmark,
            "risk_free_rate": risk_free,
            "period": period,
            "portfolio": portfolio_metrics,
            "positions": per_position,
            "sector_exposure": {
                sec: round(val / total_equity * 100, 2) if total_equity else 0.0
                for sec, val in sector_value.items()
            },
        }

    @classmethod
    def _compute_ticker(cls, ticker: str, benchmark: str, period: str) -> dict:
        closes = cls._price_history([ticker, benchmark], period)
        c = closes.get(ticker)
        if c is None:
            return {"ticker": ticker, "volatility": None, "beta": None,
                    "risk_level": "UNKNOWN", "benchmark": benchmark}
        r = c.pct_change(fill_method=None).dropna()
        bench = closes.get(benchmark)
        bench_ret = bench.pct_change(fill_method=None).dropna() if bench is not None else None
        vol = _annualized_vol(r)
        beta = _beta(r, bench_ret) if bench_ret is not None else None
        return {
            "ticker": ticker,
            "volatility": round(vol * 100, 2),
            "beta": round(beta, 3) if beta is not None else None,
            "risk_level": _risk_level(vol, beta),
            "benchmark": benchmark,
        }

    @classmethod
    async def analyze_ticker(
        cls, ticker: str, benchmark: str | None = None, period: str = "1y"
    ) -> dict:
        # Single-stock risk (volatility, beta, level) — no portfolio needed.
        # Default the benchmark to the ticker's own market index (Nifty for IN, S&P for US).
        ticker = ticker.upper()
        bench = benchmark or benchmark_for_ticker(ticker)
        return await asyncio.to_thread(cls._compute_ticker, ticker, bench, period)

    @classmethod
    async def analyze(
        cls,
        user_id: str = "default_user",
        benchmark: str = "^GSPC",
        risk_free: float = 0.04,
        period: str = "1y",
    ) -> dict:
        summary = await TradingService.get_portfolio_summary(user_id)
        if not summary["positions"]:
            return {
                "user_id": user_id,
                "benchmark": benchmark,
                "portfolio": None,
                "positions": [],
                "sector_exposure": {},
                "message": "Portfolio has no positions to analyse.",
            }
        # Blocking yfinance/pandas work -> off the event loop.
        return await asyncio.to_thread(cls._compute, summary, benchmark, risk_free, period)