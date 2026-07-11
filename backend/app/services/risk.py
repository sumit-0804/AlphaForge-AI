import asyncio

import pandas as pd
import yfinance as yf
from fastapi import HTTPException
from cachetools import TTLCache

from app.services.trading import TradingService
from app.services.market_data import MarketDataService

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
    if vol is None:
        return "UNKNOWN"
    if vol < 0.15 and (beta or 0) < 1:
        return "LOW"
    if vol < 0.30:
        return "MODERATE"
    return "HIGH"


class RiskService:
    # portfolio-level volatility / beta / Sharpe + sector exposure,
    # computed from ~1y of daily returns against a market benchmark.

    @staticmethod
    def _price_history(tickers: list[str], period: str) -> dict[str, pd.Series]:
        closes: dict[str, pd.Series] = {}
        for t in tickers:
            try:
                h = yf.Ticker(t).history(period=period)
                if not h.empty:
                    closes[t] = h["Close"]
            except Exception:
                continue
        return closes

    @classmethod
    def _compute(cls, summary: dict, benchmark: str, risk_free: float, period: str) -> dict:
        positions = summary["positions"]
        total_equity = sum(p["current_value"] for p in positions)

        closes = cls._price_history([p["ticker"] for p in positions] + [benchmark], period)
        bench_close = closes.get(benchmark)
        bench_ret = bench_close.pct_change(fill_method=None).dropna() if bench_close is not None else None

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
            beta = _beta(r, bench_ret) if bench_ret is not None else None
            per_position.append({
                "ticker": t,
                "sector": sector,
                "weight": round(w, 4),
                "current_value": p["current_value"],
                "volatility": round(_annualized_vol(r) * 100, 2),
                "beta": round(beta, 3) if beta is not None else None,
            })

        portfolio_metrics = None
        if ret_frame:
            R = pd.DataFrame(ret_frame).dropna()
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