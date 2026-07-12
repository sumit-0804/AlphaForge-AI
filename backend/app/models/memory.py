from datetime import datetime, timezone
from beanie import Document
from pydantic import Field

MEMORY_TYPES = ("user_preference", "research_report", "agent_output", "lesson")

class MemoryEntry(Document):
    user_id : str = "default_user"
    type:str
    ticker: str | None = None
    content: str
    metadata:dict = {}
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name="memories"
