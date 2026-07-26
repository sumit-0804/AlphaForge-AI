from datetime import datetime, timezone

import pymongo
from beanie import Document
from pydantic import Field

from app.models.utc import utc_serializer


class DailyQuotaUsage(Document):
    """One row per limiter per quota-day, so the RPD count survives a restart.

    The per-minute window can live in memory — a restart loses at most 60 seconds
    of history. A daily count cannot: redeploying twice would otherwise hand the
    process a fresh 500-request budget each time and blow straight through the cap.
    """

    limiter: str          # "gemini-chat" | "gemini-embed"
    # The provider's quota day, not ours — see Settings.quota_reset_timezone.
    day: str              # YYYY-MM-DD
    # Not named `count`: that shadows Beanie's Document.count() classmethod.
    requests: int = 0
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    _ser_updated_at = utc_serializer("updated_at")

    class Settings:
        name = "daily_quota_usage"
        indexes = [
            pymongo.IndexModel(
                [("limiter", pymongo.ASCENDING), ("day", pymongo.ASCENDING)],
                unique=True,
                name="limiter_day_unique",
            ),
        ]
