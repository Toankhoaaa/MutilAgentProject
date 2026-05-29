"""Shared pytest fixtures for FastAPI API tests."""

from __future__ import annotations

from collections.abc import Generator
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import get_db
from app.core.security import create_access_token
from app.main import app
from app.models.agent_run import AgentRun
from app.models.base import Base
from app.models.classification import Classification
from app.models.draft import Draft
from app.models.email import Email
from app.models.user import User

TEST_DATABASE_URL = "sqlite:///:memory:"

test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=test_engine,
    class_=Session,
    future=True,
)


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    """Create a fresh in-memory SQLite database for each test."""
    Base.metadata.create_all(bind=test_engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient, None, None]:
    """FastAPI TestClient wired to the in-memory database."""

    def override_get_db() -> Generator[Session, None, None]:
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def seed_data(db_session: Session) -> dict[str, object]:
    """
    Seed mock data: 1 user, 2 emails, 1 classification, 1 draft, 1 agent run.

    Returns a dict of ORM objects and ids for use in tests.
    """
    user = User(
        email="tester@example.com",
        display_name="Test User",
        is_active=True,
    )
    db_session.add(user)
    db_session.flush()

    now = datetime.now(timezone.utc)

    email_with_draft = Email(
        user_id=user.id,
        gmail_message_id="gmail-msg-001",
        thread_id="thread-001",
        sender="sender@example.com",
        subject="Urgent request",
        body="Please review ASAP.",
        received_at=now,
        is_processed=True,
        processed_at=now,
        labels=["INBOX", "UNREAD"],
    )
    email_plain = Email(
        user_id=user.id,
        gmail_message_id="gmail-msg-002",
        thread_id="thread-002",
        sender="news@example.com",
        subject="Newsletter",
        body="Weekly update.",
        received_at=now,
        is_processed=False,
        labels=["INBOX"],
    )
    db_session.add_all([email_with_draft, email_plain])
    db_session.flush()

    classification = Classification(
        email_id=email_with_draft.id,
        category="urgent",
        priority_score=9,
        summary="Needs immediate attention.",
        confidence=0.95,
    )
    draft = Draft(
        email_id=email_with_draft.id,
        draft_content="Original draft body.",
        draft_gmail_id="draft-gmail-001",
        subject="Re: Urgent request",
        is_modified=False,
        is_sent=False,
    )
    agent_run = AgentRun(
        run_type="batch",
        triggered_by="api",
        total_emails_processed=1,
        total_time_ms=5000,
        llm_calls_count=2,
        llm_total_time_ms=120_000,
        status="COMPLETED",
        started_at=now,
        ended_at=now,
    )
    db_session.add_all([classification, draft, agent_run])
    db_session.commit()

    db_session.refresh(user)
    db_session.refresh(email_with_draft)
    db_session.refresh(email_plain)
    db_session.refresh(classification)
    db_session.refresh(draft)
    db_session.refresh(agent_run)

    return {
        "user": user,
        "email_with_draft": email_with_draft,
        "email_plain": email_plain,
        "classification": classification,
        "draft": draft,
        "agent_run": agent_run,
    }


@pytest.fixture
def auth_headers(seed_data: dict[str, object]) -> dict[str, str]:
    """Authorization header for the seeded test user."""
    user: User = seed_data["user"]  # type: ignore[assignment]
    token = create_access_token(user.id, user.email)
    return {"Authorization": f"Bearer {token}"}
