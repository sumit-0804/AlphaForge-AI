from beanie import Document
from pydantic import Field
from datetime import datetime

class HealthCheck(Document):
    status: str
    checked_at: datetime = Field(default_factory=datetime.utcnow)