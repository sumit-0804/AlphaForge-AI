from dataclasses import dataclass
from datetime import datetime, time
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Exchange:
    code: str
    name: str
    country: str
    currency: str


# US listings carry no yfinance suffix -> the "" key is the default.
_US = Exchange("", "NASDAQ / NYSE", "US", "USD")
_UNKNOWN = Exchange("", "Unknown", "", "")

# yfinance ticker suffix -> Exchange. Single source of truth for the project.
EXCHANGES: dict[str, Exchange] = {
    "": _US,
    "NS": Exchange("NSE", "National Stock Exchange of India", "IN", "INR"),
    "BO": Exchange("BSE", "Bombay Stock Exchange", "IN", "INR"),
    "L":  Exchange("LSE", "London Stock Exchange", "GB", "GBP"),
    "TO": Exchange("TSX", "Toronto Stock Exchange", "CA", "CAD"),
    "V":  Exchange("TSXV", "TSX Venture Exchange", "CA", "CAD"),
    "HK": Exchange("HKEX", "Hong Kong Stock Exchange", "HK", "HKD"),
    "AX": Exchange("ASX", "Australian Securities Exchange", "AU", "AUD"),
    "T":  Exchange("TSE", "Tokyo Stock Exchange", "JP", "JPY"),
    "SS": Exchange("SSE", "Shanghai Stock Exchange", "CN", "CNY"),
    "SZ": Exchange("SZSE", "Shenzhen Stock Exchange", "CN", "CNY"),
    "DE": Exchange("XETRA", "Deutsche Börse Xetra", "DE", "EUR"),
    "F":  Exchange("FRA", "Frankfurt Stock Exchange", "DE", "EUR"),
    "PA": Exchange("Euronext", "Euronext Paris", "FR", "EUR"),
    "AS": Exchange("Euronext", "Euronext Amsterdam", "NL", "EUR"),
    "MI": Exchange("BIT", "Borsa Italiana", "IT", "EUR"),
    "MC": Exchange("BME", "Bolsa de Madrid", "ES", "EUR"),
    "SW": Exchange("SIX", "SIX Swiss Exchange", "CH", "CHF"),
    "ST": Exchange("OMX", "Nasdaq Stockholm", "SE", "SEK"),
    "KS": Exchange("KRX", "Korea Exchange", "KR", "KRW"),
    "KQ": Exchange("KOSDAQ", "KOSDAQ", "KR", "KRW"),
    "TW": Exchange("TWSE", "Taiwan Stock Exchange", "TW", "TWD"),
    "SI": Exchange("SGX", "Singapore Exchange", "SG", "SGD"),
    "SA": Exchange("B3", "B3 - Brasil Bolsa Balcão", "BR", "BRL"),
    "JO": Exchange("JSE", "Johannesburg Stock Exchange", "ZA", "ZAR"),
    "NZ": Exchange("NZX", "New Zealand Exchange", "NZ", "NZD"),
}


def split_ticker(ticker: str) -> tuple[str, str]:
    # "RELIANCE.NS" -> ("RELIANCE", "NS")  |  "AAPL" -> ("AAPL", "")
    base, _, suffix = ticker.upper().partition(".")
    return base, suffix


def get_exchange(ticker: str) -> Exchange:
    _, suffix = split_ticker(ticker)
    return EXCHANGES.get(suffix, _UNKNOWN)


def currency_for_ticker(ticker: str) -> str:
    # "RELIANCE.NS" -> "INR"  |  "AAPL" -> "USD". Used when a quote payload is
    # unavailable; live quotes carry their own `currency` and should win.
    return get_exchange(ticker).currency or "USD"


def news_query(ticker: str) -> str:
    # "RELIANCE.NS" -> "RELIANCE NSE stock"  |  "AAPL" -> "AAPL stock"
    base, _ = split_ticker(ticker)
    ex = get_exchange(ticker)
    return " ".join(p for p in (base, ex.code, "stock") if p)


def news_country(ticker: str) -> str:
    # Country code for the Google News edition; "" when unknown.
    return get_exchange(ticker).country


# Trading hours in each market's own timezone so DST is handled automatically.

@dataclass(frozen=True)
class Market:
    key: str
    label: str
    timezone: str
    open: time
    close: time
    # Index used as the beta benchmark for this market's stocks.
    benchmark: str
    # Weekday indices the market trades on (Mon=0). Both markets are Mon-Fri.
    weekdays: tuple[int, ...] = (0, 1, 2, 3, 4)


MARKETS: dict[str, Market] = {
    "IN": Market("IN", "NSE / BSE", "Asia/Kolkata", time(9, 15), time(15, 30), "^NSEI"),
    "US": Market("US", "NASDAQ / NYSE", "America/New_York", time(9, 30), time(16, 0), "^GSPC"),
}


def market_for_ticker(ticker: str) -> str:
    # .NS/.BO map to India; everything else defaults to US.
    _, suffix = split_ticker(ticker)
    return "IN" if suffix in ("NS", "BO") else "US"


def benchmark_for_ticker(ticker: str) -> str:
    # Nifty 50 for Indian names, S&P 500 for US — beta against a foreign index is meaningless.
    return MARKETS[market_for_ticker(ticker)].benchmark


def market_status(key: str, now: datetime | None = None) -> dict:
    """Whether a market is open now plus its local time (ignores holidays)."""
    m = MARKETS[key]
    tz = ZoneInfo(m.timezone)
    local = (now or datetime.now(tz)).astimezone(tz)
    is_open = local.weekday() in m.weekdays and m.open <= local.time() <= m.close
    return {
        "market": m.key,
        "label": m.label,
        "timezone": m.timezone,
        "local_time": local.isoformat(),
        "opens": m.open.strftime("%H:%M"),
        "closes": m.close.strftime("%H:%M"),
        "is_open": is_open,
    }