from fastapi import APIRouter
from pydantic import BaseModel
from app.services.trading import TradingService

router = APIRouter(prefix="/trading", tags=["Paper trading"])

class TradeRequest(BaseModel):
    ticker:str
    action:str
    quantity:int

@router.get("/portfolio")
async def get_portfolio_summary(user_id:str = "default_user"):
    return await TradingService.get_portfolio_summary(user_id)

@router.post("/execute")
async def execute_trade(trade: TradeRequest, user_id:str = "default_user"):
    return await TradingService.execute_trade(
        user_id=user_id,
        ticker=trade.ticker,
        action=trade.action,
        quantity=trade.quantity
    )

@router.get("/transactions")
async def get_transactions(user_id: str = "default_user", limit: int = 50):
    return await TradingService.get_transaction_history(user_id, limit)
    