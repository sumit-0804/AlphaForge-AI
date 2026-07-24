"""Password hashing and JWT issuing/verification.

Deliberately small: bcrypt for passwords, a signed HS256 token for sessions. There
is no refresh-token dance — the access token is long-lived and the client simply
logs in again when it expires.
"""
import base64
import hashlib
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.core.config import settings


def _prehash(password: str) -> bytes:
    # bcrypt silently ignores anything past 72 bytes (and 5.x raises), so fold the
    # whole password into a fixed-width digest first. Base64 rather than raw digest
    # because bcrypt also stops at the first NUL byte.
    return base64.b64encode(hashlib.sha256(password.encode("utf-8")).digest())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prehash(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_prehash(password), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        # Malformed hash in the DB — treat as a failed login, never as a pass.
        return False


def create_access_token(user_id: str) -> tuple[str, int]:
    """Return (token, seconds_until_expiry)."""
    ttl = timedelta(minutes=settings.access_token_ttl_minutes)
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, int(ttl.total_seconds())


def decode_access_token(token: str) -> str | None:
    """Return the user id the token was issued for, or None if it isn't valid."""
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except jwt.PyJWTError:
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) and sub else None
