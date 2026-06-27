"""Google OAuth2 web login routes (authlib + Starlette session)."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from uuid import UUID

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.auth_dependencies import get_current_user
from backend.core.config import settings
from backend.core.database import get_db
from backend.core.security import create_access_token, get_password_hash, verify_password
from backend.models.user import User
from backend.schemas.api_schemas import TokenResponse, UserProfileResponse
from backend.schemas.auth_schemas import AdminLoginRequest, AdminRegisterRequest


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])

oauth = OAuth()
oauth.register(
    name="google",
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={
        "scope": (
            "openid email profile "
            "https://www.googleapis.com/auth/gmail.modify "
            "https://www.googleapis.com/auth/calendar.readonly "
            "https://www.googleapis.com/auth/calendar.events"
        ),
    },
)

_AUTH_CALLBACK_PATH = "/api/v1/auth/callback"


def _oauth_redirect_uri(request: Request) -> str:
    """
    Build the OAuth callback URL from the incoming request host.

    Google treats ``localhost`` and ``127.0.0.1`` as different redirect URIs.
    Prefer explicit ``GOOGLE_OAUTH_REDIRECT_URI``, then the SPA ``FRONTEND_URL`` proxy,
    otherwise derive from the request host.
    """
    if settings.GOOGLE_OAUTH_REDIRECT_URI:
        return settings.GOOGLE_OAUTH_REDIRECT_URI
    if settings.FRONTEND_URL:
        return f"{settings.FRONTEND_URL.rstrip('/')}{_AUTH_CALLBACK_PATH}"
    base = str(request.base_url).rstrip("/")
    return f"{base}{_AUTH_CALLBACK_PATH}"


def _token_to_json(token: dict[str, object]) -> str:
    """Serialize OAuth token for persistence and Gmail API refresh."""
    enriched = dict(token)
    enriched.setdefault("client_id", settings.GOOGLE_CLIENT_ID)
    enriched.setdefault("client_secret", settings.GOOGLE_CLIENT_SECRET)
    enriched.setdefault("token_uri", "https://oauth2.googleapis.com/token")

    def _default(value: object) -> str:
        return str(value)

    return json.dumps(enriched, default=_default)


def _upsert_user_from_google(
    db: Session,
    *,
    email: str,
    display_name: str | None,
    token_json: str,
) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(
            email=email,
            display_name=display_name,
            google_oauth_token=token_json,
            is_active=True,
        )
        db.add(user)
    else:
        user.display_name = display_name or user.display_name
        user.google_oauth_token = token_json
        user.is_active = True
        user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user


@router.get("/login")
async def login(request: Request) -> RedirectResponse:
    """Redirect the browser to Google's OAuth consent screen."""
    redirect_uri = _oauth_redirect_uri(request)
    logger.info("OAuth authorize redirect_uri=%s", redirect_uri)
    return await oauth.google.authorize_redirect(
        request,
        redirect_uri,
        access_type="offline",
        prompt="consent",
    )


@router.get("/callback")
async def callback(
    request: Request,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Exchange the authorization code, persist the user, and open a session."""
    try:
        token = await oauth.google.authorize_access_token(request)
    except Exception as exc:
        logger.exception("OAuth callback failed: %s", exc)
        login_url = f"{settings.FRONTEND_URL.rstrip('/')}/login?error=oauth_failed"
        return RedirectResponse(url=login_url, status_code=status.HTTP_302_FOUND)
    user_info = token.get("userinfo")
    if not isinstance(user_info, dict):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Google did not return user profile (userinfo).",
        )

    email = user_info.get("email")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Google profile did not include an email.",
        )

    display_name = user_info.get("name")
    token_json = _token_to_json(token)
    user = _upsert_user_from_google(
        db,
        email=email,
        display_name=display_name,
        token_json=token_json,
    )
    request.session["user_id"] = str(user.id)
    dest = "/admin" if user.is_admin else "/dashboard"
    redirect_url = f"{settings.FRONTEND_URL.rstrip('/')}{dest}"
    return RedirectResponse(url=redirect_url, status_code=status.HTTP_302_FOUND)


@router.get("/token", response_model=TokenResponse)
def get_token(request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    """Issue a signed JWT for the currently authenticated session (used by the browser extension)."""
    user_id_raw = request.session.get("user_id")
    if not user_id_raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated.")
    try:
        user_id = UUID(str(user_id_raw))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session.") from exc
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive.")
    token = create_access_token(user_id=user.id, email=user.email, is_admin=user.is_admin)
    return TokenResponse(
        access_token=token,
        expires_in_minutes=settings.JWT_EXPIRE_MINUTES,
        user=UserProfileResponse.model_validate(user),
    )


@router.get("/me", response_model=UserProfileResponse)
def me(current_user: User = Depends(get_current_user)) -> UserProfileResponse:
    """Return the authenticated user (session cookie or Bearer JWT)."""
    return UserProfileResponse.model_validate(current_user)


@router.get("/logout")
def logout(request: Request) -> RedirectResponse:
    """Clear the session and return to the login page."""
    request.session.clear()
    login_url = f"{settings.FRONTEND_URL.rstrip('/')}/login"
    return RedirectResponse(url=login_url, status_code=status.HTTP_302_FOUND)


@router.post("/admin/register", status_code=status.HTTP_201_CREATED)
def admin_register(payload: AdminRegisterRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    """Register a new admin account protected by a server-side secret key."""
    if payload.secret_key != settings.ADMIN_REGISTRATION_SECRET:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid registration secret.")

    existing = db.scalar(select(User).where(User.email == payload.email))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered.")

    user = User(
        email=payload.email,
        display_name=payload.display_name,
        hashed_password=get_password_hash(payload.password),
        is_admin=True,
        is_active=True,
        subscription_tier="ENTERPRISE",
    )
    db.add(user)
    db.commit()
    return {"message": "Admin account created successfully."}


@router.post("/admin/login", response_model=UserProfileResponse)
def admin_login(
    payload: AdminLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> UserProfileResponse:
    """Authenticate an admin via email + password, open a session, and return the user profile."""
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None or not user.hashed_password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")

    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is disabled.")

    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This endpoint is for admins only.")

    # Write the session the same way the Google OAuth callback does — the Starlette
    # SessionMiddleware sets an httpOnly signed cookie, so no token is exposed to JS.
    request.session["user_id"] = str(user.id)
    return UserProfileResponse.model_validate(user)
