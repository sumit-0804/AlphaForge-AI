import asyncio

import httpx
from cachetools import TTLCache

from app.core.config import settings

# ECB reference rates via Frankfurter — free, no API key, no rate limit.
# Rates refresh once per working day around 16:00 CET, so a long TTL costs us
# nothing in freshness and keeps the portfolio endpoint off the network.
_rate_cache: TTLCache = TTLCache(maxsize=256, ttl=settings.forex_cache_ttl)
_lock = asyncio.Lock()


def normalize(code: str | None) -> tuple[str, float]:
    """Map a quoted currency to (ISO code, multiplier to reach the major unit).

    yfinance reports London listings in **pence** ("GBp"), not pounds, and South
    African listings in cents ("ZAc"). Treating those as GBP/ZAR would overstate
    the position by 100x, so the minor unit is folded into a multiplier here
    rather than being special-cased at every call site.
    """
    if not code:
        return "USD", 1.0
    if code == "GBp":
        return "GBP", 0.01
    if code == "ZAc":
        return "ZAR", 0.01
    return code.upper(), 1.0


def major_units(price: float | None, code: str | None) -> tuple[float | None, str]:
    """Restate a quoted price in the major unit of its ISO currency.

    Returns (price, iso_code). Feeding a pence-quoted price to an FX rate keyed
    on GBP overstates it 100x, so the conversion happens once here — at ingest —
    and everything downstream can assume major units.
    """
    iso, mult = normalize(code)
    return (price * mult if price is not None else None), iso


class ForexService:
    @classmethod
    async def rate(cls, frm: str, to: str) -> float | None:
        """Units of `to` per one unit of `frm`; None when the pair is unavailable.

        Callers must treat None as "could not convert" and keep the native
        amount, rather than silently falling back to 1.0 — a wrong rate of 1.0
        would make ₹1,400 look like $1,400.
        """
        frm, frm_mult = normalize(frm)
        to, to_mult = normalize(to)
        if frm == to:
            return frm_mult / to_mult

        # The cache holds the raw ISO-to-ISO rate; the minor-unit multiplier is
        # applied on the way out so hits and misses agree.
        key = (frm, to)
        scale = frm_mult / to_mult

        if key in _rate_cache:
            return _rate_cache[key] * scale

        async with _lock:
            # Another coroutine may have populated the entry while we waited.
            if key in _rate_cache:
                return _rate_cache[key] * scale
            try:
                async with httpx.AsyncClient(timeout=settings.forex_timeout) as client:
                    res = await client.get(
                        settings.forex_api_url,
                        params={"base": frm, "symbols": to},
                    )
                    res.raise_for_status()
                    rate = res.json().get("rates", {}).get(to)
            except Exception:
                # Network hiccup or an ECB-unsupported currency (e.g. TWD).
                return None

            if not isinstance(rate, (int, float)) or rate <= 0:
                return None
            _rate_cache[key] = float(rate)

        return _rate_cache[key] * scale

    @classmethod
    async def convert(cls, amount: float, frm: str, to: str) -> float | None:
        if amount is None:
            return None
        r = await cls.rate(frm, to)
        return None if r is None else amount * r

    @classmethod
    async def rates_to_base(cls, currencies: set[str], base: str) -> dict[str, float | None]:
        """Resolve several currencies to `base` at once.

        A portfolio summary needs one rate per distinct listing currency, not one
        per position — fetching them concurrently keeps a 20-position book at two
        or three HTTP calls instead of twenty.
        """
        codes = sorted(currencies)
        results = await asyncio.gather(*(cls.rate(c, base) for c in codes))
        return dict(zip(codes, results))
