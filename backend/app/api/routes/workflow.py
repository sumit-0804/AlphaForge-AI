from fastapi import APIRouter

from app.graph.workflow import WorkflowService

router = APIRouter(prefix="/workflow", tags=["Workflow"])


@router.get("/{ticker}")
async def run_workflow(ticker: str, news: bool = True):
    # Full agentic pipeline -> explainable recommendation.
    # ?news=false skips the news node for a faster run.
    return await WorkflowService.run(ticker.upper(), include_news=news)