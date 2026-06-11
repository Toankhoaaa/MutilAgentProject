"""Shared FastAPI dependency providers for API routers."""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlalchemy import update
from sqlalchemy.orm import Session

from backend.api.auth_dependencies import get_current_user
from backend.core.database import get_db
from backend.models.user import User
from backend.services.agents import (
    EmailAnalysisAgent,
    EmailClassifierAgent,
    EmailResponseAgent,
    EmailSchedulingAgent,
)
from backend.services.gmail_service import (
    GmailAuthenticationError,
    GmailService,
    google_credentials_from_token_json,
)

__all__ = [
    "get_db",
    "get_gmail_service",
    "get_classifier_agent",
    "get_response_agent",
    "get_analysis_agent",
    "get_scheduling_agent",
    "require_admin",
    "check_quota",
    "increment_request_count",
]


def require_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """Raise 403 if the authenticated user is not an admin."""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required.",
        )
    return current_user


def check_quota(
    current_user: User = Depends(get_current_user),
) -> User:
    """Raise 403 if the account is inactive, 429 if the request quota is exhausted."""
    if current_user.status != "ACTIVE":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not active.",
        )
    if current_user.request_count >= current_user.max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Request quota exceeded. "
                f"Limit: {current_user.max_requests} requests per period."
            ),
        )
    return current_user


def increment_request_count(user: User, db: Session) -> None:
    """Atomically increment request_count by 1 to avoid read-modify-write races."""
    db.execute(
        update(User)
        .where(User.id == user.id)
        .values(request_count=User.request_count + 1)
        .execution_options(synchronize_session=False)
    )
    db.commit()


def get_gmail_service(
    current_user: User = Depends(get_current_user),
) -> GmailService:
    """Build Gmail API client from the logged-in user's stored OAuth token."""
    if not current_user.google_oauth_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google OAuth token missing. Please sign in again.",
        )
    try:
        creds = google_credentials_from_token_json(current_user.google_oauth_token)
    except GmailAuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc
    return GmailService(credentials=creds)


def get_classifier_agent() -> EmailClassifierAgent:
    """Provide the email classifier agent."""
    return EmailClassifierAgent()


def get_response_agent() -> EmailResponseAgent:
    """Provide the email response drafting agent."""
    return EmailResponseAgent()


def get_analysis_agent() -> EmailAnalysisAgent:
    """Provide the email deep-analysis agent."""
    try:
        return EmailAnalysisAgent()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


def get_scheduling_agent() -> EmailSchedulingAgent:
    """Provide the scheduling extraction agent."""
    try:
        return EmailSchedulingAgent()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
