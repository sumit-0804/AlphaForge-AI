from datetime import datetime, timezone
from beanie import Document
from pydantic import Field


class DailyReport(Document):
    user_id: str = "default_user"
    date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    portfolio: dict | None = None
    risk: dict | None = None
    scan: dict | None = None

    class Settings:
        name = "daily_reports"