"""UTC-safe datetime serialization for anything that crosses the API boundary.

Every model stores `datetime.now(timezone.utc)`, but MongoDB round-trips BSON
dates as NAIVE datetimes — the offset is gone by the time the value is read back.
Serialized bare, "2026-07-20T07:15:58" is interpreted by `new Date(...)` in the
browser as *local* time, so a UTC instant renders 5h30m early in IST and hours
off everywhere else that isn't UTC.

Attaching UTC on the way out makes the wire format unambiguous, which is what
lets the frontend render in whatever timezone the viewer is actually in.
"""

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
