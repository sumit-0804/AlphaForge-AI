from fastapi import APIRouter
from pydantic import BaseModel

from app.agents.reflection_agent import ReflectionAgentService

router = APIRouter(prefix="/reflection", tags=["Reflection Agent"])


class ReflectRequest(BaseModel):
    ticker: str
    quantity: int
    buy_price: float
    sell_price: float
    user_id: str = "default_user"


@router.post("/")
async def reflect(req: ReflectRequest):
    return await ReflectionAgentService.reflect(
        req.ticker, req.quantity, req.buy_price, req.sell_price, req.user_id
    )