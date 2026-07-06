import yfinance as yf
from fastapi import HTTPException
from cachetools import TTLCache, cached

fundamental_cache = TTLCache(maxsize=100, ttl=600)

def _num(val):
    try:
        return None if val is None else round(float(val),4)
    except (TypeError, ValueError):
        return None

def _pct(val):
    n = _num(val)
    return round(n * 100, 2) if n is not None else None

def _health(revenue: dict, debt: dict, cash_flow:dict, valuation:dict)->dict:
    checks=[
        ("Revenue Growing", (revenue["revenueGrowth"] or 0 ) > 0, 15),
        ("Profitable (net margin > 0)", (revenue["profitMargin"] or 0) > 0, 15),
        ("Positive free cash flow", (cash_flow["freeCashflow"] or 0) > 0, 20),
        ("Manageable leverage (D/E < 1.0x)",
         debt["debtToEquity"] is not None and debt["debtToEquity"] < 100, 15),
        ("Liquid (current ratio >= 1)", (debt["currentRatio"] or 0) >= 1, 15),
        ("Positive return on equity", (valuation["returnOnEquity"] or 0) > 0, 20),
    ]

    score = sum(pts for _, ok, pts in checks if ok)
    label = (
        "STRONG" if score >= 75
        else "MODERATE" if score >= 50
        else "WEAK" if score >= 25
        else "POOR"
    )
    return {
        "score": score,
        "label": label,
        "checks": [{"name": n, "passed": ok} for n, ok, _ in checks],
    }

class FundamentalService:
    @staticmethod
    @cached(cache=fundamental_cache)
    def get_fundamentals(ticker:str) -> dict:
        try:
            info = yf.Ticker(ticker).info
            if not info or ("regularMarketPrice" not in info and "currentPrice" not in info):
                raise HTTPException(404, f"Ticker {ticker} not found")
            
            revenue = {
                "totalRevenue": _num(info.get("totalRevenue")),
                "revenueGrowth": _pct(info.get("revenueGrowth")),
                "earningsGrowth": _pct(info.get("earningsGrowth")),
                "grossMargin": _pct(info.get("grossMargins")),
                "operatingMargin": _pct(info.get("operatingMargins")),
                "profitMargin": _pct(info.get("profitMargins")),
            }
            debt = {
                "totalDebt": _num(info.get("totalDebt")),
                "totalCash": _num(info.get("totalCash")),
                "debtToEquity": _num(info.get("debtToEquity")),
                "currentRatio": _num(info.get("currentRatio")),
                "quickRatio": _num(info.get("quickRatio")),
            }
            cash_flow = {
                "operatingCashflow": _num(info.get("operatingCashflow")),
                "freeCashflow": _num(info.get("freeCashflow")),
                "ebitda": _num(info.get("ebitda")),
            }
            valuation = {
                "trailingPE": _num(info.get("trailingPE")),
                "forwardPE": _num(info.get("forwardPE")),
                "priceToBook": _num(info.get("priceToBook")),
                "returnOnEquity": _pct(info.get("returnOnEquity")),
                "returnOnAssets": _pct(info.get("returnOnAssets")),
            }
            return {
                "symbol": (info.get("symbol") or ticker).upper(),
                "name": info.get("longName") or info.get("shortName"),
                "currency": info.get("financialCurrency") or info.get("currency") or "USD",
                "revenue": revenue,
                "debt": debt,
                "cashFlow": cash_flow,
                "valuation": valuation,
                "health": _health(revenue, debt, cash_flow, valuation),
            }
        except Exception as e:
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(500, f"Failed to fetch fundamentals: {str(e)}")