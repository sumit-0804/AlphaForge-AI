from datetime import datetime, timezone

import pymongo
from beanie import Document
from pydantic import EmailStr, Field

from app.models.utc import utc_serializer


class User(Document):
    email: EmailStr
    password_hash: str
    # Deactivating keeps the book and its history while blocking every login.
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    _ser_created_at = utc_serializer("created_at")

    class Settings:
        name = "users"
        # Unique so a duplicate registration fails at the database, not just in the
        # route's check — two concurrent signups would otherwise both pass it.
        indexes = [
            pymongo.IndexModel([("email", pymongo.ASCENDING)], unique=True, name="email_unique"),
        ]
