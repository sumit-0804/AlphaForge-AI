"""One upstream Yahoo connection per process, refcounted and fanned out to subscribers."""

import asyncio
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from yfinance import AsyncWebSocket

from app.core.exchanges import MARKETS, currency_for_ticker, market_for_ticker
from app.services.market_data import MarketDataService

logger = logging.getLogger(__name__)

# A stalled client drops its oldest tick rather than blocking the upstream reader.
_QUEUE_MAX = 8


def _as_int(v) -> int | None:
    # protobuf renders 64-bit ints as JSON strings, so day_volume/time arrive as text.
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _session_date(ticker: str, epoch: int | None) -> str:
    """Trading date in the exchange's timezone; UTC would misfile an NSE evening tick."""
    tz = ZoneInfo(MARKETS[market_for_ticker(ticker)].timezone)
    if epoch:
        # Yahoo sends milliseconds; tolerate seconds in case that ever changes.
        seconds = epoch / 1000 if epoch > 1_000_000_000_000 else epoch
        return datetime.fromtimestamp(seconds, tz).strftime("%Y-%m-%d")
    return datetime.now(tz).strftime("%Y-%m-%d")


def merge_bar(msg: dict, bar: dict | None) -> dict | None:
    """Fold a tick into the running candle; the feed sends price only, never OHLC."""
    symbol, price = msg.get("id"), msg.get("price")
    if not symbol or price is None:
        return None

    session_date = _session_date(symbol, _as_int(msg.get("time")))
    # A bar from a previous session is stale; start this one from the tick.
    if bar is None or bar.get("session_date") != session_date:
        bar = {"session_date": session_date, "open": price, "high": price, "low": price}

    return {
        "type": "tick",
        "symbol": symbol,
        "price": price,
        "open": bar["open"],
        "high": max(bar["high"], price),
        "low": min(bar["low"], price),
        "volume": _as_int(msg.get("day_volume")),
        "change": msg.get("change"),
        "change_percent": msg.get("change_percent"),
        # 0 pre-market, 1 regular, 2 post-market.
        "market_hours": msg.get("market_hours"),
        "currency": msg.get("currency") or currency_for_ticker(symbol),
        "session_date": session_date,
    }


class PriceHub:
    def __init__(self) -> None:
        self._ws: AsyncWebSocket | None = None
        self._listener: asyncio.Task | None = None
        self._subs: dict[str, set[asyncio.Queue]] = {}
        # Running candle per symbol, since the feed sends price only.
        self._bars: dict[str, dict] = {}
        self._lock = asyncio.Lock()

    @property
    def upstream_connections(self) -> int:
        """0 or 1 — asserted by the tests, since one per viewer is the bug to avoid."""
        return 1 if self._ws is not None else 0

    @property
    def symbols(self) -> set[str]:
        return set(self._subs)

    def _ensure_ws(self) -> AsyncWebSocket:
        if self._ws is None:
            self._ws = AsyncWebSocket(verbose=False)
            logger.info("Live price upstream opened")
        return self._ws

    async def _seed_bar(self, symbol: str) -> dict | None:
        """Today's real OHL from history, so the candle isn't anchored to the connect price."""
        try:
            rows = await asyncio.to_thread(
                MarketDataService.get_ohlcv_data, symbol, "5d", "1d"
            )
        except Exception:
            logger.info("No seed bar for %s; the first tick will open the candle", symbol)
            return None
        if not rows:
            return None
        last = rows[-1]
        return {
            "session_date": last["time"],
            "open": last["open"],
            "high": last["high"],
            "low": last["low"],
        }

    async def _on_message(self, msg: dict) -> None:
        symbol = msg.get("id")
        tick = merge_bar(msg, self._bars.get(symbol))
        if tick is None:
            return
        # Carry the candle forward for the next tick.
        self._bars[symbol] = {
            "session_date": tick["session_date"],
            "open": tick["open"],
            "high": tick["high"],
            "low": tick["low"],
        }
        for q in self._subs.get(tick["symbol"], ()):
            if q.full():
                # Drop the stale tick; only the latest price matters.
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                q.put_nowait(tick)
            except asyncio.QueueFull:
                pass

    async def subscribe(self, symbol: str) -> asyncio.Queue:
        symbol = symbol.upper()
        # Seeded before the lock: a slow fetch must not sit between connect and subscribe.
        seed = await self._seed_bar(symbol) if symbol not in self._subs else None

        async with self._lock:
            first = symbol not in self._subs
            queue: asyncio.Queue = asyncio.Queue(maxsize=_QUEUE_MAX)
            self._subs.setdefault(symbol, set()).add(queue)
            if first:
                self._bars[symbol] = seed or {}
                ws = self._ensure_ws()
                await ws.subscribe(symbol)
                # Listen only after subscribing; reading first loses the stream.
                if self._listener is None:
                    self._listener = asyncio.create_task(ws.listen(self._on_message))
                logger.info("Subscribed upstream to %s", symbol)
            return queue

    async def unsubscribe(self, symbol: str, queue: asyncio.Queue) -> None:
        symbol = symbol.upper()
        async with self._lock:
            subs = self._subs.get(symbol)
            if not subs:
                return
            subs.discard(queue)
            if subs:
                return
            # Last listener gone, so stop paying for the symbol upstream.
            self._subs.pop(symbol, None)
            self._bars.pop(symbol, None)
            if self._ws is not None:
                try:
                    await self._ws.unsubscribe(symbol)
                except Exception:
                    logger.warning("Upstream unsubscribe failed for %s", symbol, exc_info=True)

    async def close(self) -> None:
        async with self._lock:
            self._subs.clear()
            self._bars.clear()
            if self._listener is not None:
                self._listener.cancel()
                self._listener = None
            if self._ws is not None:
                try:
                    await self._ws.close()
                except Exception:
                    logger.warning("Upstream close failed", exc_info=True)
                self._ws = None


hub = PriceHub()
