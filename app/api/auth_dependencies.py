"""Authentication dependency helpers (session cookie + optional JWT)."""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.user import User

_bearer_scheme = HTTPBearer(auto_error=False)


def _user_from_session(request: Request, db: Session) -> User | None:
    user_id_raw = request.session.get("user_id")
    if not user_id_raw:
        return None
    try:
        user_id = UUID(str(user_id_raw))
    except ValueError:
        return None
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        return None
    return user


def _user_from_jwt(credentials: HTTPAuthorizationCredentials, db: Session) -> User | None:
    payload = decode_access_token(credentials.credentials)
    user_id_raw = payload.get("sub")
    if not user_id_raw:
        return None
    try:
        user_id = UUID(str(user_id_raw))
    except ValueError:
        return None
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        return None
    return user


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    Resolve the authenticated user from session cookie or Bearer JWT.

    Raises:
        HTTPException: 401 when no valid session or token is present.
    """
    user = _user_from_session(request, db)
    if user is not None:
        return user

    if credentials is not None:
        user = _user_from_jwt(credentials, db)
        if user is not None:
            return user

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated.",
        headers={"WWW-Authenticate": "Bearer"},
    )
