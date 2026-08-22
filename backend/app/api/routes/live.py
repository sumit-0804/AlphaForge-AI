import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.exchanges import market_for_ticker, market_status
from app.core.security import decode_access_token
from app.services.live_prices import hub

router = APIRouter(prefix="/live", tags=["Live"])
logger = logging.getLogger(__name__)


def _token_from_subprotocol(ws: WebSocket) -> str | None:
    """No headers on a WebSocket, so the JWT rides in the subprotocol, not the URL."""
    raw = ws.headers.get("sec-websocket-protocol", "")
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    return parts[1] if len(parts) >= 2 and parts[0] == "bearer" else None


async def _pump(ws: WebSocket, queue: asyncio.Queue) -> None:
    while True:
        await ws.send_json(await queue.get())


@router.websocket("")
async def live_prices(ws: WebSocket) -> None:
    """Stream ticks for one symbol at a time. Client sends {"subscribe": "AAPL"}."""
    token = _token_from_subprotocol(ws)
    user_id = decode_access_token(token) if token else None
    if user_id is None:
        # 1008 = policy violation. Reject before accept so nothing is streamed.
        await ws.close(code=1008)
        return
    await ws.accept(subprotocol="bearer")

    symbol: str | None = None
    queue: asyncio.Queue | None = None
    pump: asyncio.Task | None = None

    async def stop_current() -> None:
        nonlocal symbol, queue, pump
        if pump is not None:
            pump.cancel()
            pump = None
        if symbol is not None and queue is not None:
            await hub.unsubscribe(symbol, queue)
        symbol, queue = None, None

    try:
        while True:
            msg = await ws.receive_json()
            wanted = str(msg.get("subscribe") or "").upper()
            if not wanted or wanted == symbol:
                continue

            await stop_current()
            symbol = wanted
            queue = await hub.subscribe(symbol)
            pump = asyncio.create_task(_pump(ws, queue))
            # Say whether to expect ticks; out of hours the feed is simply silent.
            await ws.send_json({
                "type": "subscribed",
                "symbol": symbol,
                "market": market_status(market_for_ticker(symbol)),
            })
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.warning("Live socket failed for user %s", user_id, exc_info=True)
    finally:
        # Always release the refcount, or the symbol stays subscribed forever.
        await stop_current()
