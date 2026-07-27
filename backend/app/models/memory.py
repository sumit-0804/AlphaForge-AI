from datetime import datetime, timezone

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, ConfigDict, Field

from app.models.utc import utc_serializer

MEMORY_TYPES = ("user_preference", "research_report", "agent_output", "lesson")

class MemoryEntry(Document):
    user_id : str
    type:str
    ticker: str | None = None
    content: str
    metadata:dict = {}
    # Nullable on purpose: a memory is still written when embedding fails or the
    # quota is spent, staying unsearchable until backfilled rather than being lost.
    embedding: list[float] | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    _ser_created_at = utc_serializer("created_at")

    class Settings:
        name="memories"


class MemoryEntryView(BaseModel):
    """A MemoryEntry without the vector, which every read path projects to. The
    embedding is 1536 floats no consumer uses and would dwarf the payload it rides on.
    """

    model_config = ConfigDict(populate_by_name=True)

    id: PydanticObjectId = Field(alias="_id")
    user_id: str
    type: str
    ticker: str | None = None
    content: str
    metadata: dict = {}
    created_at: datetime

    _ser_created_at = utc_serializer("created_at")
