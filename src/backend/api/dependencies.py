"""Shared FastAPI dependency providers for API routers."""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
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
]


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
    return EmailAnalysisAgent()


def get_scheduling_agent() -> EmailSchedulingAgent:
    """Provide the scheduling extraction agent."""
    return EmailSchedulingAgent()
