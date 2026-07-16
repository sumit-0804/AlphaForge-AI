from typing import List
from datetime import datetime, timezone
from beanie import Document
from pydantic import BaseModel, Field

from app.models.utc import utc_serializer

class Position(BaseModel):
    ticker:str
    quantity:int
    average_buy_price: float

class Portfolio(Document):
    user_id:str = "default_user"
    cash_balance:float = 100000.0
    positions: List[Position] =[]

    class Settings:
        name = "portfolios"

class Transaction(Document):
    user_id:str
    ticker:str
    action:str
    quantity:int
    price:float
    timestamp:datetime = Field(default_factory=lambda:datetime.now(timezone.utc))

    _ser_timestamp = utc_serializer("timestamp")

    class Settings:
        name = "transactions"