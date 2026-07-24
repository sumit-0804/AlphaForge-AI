"""Auth dependencies.

`current_user` resolves the bearer token to a User document; `current_user_id`
is the string every user-scoped query and Document already keys on. Routes should
depend on `current_user_id` unless they actually need the email or flags, so a
request costs one token decode and one indexed lookup at most.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.security import decode_access_token
from app.models.user import User

# auto_error=False so a missing header produces our 401 with a WWW-Authenticate
# header rather than FastAPI's bare 403.
_bearer = HTTPBearer(auto_error=False)

_UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


async def current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    if creds is None or not creds.credentials:
        raise _UNAUTHENTICATED

    user_id = decode_access_token(creds.credentials)
    if user_id is None:
        raise _UNAUTHENTICATED

    user = await User.get(user_id)
    # A token outliving its account, or issued before deactivation, must not work.
    if user is None or not user.is_active:
        raise _UNAUTHENTICATED
    return user


async def current_user_id(user: User = Depends(current_user)) -> str:
    return str(user.id)
