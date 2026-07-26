"""Rate limiter keeping calls under Google's per-minute and per-day quotas.

Requests and tokens per minute are a sliding window held in memory; callers wait
their turn. Requests per day are counted in Mongo and callers are *rejected*,
because "come back after midnight Pacific" is not a wait worth holding a
connection open for.
"""

import asyncio
import logging
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

_WINDOW = 60.0


def estimate_tokens(text: str) -> int:
    """Rough token estimate at ~4 characters per token."""
    return max(1, len(text) // 4)


class QuotaExhausted(Exception):
    """The daily request cap is spent. Carries when it frees up, for the 429 body."""

    def __init__(self, limiter: str, used: int, rpd: int, resets_at: datetime):
        self.limiter = limiter
        self.used = used
        self.rpd = rpd
        self.resets_at = resets_at
        super().__init__(
            f"{limiter}: daily quota spent ({used}/{rpd}). "
            f"Resets at {resets_at.isoformat()}."
        )


class RateLimiter:
    """Admits a call only when it fits the per-minute request, token and daily budgets."""

    def __init__(
        self,
        rpm: int,
        tpm: int,
        name: str,
        rpd: int | None = None,
        reset_timezone: str = "America/Los_Angeles",
    ):
        self.rpm = rpm
        self.tpm = tpm
        self.name = name
        # None disables the daily cap entirely (and with it every Mongo round-trip).
        self.rpd = rpd
        self.reset_timezone = reset_timezone
        # Each entry is [timestamp, tokens]; a list so settle() can correct it later.
        self._events: deque[list] = deque()
        self._lock = asyncio.Lock()
        # Today's count, mirrored from Mongo. Only reloaded when the day rolls over,
        # so the steady-state cost is one $inc per admitted call, not a read as well.
        self._day: str | None = None
        self._day_count = 0

    def _prune(self, now: float) -> None:
        while self._events and now - self._events[0][0] >= _WINDOW:
            self._events.popleft()

    # ---- daily budget -------------------------------------------------------

    def _today(self) -> str:
        """The provider's quota day. Google resets at midnight Pacific, not ours."""
        return datetime.now(ZoneInfo(self.reset_timezone)).strftime("%Y-%m-%d")

    def _next_reset(self) -> datetime:
        tz = ZoneInfo(self.reset_timezone)
        local = datetime.now(tz)
        midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
        return (midnight + timedelta(days=1)).astimezone(timezone.utc)

    async def _load_day(self) -> None:
        """Pull today's count from Mongo, but only when the day has actually rolled over."""
        day = self._today()
        if day == self._day:
            return
        # Import here: this module is imported at startup, before init_beanie runs.
        from app.models.quota import DailyQuotaUsage

        count = 0
        try:
            doc = await DailyQuotaUsage.find_one(
                DailyQuotaUsage.limiter == self.name, DailyQuotaUsage.day == day
            )
            count = doc.requests if doc else 0
        except Exception:
            # Mongo unreachable. Carrying on with 0 would hand out a fresh budget on
            # every blip, so keep whatever this process has already counted.
            logger.exception("%s: could not read daily quota; using in-memory count", self.name)
            count = self._day_count if self._day is not None else 0
        self._day, self._day_count = day, count

    async def _bump_day(self) -> None:
        self._day_count += 1
        from app.models.quota import DailyQuotaUsage

        try:
            await DailyQuotaUsage.get_pymongo_collection().update_one(
                {"limiter": self.name, "day": self._day},
                {
                    "$inc": {"requests": 1},
                    "$set": {"updated_at": datetime.now(timezone.utc)},
                },
                upsert=True,
            )
        except Exception:
            # The in-memory count already moved, so this process stays correct; only
            # a restart would lose the increment.
            logger.exception("%s: could not persist daily quota increment", self.name)

    async def _check_day(self) -> None:
        if self.rpd is None:
            return
        await self._load_day()
        if self._day_count >= self.rpd:
            raise QuotaExhausted(self.name, self._day_count, self.rpd, self._next_reset())

    # ---- reporting ----------------------------------------------------------

    def usage(self) -> dict:
        now = time.monotonic()
        self._prune(now)
        return {
            "requests": len(self._events),
            "rpm": self.rpm,
            "tokens": sum(e[1] for e in self._events),
            "tpm": self.tpm,
            "requests_today": self._day_count,
            "rpd": self.rpd,
            "day": self._day,
            "resets_at": self._next_reset().isoformat() if self.rpd else None,
        }

    async def acquire(self, tokens: int) -> list:
        """Wait until this call fits under both budgets, then record it. Returns a handle for settle()."""
        tokens = max(0, int(tokens))
        if tokens > self.tpm:
            # A single call bigger than the whole budget can't ever fit, so clamp it and send it alone.
            logger.warning(
                "%s: request of %d tokens exceeds the %d TPM budget; sending it alone",
                self.name, tokens, self.tpm,
            )
            tokens = self.tpm

        async with self._lock:
            while True:
                # Re-checked every pass, not just on entry: a wait below can run past
                # midnight Pacific, and a caller admitted after the roll-over must be
                # counted against the new day.
                await self._check_day()

                now = time.monotonic()
                self._prune(now)
                used = sum(e[1] for e in self._events)
                if len(self._events) < self.rpm and used + tokens <= self.tpm:
                    entry = [now, tokens]
                    self._events.append(entry)
                    if self.rpd is not None:
                        await self._bump_day()
                    return entry

                # No room yet; hold the lock and wait for the oldest call to leave the window.
                wait = _WINDOW - (now - self._events[0][0]) + 0.05
                logger.info(
                    "%s at quota (%d/%d req, %d/%d tok) — waiting %.1fs",
                    self.name, len(self._events), self.rpm, used, self.tpm, wait,
                )
                await asyncio.sleep(wait)

    async def snapshot(self) -> dict:
        """usage() with the daily count refreshed from Mongo first."""
        if self.rpd is not None:
            await self._load_day()
        return self.usage()

    def settle(self, handle: list, actual_tokens: int | None) -> None:
        """Swap the estimate for the real token count once the reply arrives."""
        if actual_tokens is None:
            return
        handle[1] = max(0, int(actual_tokens))
