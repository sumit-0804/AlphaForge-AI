"""Sliding-window rate limiter that keeps calls under Google's per-minute request and token quotas."""

import asyncio
import logging
import time
from collections import deque

logger = logging.getLogger(__name__)

_WINDOW = 60.0


def estimate_tokens(text: str) -> int:
    """Rough token estimate at ~4 characters per token."""
    return max(1, len(text) // 4)


class RateLimiter:
    """Admits a call only when it fits both the request and token budget for the last minute."""

    def __init__(self, rpm: int, tpm: int, name: str):
        self.rpm = rpm
        self.tpm = tpm
        self.name = name
        # Each entry is [timestamp, tokens]; a list so settle() can correct it later.
        self._events: deque[list] = deque()
        self._lock = asyncio.Lock()

    def _prune(self, now: float) -> None:
        while self._events and now - self._events[0][0] >= _WINDOW:
            self._events.popleft()

    def usage(self) -> dict:
        now = time.monotonic()
        self._prune(now)
        return {
            "requests": len(self._events),
            "rpm": self.rpm,
            "tokens": sum(e[1] for e in self._events),
            "tpm": self.tpm,
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
                now = time.monotonic()
                self._prune(now)
                used = sum(e[1] for e in self._events)
                if len(self._events) < self.rpm and used + tokens <= self.tpm:
                    entry = [now, tokens]
                    self._events.append(entry)
                    return entry

                # No room yet; hold the lock and wait for the oldest call to leave the window.
                wait = _WINDOW - (now - self._events[0][0]) + 0.05
                logger.info(
                    "%s at quota (%d/%d req, %d/%d tok) — waiting %.1fs",
                    self.name, len(self._events), self.rpm, used, self.tpm, wait,
                )
                await asyncio.sleep(wait)

    def settle(self, handle: list, actual_tokens: int | None) -> None:
        """Swap the estimate for the real token count once the reply arrives."""
        if actual_tokens is None:
            return
        handle[1] = max(0, int(actual_tokens))
