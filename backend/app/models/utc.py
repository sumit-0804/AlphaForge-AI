# Serialize datetimes as UTC ISO strings, since Mongo returns them naive and the browser
# would otherwise read them as local time.

from datetime import datetime, timezone

from pydantic import field_serializer


def to_utc_iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    # Naive values coming back from Mongo are UTC by construction.
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def utc_serializer(*fields: str):
    """Build a pydantic field serializer covering the given datetime fields."""
    return field_serializer(*fields)(lambda self, dt, _info=None: to_utc_iso(dt))
