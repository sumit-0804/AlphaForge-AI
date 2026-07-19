import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.agents.debate_agent import DebateAgentService

router = APIRouter(prefix="/debate", tags=["Debate Agents"])

@router.get("/{ticker}/stream")
async def debate_stream(ticker: str, news: bool = True, rounds: int = 2):
    # Streams the debate live, one event per phase, for the committee view.
    rounds = max(1, min(rounds, 5))

    async def event_source():
        try:
            async for event in DebateAgentService.debate_stream(
                ticker.upper(), include_news=news, max_rounds=rounds
            ):
                yield f"data: {json.dumps(event, default=str)}\n\n"
        except Exception as e:  # last-ditch: surface the failure to the client
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable proxy buffering so events flush live
        },
    )