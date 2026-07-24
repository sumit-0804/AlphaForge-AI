from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from pymongo.errors import DuplicateKeyError

from app.api.deps import current_user
from app.core.config import settings
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User
from app.services.trading import TradingService

router = APIRouter(prefix="/auth", tags=["Auth"])


class Credentials(BaseModel):
    email: EmailStr
    # 8 is the floor; the ceiling only exists to stop a multi-megabyte body reaching bcrypt.
    password: str = Field(min_length=8, max_length=256)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: "UserResponse"


class UserResponse(BaseModel):
    id: str
    email: EmailStr

    @classmethod
    def of(cls, user: User) -> "UserResponse":
        return cls(id=str(user.id), email=user.email)


TokenResponse.model_rebuild()


def _issue(user: User) -> TokenResponse:
    token, expires_in = create_access_token(str(user.id))
    return TokenResponse(
        access_token=token, expires_in=expires_in, user=UserResponse.of(user)
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(body: Credentials) -> TokenResponse:
    """Create an account and its opening paper-trading book, then log straight in."""
    if not settings.allow_registration:
        raise HTTPException(403, "Registration is closed on this instance.")

    # Emails are case-insensitive in practice; store one canonical form so the
    # unique index actually prevents Bob@x.com and bob@x.com being two accounts.
    email = body.email.strip().lower()

    user = User(email=email, password_hash=hash_password(body.password))
    try:
        await user.insert()
    except DuplicateKeyError:
        raise HTTPException(409, "An account with that email already exists.")

    # Create the book now so a fresh user's first portfolio read isn't a special case.
    await TradingService.get_portfolio(str(user.id))
    return _issue(user)


@router.post("/login", response_model=TokenResponse)
async def login(body: Credentials) -> TokenResponse:
    email = body.email.strip().lower()
    user = await User.find_one(User.email == email)

    # One message for "no such user" and "wrong password" — the difference tells an
    # attacker which emails have accounts.
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Incorrect email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(403, "This account is deactivated.")

    return _issue(user)


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(current_user)) -> UserResponse:
    """Used by the client on boot to check whether a stored token is still good."""
    return UserResponse.of(user)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=256)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(body: PasswordChange, user: User = Depends(current_user)) -> None:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect.")
    user.password_hash = hash_password(body.new_password)
    await user.save()
    # Tokens already issued stay valid until they expire; there is no revocation list.
