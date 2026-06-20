"""Unit tests for the security_blocked guard in _handle_scheduling."""
from __future__ import annotations

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.services.orchestrator import EmailOrchestrator
from backend.schemas.agent_schemas import (
    EmailCategory,
    EmailClassificationOutput,
    SchedulingActionSchema,
    SchedulingOutput,
    SecurityAnalysisOutput,
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _sec(risk_level: str, is_safe: bool) -> SecurityAnalysisOutput:
    return SecurityAnalysisOutput(
        is_safe=is_safe,
        risk_level=risk_level,
        warnings=["phishing detected"] if not is_safe else [],
    )


def _mock_db() -> MagicMock:
    db = MagicMock()
    db.scalars.return_value.all.return_value = []   # no user EmailRules
    return db


def _make_orchestrator(security_result: SecurityAnalysisOutput) -> tuple[EmailOrchestrator, MagicMock]:
    """Minimal orchestrator with all LLM agents mocked."""
    classifier = MagicMock()
    classifier.classify = AsyncMock(return_value=EmailClassificationOutput(
        category=EmailCategory.IMPORTANT,
        priority_score=3,
        summary="test summary",
        deadline=None,
        confidence=0.9,
    ))

    scheduling_mock = MagicMock()
    scheduling_mock.extract_schedule = AsyncMock(return_value=SchedulingOutput(
        is_meeting_request=True,
        start_datetime="2026-06-20T14:00:00+07:00",
        end_datetime="2026-06-20T15:00:00+07:00",
        action=None,
        event_summary="Team sync",
        suggested_reply="Confirmed for 2pm.",
    ))

    security = MagicMock()
    security.analyze = AsyncMock(return_value=security_result)

    calendar = MagicMock()
    calendar.get_free_slots = AsyncMock(return_value=[])

    orc = EmailOrchestrator(
        db=_mock_db(),
        gmail_service=None,
        classifier_agent=classifier,
        response_agent=MagicMock(),
        security_agent=security,
        scheduling_agent=scheduling_mock,
        calendar_service=calendar,
        user_id=uuid.uuid4(),
        raw_emails=[{
            "gmail_message_id": "msg-test-001",
            "subject": "Team sync tomorrow 2pm?",
            "sender": "boss@company.com",
            "body": "Can we meet tomorrow at 2pm for a team sync?",
            "snippet": "Can we meet tomorrow at 2pm?",
        }],
    )
    return orc, scheduling_mock


# ── direct unit tests for _handle_scheduling ─────────────────────────────────

class TestHandleSchedulingDirect:
    """Test the guard parameter directly — no full pipeline, no DB writes."""

    def test_security_blocked_returns_none_without_calling_agent(self):
        """security_blocked=True → return None immediately, SchedulingAgent never invoked."""
        scheduling = MagicMock()
        scheduling.extract_schedule = AsyncMock()

        orc = EmailOrchestrator(
            db=_mock_db(),
            gmail_service=None,
            classifier_agent=MagicMock(),
            response_agent=MagicMock(),
            scheduling_agent=scheduling,
            calendar_service=MagicMock(),
            user_id=uuid.uuid4(),
        )

        result = asyncio.run(orc._handle_scheduling(
            raw_email={
                "subject": "Meet tomorrow",
                "body": "2pm works?",
                "sender": "a@b.com",
                "gmail_message_id": "x1",
            },
            user_id=uuid.uuid4(),
            security_blocked=True,
        ))

        assert result is None
        scheduling.extract_schedule.assert_not_called()

    def test_not_blocked_calls_agent_when_not_meeting(self):
        """security_blocked=False → agent is called; returns None when is_meeting_request=False."""
        scheduling = MagicMock()
        scheduling.extract_schedule = AsyncMock(return_value=SchedulingOutput(
            is_meeting_request=False,
            start_datetime=None,
            end_datetime=None,
            action=None,
            event_summary=None,
            suggested_reply="",
        ))

        orc = EmailOrchestrator(
            db=_mock_db(),
            gmail_service=None,
            classifier_agent=MagicMock(),
            response_agent=MagicMock(),
            scheduling_agent=scheduling,
            calendar_service=MagicMock(),
            user_id=uuid.uuid4(),
        )

        result = asyncio.run(orc._handle_scheduling(
            raw_email={
                "subject": "Hello",
                "body": "Just saying hi",
                "sender": "a@b.com",
                "gmail_message_id": "x2",
            },
            user_id=uuid.uuid4(),
            security_blocked=False,
        ))

        scheduling.extract_schedule.assert_called_once()
        assert result is None  # is_meeting_request=False → guard inside _handle_scheduling returns None


# ── pipeline-level tests ──────────────────────────────────────────────────────

class TestSchedulingGuardPipeline:
    """Verify guard behaviour from process_new_emails perspective."""

    @pytest.mark.anyio
    @patch("backend.services.orchestrator.manager")
    @patch("backend.services.orchestrator.EmailResponseAgent.is_eligible", return_value=False)
    async def test_high_risk_skips_scheduling_and_no_exception(self, _mock_eligible, mock_manager):
        """
        risk=high → security_blocked=True.
        Guard must: skip SchedulingAgent, not raise any exception in Audit/broadcast,
        and llm_calls_count must be 0 (classify + draft both skipped).
        """
        mock_manager.broadcast = AsyncMock()
        orc, scheduling_mock = _make_orchestrator(_sec("high", False))

        summary = await orc.process_new_emails()

        # Guard fired: SchedulingAgent never called
        scheduling_mock.extract_schedule.assert_not_called()
        assert summary["scheduled_events"] == []

        # No crash (failed==0 means no exception escaped to the per-email handler)
        assert summary["failed"] == 0, f"Unexpected failure: {summary['errors']}"

        # llm_calls_count: classify skipped (SPAM override) + draft skipped (skip_draft=True) → 0
        assert summary["llm_calls_count"] == 0

        # broadcast was called (SECURITY_ALERT fires before scheduling)
        mock_manager.broadcast.assert_awaited()

    @pytest.mark.anyio
    @patch("backend.services.orchestrator.manager")
    @patch("backend.services.orchestrator.EmailResponseAgent.is_eligible", return_value=False)
    async def test_low_risk_safe_runs_scheduling(self, _mock_eligible, mock_manager):
        """
        risk=low + is_safe=True → security_blocked=False → SchedulingAgent called.
        Guard must NOT block this path.
        """
        mock_manager.broadcast = AsyncMock()
        orc, scheduling_mock = _make_orchestrator(_sec("low", True))

        await orc.process_new_emails()

        scheduling_mock.extract_schedule.assert_called_once()

    @pytest.mark.anyio
    @patch("backend.services.orchestrator.manager")
    @patch("backend.services.orchestrator.EmailResponseAgent.is_eligible", return_value=False)
    async def test_medium_safe_runs_scheduling(self, _mock_eligible, mock_manager):
        """
        risk=medium + is_safe=True → security_blocked=False → SchedulingAgent still runs.
        Medium-risk emails that pass the is_safe check are not blocked.
        """
        mock_manager.broadcast = AsyncMock()
        orc, scheduling_mock = _make_orchestrator(_sec("medium", True))

        await orc.process_new_emails()

        scheduling_mock.extract_schedule.assert_called_once()

    @pytest.mark.anyio
    @patch("backend.services.orchestrator.manager")
    @patch("backend.services.orchestrator.EmailResponseAgent.is_eligible", return_value=False)
    async def test_medium_unsafe_skips_scheduling(self, _mock_eligible, mock_manager):
        """
        risk=medium + is_safe=False → security_blocked=True (via is_safe branch) → skips Scheduling.
        This is the edge case: medium risk but SecurityAgent explicitly sets is_safe=False.
        """
        mock_manager.broadcast = AsyncMock()
        orc, scheduling_mock = _make_orchestrator(_sec("medium", False))

        summary = await orc.process_new_emails()

        scheduling_mock.extract_schedule.assert_not_called()
        assert summary["scheduled_events"] == []
        assert summary["failed"] == 0
