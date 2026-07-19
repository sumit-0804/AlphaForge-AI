from typing import List
from datetime import datetime, timezone
from beanie import Document
from pydantic import BaseModel, Field

from app.models.utc import utc_serializer

class Position(BaseModel):
    ticker:str
    quantity:int
    # In the stock's own listing currency.
    average_buy_price: float
    currency: str | None = None
    # What this holding cost in the book's base currency, at the day's rate. None on old positions.
    cost_basis_base: float | None = None

class Portfolio(Document):
    user_id:str = "default_user"
    cash_balance:float = 100000.0
    positions: List[Position] =[]
    # Currency of cash_balance and every *_base figure, fixed per portfolio.
    base_currency: str | None = None

    class Settings:
        name = "portfolios"

class Transaction(Document):
    user_id:str
    ticker:str
    action:str
    quantity:int
    # In the stock's own listing currency.
    price:float
    currency: str | None = None
    # FX rate and base-currency amount recorded at execution time.
    fx_rate: float | None = None
    base_currency: str | None = None
    total_base: float | None = None
    timestamp:datetime = Field(default_factory=lambda:datetime.now(timezone.utc))

    _ser_timestamp = utc_serializer("timestamp")

    class Settings:
        name = "transactions"