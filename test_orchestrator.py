#!/usr/bin/env python3
"""
Integration test script for EmailOrchestrator.

Runs a full batch against mock Gmail data and prints database assertions.
Requires GEMINI_API_KEY in .env for real Classifier/Response agents.
"""

from __future__ import annotations

import asyncio
import logging
import sys
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

# Ensure project root is importable when executed as a script.
PROJECT_ROOT = Path(__file__).resolve().parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import settings
from app.models import (  # noqa: F401 — register all models on metadata
    AgentRun,
    AuditLog,
    Classification,
    Draft,
    Email,
    ProcessingQueue,
    User,
)
from app.models.base import Base
from app.services.agents import EmailClassifierAgent, EmailResponseAgent
from app.services.orchestrator import EmailOrchestrator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("test_orchestrator")

TEST_DATABASE_URL = "sqlite:///./test_orchestrator.db"
SEED_USER_EMAIL = "integration.test@example.com"


class MockGmailService:
    """Mock Gmail client returning fixed emails for integration testing."""

    MOCK_EMAILS: list[dict[str, Any]] = [
        {
            "gmail_message_id": "test-msg-urgent-001",
            "thread_id": "test-thread-001",
            "subject": "URGENT: Invoice #991 overdue — payment required today",
            "sender": "billing@vendor.com",
            "recipient": SEED_USER_EMAIL,
            "date": "2026-05-08T08:00:00+00:00",
            "snippet": "Your invoice is overdue. Pay before 5 PM today.",
            "body": (
                "Dear customer,\n\nInvoice #991 is 30 days overdue. "
                "Please settle payment before 5 PM today to avoid service suspension.\n\n"
                "Billing Team"
            ),
            "body_html": None,
        },
        {
            "gmail_message_id": "test-msg-spam-002",
            "thread_id": "test-thread-002",
            "subject": "WIN a FREE iPhone — Click NOW!!!",
            "sender": "promo@spam-offers.net",
            "recipient": SEED_USER_EMAIL,
            "date": "2026-05-08T09:30:00+00:00",
            "snippet": "Congratulations! You won a prize. Unsubscribe at bottom.",
            "body": (
                "Congratulations! You have been selected for a free iPhone. "
                "Click here now! Unsubscribe if you no longer wish to receive offers."
            ),
            "body_html": None,
        },
        {
            "gmail_message_id": "test-msg-reply-003",
            "thread_id": "test-thread-003",
            "subject": "Can we reschedule our client call?",
            "sender": "client@partner.com",
            "recipient": SEED_USER_EMAIL,
            "date": "2026-05-08T10:15:00+00:00",
            "snippet": "Need to move tomorrow's 2 PM call to Thursday.",
            "body": (
                "Hi,\n\nI need to reschedule tomorrow's 2 PM client call to Thursday afternoon. "
                "Please confirm your availability.\n\nThanks"
            ),
            "body_html": None,
        },
    ]

    @property
    def is_mock_mode(self) -> bool:
        return True

    async def fetch_unread_emails(
        self,
        limit: int = 10,
        mark_as_read: bool = True,
    ) -> list[dict[str, Any]]:
        del mark_as_read
        logger.info("[MockGmail] fetch_unread_emails(limit=%s)", limit)
        return self.MOCK_EMAILS[:limit]

    async def create_draft(
        self,
        to: str,
        subject: str,
        body: str,
        thread_id: str | None = None,
    ) -> str:
        draft_id = f"mock_draft_id_{uuid.uuid4().hex[:8]}"
        print("\n--- Mock Gmail Draft Created ---")
        print(f"  To:       {to}")
        print(f"  Subject:  {subject}")
        print(f"  Thread:   {thread_id or 'new'}")
        print(f"  Draft ID: {draft_id}")
        print(f"  Body:\n{body[:400]}{'...' if len(body) > 400 else ''}")
        print("--------------------------------\n")
        return draft_id


def print_section(title: str) -> None:
    """Print a visual separator for terminal output."""
    line = "=" * 72
    print(f"\n{line}\n  {title}\n{line}")


def init_database() -> tuple[Any, sessionmaker[Session]]:
    """Create engine, tables, and session factory for the test database."""
    print_section("B1: Initialize Database")
    engine = create_engine(TEST_DATABASE_URL, future=True)
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engine,
        class_=Session,
        future=True,
    )
    print(f"  Database URL : {TEST_DATABASE_URL}")
    print(f"  Tables       : {', '.join(Base.metadata.tables.keys())}")
    return engine, session_factory


def seed_user(db: Session) -> User:
    """Insert a sample user required by email foreign keys."""
    print_section("B2: Seed User")
    user = User(
        email=SEED_USER_EMAIL,
        display_name="Integration Test User",
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    print(f"  Created user: id={user.id}, email={user.email}")
    return user


def print_db_snapshot(db: Session, label: str) -> dict[str, int]:
    """Print row counts for core tables."""
    counts = {
        "users": db.scalar(select(func.count()).select_from(User)) or 0,
        "emails": db.scalar(select(func.count()).select_from(Email)) or 0,
        "classifications": db.scalar(select(func.count()).select_from(Classification)) or 0,
        "drafts": db.scalar(select(func.count()).select_from(Draft)) or 0,
        "audit_logs": db.scalar(select(func.count()).select_from(AuditLog)) or 0,
        "agent_runs": db.scalar(select(func.count()).select_from(AgentRun)) or 0,
        "processing_queue": db.scalar(select(func.count()).select_from(ProcessingQueue)) or 0,
    }
    print(f"\n  [{label}]")
    for table, count in counts.items():
        print(f"    {table:18s}: {count}")
    return counts


def assert_database_state(db: Session, summary: dict[str, Any]) -> None:
    """Query and print detailed records for manual acceptance."""
    print_section("B5: Database Assertions")

    expected_processed = summary.get("processed", 0)
    emails = db.scalars(select(Email).order_by(Email.created_at)).all()
    print(f"\n  emails ({len(emails)} rows, expected {expected_processed} processed):")
    for email in emails:
        print(
            f"    - {email.gmail_message_id} | processed={email.is_processed} "
            f"| subject={email.subject!r:.60}"
        )
    assert len(emails) == expected_processed, (
        f"Expected {expected_processed} processed emails in DB, got {len(emails)}"
    )

    classifications = db.scalars(select(Classification)).all()
    print(f"\n  classifications ({len(classifications)} rows):")
    for row in classifications:
        print(f"    - category={row.category} | priority={row.priority_score} | summary={row.summary!r:.80}")

    assert len(classifications) == expected_processed, (
        "Each successfully processed email should have a classification"
    )

    drafts = db.scalars(select(Draft)).all()
    print(f"\n  drafts ({len(drafts)} rows, expected >= 1 for urgent/need_reply):")
    for row in drafts:
        print(
            f"    - gmail_draft={row.draft_gmail_id} | subject={row.subject!r:.60} "
            f"| content_len={len(row.draft_content or '')}"
        )
    expected_drafts = summary.get("drafts_created", 0)
    assert len(drafts) == expected_drafts, (
        f"Expected {expected_drafts} draft(s), found {len(drafts)}"
    )

    audit_logs = db.scalars(
        select(AuditLog).order_by(AuditLog.created_at)
    ).all()
    print(f"\n  audit_logs ({len(audit_logs)} rows):")
    actions_seen: set[str] = set()
    for row in audit_logs:
        actions_seen.add(row.action or "")
        print(f"    - {row.agent_name:20s} | {row.action:18s} | {row.status}")
    required_actions = {
        "fetch_emails",
        "save_email",
        "classify_email",
        "mark_processed",
    }
    missing = required_actions - actions_seen
    assert not missing, f"Missing audit actions: {missing}"

    agent_runs = db.scalars(select(AgentRun).order_by(AgentRun.started_at)).all()
    print(f"\n  agent_runs ({len(agent_runs)} rows):")
    for run in agent_runs:
        print(
            f"    - id={run.id} | type={run.run_type} | status={run.status} "
            f"| processed={run.total_emails_processed} | total_ms={run.total_time_ms} "
            f"| llm_calls={run.llm_calls_count} | llm_ms={run.llm_total_time_ms}"
        )
    assert expected_processed >= 1, "At least one email must be processed successfully"
    assert len(agent_runs) == 1, "Expected exactly one batch agent_run record"
    batch_run = agent_runs[0]
    assert batch_run.run_type == "BATCH_PROCESSING"
    assert batch_run.status == "COMPLETED", f"Expected COMPLETED, got {batch_run.status}"
    assert batch_run.total_emails_processed == expected_processed
    assert batch_run.total_time_ms is not None and batch_run.total_time_ms > 0
    assert batch_run.started_at is not None
    assert batch_run.ended_at is not None

    print("\n  All database assertions passed.")


async def run_integration_test() -> dict[str, Any]:
    """Execute the orchestrator integration flow end-to-end."""
    if not settings.GEMINI_API_KEY:
        raise RuntimeError(
            "GEMINI_API_KEY is not set. Add it to .env before running this integration test."
        )

    engine, session_factory = init_database()
    db = session_factory()

    try:
        before_counts = print_db_snapshot(db, "BEFORE run")

        user = seed_user(db)

        print_section("B3: Mock Gmail Service Ready")
        mock_gmail = MockGmailService()
        print(f"  Mock emails prepared: {len(mock_gmail.MOCK_EMAILS)}")

        print_section("B4: Execute EmailOrchestrator")
        orchestrator = EmailOrchestrator(
            db=db,
            gmail_service=mock_gmail,  # type: ignore[arg-type]
            classifier_agent=EmailClassifierAgent(),
            response_agent=EmailResponseAgent(),
            user_id=user.id,
        )

        summary = await orchestrator.process_new_emails(limit=3)
        print("\n  Orchestrator summary:")
        for key, value in summary.items():
            print(f"    {key}: {value}")

        after_counts = print_db_snapshot(db, "AFTER run")
        print("\n  Delta:")
        for table in before_counts:
            delta = after_counts[table] - before_counts[table]
            if delta:
                print(f"    {table:18s}: +{delta}")

        if summary.get("failed", 0) > 0:
            print(
                "\n  WARNING: Some emails failed (often due to Gemini API quota). "
                "Assertions use successfully processed counts."
            )

        assert_database_state(db, summary)
        return summary

    finally:
        db.commit()
        db.close()
        engine.dispose()
        print_section("Cleanup")
        print("  Session closed and engine disposed.")


def main() -> None:
    """Entry point for the integration test script."""
    print_section("Email Orchestrator — Integration Test")
    print(f"  Project root : {PROJECT_ROOT}")
    print(f"  Gemini model : {settings.GEMINI_MODEL}")

    try:
        summary = asyncio.run(run_integration_test())
        print_section("RESULT: SUCCESS")
        print(
            f"  Processed {summary.get('processed', 0)} email(s), "
            f"drafts={summary.get('drafts_created', 0)}, "
            f"run_id={summary.get('run_id')}"
        )
    except Exception as exc:
        print_section("RESULT: FAILED")
        print(f"  Error: {exc}")
        logger.exception("Integration test failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
