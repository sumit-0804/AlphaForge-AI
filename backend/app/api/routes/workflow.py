import json

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.api.deps import current_user_id
from app.graph.workflow import WorkflowService

router = APIRouter(prefix="/workflow", tags=["Workflow"])

@router.get("/history")
async def recommendation_history(
    ticker: str | None = None, limit: int = 20, user_id: str = Depends(current_user_id)
):
    return await WorkflowService.history(user_id, ticker, limit)


@router.get("/{ticker}/stream")
async def run_workflow_stream(
    ticker: str, news: bool = True, rounds: int = 2,
    user_id: str = Depends(current_user_id),
):
    # Streams the whole pipeline live: each node, the routing, the debate, then the recommendation.
    rounds = max(1, min(rounds, 5))

    async def event_source():
        try:
            async for ev in WorkflowService.run_stream(
                ticker.upper(), user_id, include_news=news, rounds=rounds
            ):
                yield f"data: {json.dumps(ev, default=str)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )

@router.get("/{ticker}")
async def run_workflow(
    ticker: str, news: bool = True, user_id: str = Depends(current_user_id)
):
    # Run the full pipeline; ?news=false skips the news node for speed.
    return await WorkflowService.run(ticker.upper(), user_id, include_news=news)