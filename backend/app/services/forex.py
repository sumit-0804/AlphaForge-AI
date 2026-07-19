import asyncio

import httpx
from cachetools import TTLCache

from app.core.config import settings

# ECB rates change once a day, so cache them for a long time.
_rate_cache: TTLCache = TTLCache(maxsize=256, ttl=settings.forex_cache_ttl)
_lock = asyncio.Lock()


def normalize(code: str | None) -> tuple[str, float]:
    """Return (ISO code, multiplier to major units) — e.g. GBp pence -> GBP at 0.01."""
    if not code:
        return "USD", 1.0
    if code == "GBp":
        return "GBP", 0.01
    if code == "ZAc":
        return "ZAR", 0.01
    return code.upper(), 1.0


def major_units(price: float | None, code: str | None) -> tuple[float | None, str]:
    """Convert a quoted price to its major unit and return (price, iso_code)."""
    iso, mult = normalize(code)
    return (price * mult if price is not None else None), iso


class ForexService:
    @classmethod
    async def rate(cls, frm: str, to: str) -> float | None:
        """How many `to` per one `frm`, or None if unavailable — never guess a rate."""
        frm, frm_mult = normalize(frm)
        to, to_mult = normalize(to)
        if frm == to:
            return frm_mult / to_mult

        # Cache the plain ISO rate and apply the minor-unit scale on the way out.
        key = (frm, to)
        scale = frm_mult / to_mult

        if key in _rate_cache:
            return _rate_cache[key] * scale

        async with _lock:
            # Re-check in case another coroutine filled it while we waited.
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
                # Network error or a currency ECB doesn't cover.
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
        """Fetch rates for several currencies to `base` at once."""
        codes = sorted(currencies)
        results = await asyncio.gather(*(cls.rate(c, base) for c in codes))
        return dict(zip(codes, results))
