from datetime import datetime, timezone
from beanie import Document
from pydantic import Field


class Recommendation(Document):
    user_id: str = "default_user"
    symbol: str
    action: str                    # BUY | HOLD | SELL
    confidence: str                # LOW | MEDIUM | HIGH
    rationale: str | None = None
    explanation: dict = {}         # the six-part explainability block
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "recommendations"