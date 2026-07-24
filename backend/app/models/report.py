from datetime import datetime, timezone
from beanie import Document
from pydantic import Field

from app.models.utc import utc_serializer


class DailyReport(Document):
    user_id: str
    date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    portfolio: dict | None = None
    risk: dict | None = None
    scan: dict | None = None
    # Allocation plan over the scan's candidates, with the agent's read under "analysis".
    allocation: dict | None = None

    _ser_date = utc_serializer("date")

    class Settings:
        name = "daily_reports"