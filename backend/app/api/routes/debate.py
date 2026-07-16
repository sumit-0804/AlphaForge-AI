import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from app.agents.debate_agent import DebateAgentService

router = APIRouter(prefix="/debate", tags=["Debate Agents"])

@router.get("/{ticker}/stream")
async def debate_stream(ticker: str, news: bool = True, rounds: int = 2):
    # Server-Sent Events: streams the debate live, one event per phase (evidence,
    # memory, opening, each rebuttal round, moderator decision), so the frontend
    # committee view can render the argument as it happens.
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