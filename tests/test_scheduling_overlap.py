#!/usr/bin/env python3
"""
Unit test script for Phase 3 – Task 3: Overlap Handling Logic.

Tests _handle_scheduling() in isolation with mocked SchedulingAgent and
GoogleCalendarService.  No Gemini API calls or live DB writes are made.

Run from project root:
    python tests/test_scheduling_overlap.py
Or via pytest:
    pytest tests/test_scheduling_overlap.py -v
"""

from __future__ import annotations

import asyncio
import logging
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

# Make `backend` importable when executed directly.
_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from backend.schemas.agent_schemas import SchedulingActionSchema, SchedulingOutput
from backend.services.agents.classifier_agent import EmailClassifierAgent
from backend.services.agents.response_agent import EmailResponseAgent
from backend.services.agents.scheduling_agent import EmailSchedulingAgent
from backend.services.calendar_service import CalendarAPIError, GoogleCalendarService
from backend.services.orchestrator import EmailOrchestrator

logging.basicConfig(
    level=logging.WARNING,
    format="%(levelname)s | %(name)s | %(message)s",
)

_VN = timezone(timedelta(hours=7))

# ── Shared fixtures ───────────────────────────────────────────────────────────

_USER_ID = uuid.uuid4()
_EMAIL_ID = uuid.uuid4()

_MEETING_EMAIL: dict[str, Any] = {
    "subject": "Xin xác nhận lịch họp dự án Q3",
    "body": (
        "Chào anh/chị,\n\n"
        "Kính mời tham dự buổi họp dự án Q3 vào thứ Năm ngày 12/06/2026 lúc 14:00.\n"
        "Địa điểm: phòng họp B.\n\nTrân trọng"
    ),
    "sender": "manager@company.vn",
    "snippet": "Họp dự án Q3 — thứ Năm 14:00",
}

_START = datetime(2026, 6, 12, 14, 0, tzinfo=_VN)
_END = datetime(2026, 6, 12, 15, 0, tzinfo=_VN)

_MOCK_ACTION = SchedulingActionSchema(
    action_type="CREATE",
    start_time=_START,
    end_time=_END,
    attendees=["manager@company.vn"],
)

_MOCK_SCHEDULING_OUTPUT = SchedulingOutput(
    is_meeting_request=True,
    start_datetime=_START.isoformat(),
    end_datetime=_END.isoformat(),
    action=_MOCK_ACTION,
    event_summary="Họp dự án Q3 — phòng họp B",
    suggested_reply=(
        "Kính gửi anh/chị,\n\n"
        "Tôi xác nhận lịch họp vào 14:00 ngày 12/06/2026.\n"
        "Link Meet: {{meet_link}}\n\nTrân trọng"
    ),
)

_MOCK_ALTERNATIVES = [
    {"start": "2026-06-13T09:00:00+07:00", "end": "2026-06-13T10:00:00+07:00"},
    {"start": "2026-06-13T14:00:00+07:00", "end": "2026-06-13T15:00:00+07:00"},
    {"start": "2026-06-16T10:00:00+07:00", "end": "2026-06-16T11:00:00+07:00"},
]


# ── Builder helpers ───────────────────────────────────────────────────────────

def _mock_db() -> MagicMock:
    """Return a lightweight mock DB session that silently absorbs add() calls."""
    db = MagicMock()
    db.add = MagicMock()
    return db


def _make_orchestrator(
    scheduling_agent: EmailSchedulingAgent | None = None,
    calendar_service: GoogleCalendarService | None = None,
) -> EmailOrchestrator:
    return EmailOrchestrator(
        db=_mock_db(),
        gmail_service=None,
        classifier_agent=MagicMock(spec=EmailClassifierAgent),
        response_agent=MagicMock(spec=EmailResponseAgent),
        user_id=_USER_ID,
        scheduling_agent=scheduling_agent,
        calendar_service=calendar_service,
    )


def _mock_scheduling_agent(
    extract_output: SchedulingOutput | None = None,
    alternatives: list[dict[str, str]] | None = None,
    extract_raises: Exception | None = None,
) -> MagicMock:
    agent = MagicMock(spec=EmailSchedulingAgent)
    if extract_raises is not None:
        agent.extract_schedule = AsyncMock(side_effect=extract_raises)
    else:
        agent.extract_schedule = AsyncMock(return_value=extract_output or _MOCK_SCHEDULING_OUTPUT)
    agent.suggest_alternatives = AsyncMock(return_value=alternatives or _MOCK_ALTERNATIVES)
    return agent


def _mock_calendar_service(
    is_free: bool = True,
    raises: Exception | None = None,
) -> MagicMock:
    svc = MagicMock(spec=GoogleCalendarService)
    if raises is not None:
        svc.check_free_busy = AsyncMock(side_effect=raises)
    else:
        svc.check_free_busy = AsyncMock(return_value=is_free)
    return svc


# ── Test runner helpers ───────────────────────────────────────────────────────

_PASS = "PASS"
_FAIL = "FAIL"
_results: list[tuple[str, str, str]] = []  # (name, status, detail)


def _record(name: str, status: str, detail: str = "") -> None:
    _results.append((name, status, detail))
    marker = "✓" if status == _PASS else "✗"
    line = f"  [{marker}] {name}"
    if detail:
        line += f"\n       {detail}"
    print(line)


def _assert(name: str, condition: bool, detail: str = "") -> None:
    _record(name, _PASS if condition else _FAIL, detail)


# ── Individual test cases ─────────────────────────────────────────────────────

async def test_no_agents_configured() -> None:
    """When scheduling_agent or calendar_service is None, return None immediately."""
    orch = _make_orchestrator(scheduling_agent=None, calendar_service=None)
    result = await orch._handle_scheduling(_MEETING_EMAIL, _EMAIL_ID, _USER_ID)
    _assert("no_agents → None", result is None)


async def test_free_slot() -> None:
    """Free slot: return status=scheduled with a valid CREATE payload."""
    agent = _mock_scheduling_agent()
    calendar = _mock_calendar_service(is_free=True)
    orch = _make_orchestrator(scheduling_agent=agent, calendar_service=calendar)

    result = await orch._handle_scheduling(_MEETING_EMAIL, _EMAIL_ID, _USER_ID)

    _assert("free_slot: result is not None", result is not None)
    if result is None:
        return

    _assert("free_slot: status=scheduled", result.get("status") == "scheduled")

    payload = result.get("payload", {})
    _assert(
        "free_slot: payload.summary",
        payload.get("summary") == "Họp dự án Q3 — phòng họp B",
        f"got: {payload.get('summary')!r}",
    )
    _assert(
        "free_slot: payload.start_time",
        payload.get("start_time") == _START.isoformat(),
        f"got: {payload.get('start_time')!r}",
    )
    _assert(
        "free_slot: payload.end_time",
        payload.get("end_time") == _END.isoformat(),
        f"got: {payload.get('end_time')!r}",
    )
    _assert(
        "free_slot: payload.attendees",
        payload.get("attendees") == ["manager@company.vn"],
        f"got: {payload.get('attendees')!r}",
    )
    _assert(
        "free_slot: payload.description set",
        bool(payload.get("description")),
    )

    # Verify the correct args were forwarded to check_free_busy.
    calendar.check_free_busy.assert_called_once_with(_START, _END)


async def test_busy_slot_returns_alternatives() -> None:
    """Busy slot: call suggest_alternatives and return status=conflict."""
    agent = _mock_scheduling_agent(alternatives=_MOCK_ALTERNATIVES)
    calendar = _mock_calendar_service(is_free=False)
    orch = _make_orchestrator(scheduling_agent=agent, calendar_service=calendar)

    result = await orch._handle_scheduling(_MEETING_EMAIL, _EMAIL_ID, _USER_ID)

    _assert("busy_slot: result is not None", result is not None)
    if result is None:
        return

    _assert("busy_slot: status=conflict", result.get("status") == "conflict")
    alternatives = result.get("alternatives", [])
    _assert("busy_slot: 3 alternatives returned", len(alternatives) == 3, f"got {len(alternatives)}")
    _assert(
        "busy_slot: each alternative has start+end",
        all("start" in s and "end" in s for s in alternatives),
    )

    # Verify suggest_alternatives was called with the conflicting slot.
    agent.suggest_alternatives.assert_called_once()
    call_kwargs = agent.suggest_alternatives.call_args
    _assert(
        "busy_slot: suggest_alternatives(busy_start=_START)",
        call_kwargs.kwargs.get("busy_start") == _START or call_kwargs.args[2:3] == (_START,),
        f"call: {call_kwargs}",
    )


async def test_not_a_meeting_request() -> None:
    """Non-meeting email: extract_schedule returns is_meeting_request=False → None."""
    non_meeting = SchedulingOutput(
        is_meeting_request=False,
        start_datetime=None,
        end_datetime=None,
        action=None,
        event_summary=None,
        suggested_reply="",
    )
    agent = _mock_scheduling_agent(extract_output=non_meeting)
    calendar = _mock_calendar_service(is_free=True)
    orch = _make_orchestrator(scheduling_agent=agent, calendar_service=calendar)

    result = await orch._handle_scheduling(_MEETING_EMAIL, _EMAIL_ID, _USER_ID)

    _assert("not_meeting: result is None", result is None)
    calendar.check_free_busy.assert_not_called()


async def test_meeting_request_without_action() -> None:
    """Meeting request where LLM set action=None despite having datetimes: return None, skip calendar."""
    # start/end must be non-null to pass SchedulingOutput.validate_meeting_fields;
    # action=None simulates the edge case where post-processing failed to derive it.
    output_no_action = SchedulingOutput(
        is_meeting_request=True,
        start_datetime="2026-06-15T10:00:00+07:00",
        end_datetime="2026-06-15T11:00:00+07:00",
        action=None,
        event_summary="Họp trao đổi kế hoạch",
        suggested_reply="Vui lòng cho biết thời gian phù hợp để tôi sắp xếp.",
    )
    agent = _mock_scheduling_agent(extract_output=output_no_action)
    calendar = _mock_calendar_service(is_free=True)
    orch = _make_orchestrator(scheduling_agent=agent, calendar_service=calendar)

    result = await orch._handle_scheduling(_MEETING_EMAIL, _EMAIL_ID, _USER_ID)

    _assert("no_action: result is None", result is None)
    calendar.check_free_busy.assert_not_called()


async def test_calendar_api_error() -> None:
    """CalendarAPIError during free/busy check → status=calendar_error."""
    agent = _mock_scheduling_agent()
    calendar = _mock_calendar_service(raises=CalendarAPIError("quota exceeded", status_code=429))
    orch = _make_orchestrator(scheduling_agent=agent, calendar_service=calendar)

    result = await orch._handle_scheduling(_MEETING_EMAIL, _EMAIL_ID, _USER_ID)

    _assert("api_error: result is not None", result is not None)
    if result is None:
        return

    _assert("api_error: status=calendar_error", result.get("status") == "calendar_error")
    _assert(
        "api_error: error message present",
        "quota exceeded" in result.get("error", ""),
        f"got: {result.get('error')!r}",
    )
    # Alternatives should not be requested when the API itself failed.
    agent.suggest_alternatives.assert_not_called()


async def test_calendar_timeout() -> None:
    """asyncio.TimeoutError from free/busy check → status=timeout."""
    agent = _mock_scheduling_agent()
    calendar = _mock_calendar_service(raises=asyncio.TimeoutError())
    orch = _make_orchestrator(scheduling_agent=agent, calendar_service=calendar)

    result = await orch._handle_scheduling(_MEETING_EMAIL, _EMAIL_ID, _USER_ID)

    _assert("timeout: result is not None", result is not None)
    if result is None:
        return

    _assert("timeout: status=timeout", result.get("status") == "timeout")
    agent.suggest_alternatives.assert_not_called()


async def test_extract_fails_gracefully() -> None:
    """Exception in extract_schedule → None (scheduling step is skipped silently)."""
    agent = _mock_scheduling_agent(extract_raises=RuntimeError("Gemini unavailable"))
    calendar = _mock_calendar_service(is_free=True)
    orch = _make_orchestrator(scheduling_agent=agent, calendar_service=calendar)

    result = await orch._handle_scheduling(_MEETING_EMAIL, _EMAIL_ID, _USER_ID)

    _assert("extract_fail: result is None", result is None)
    calendar.check_free_busy.assert_not_called()


async def test_busy_slot_alternatives_empty_on_failure() -> None:
    """When suggest_alternatives fails, conflict is still returned with empty alternatives."""
    agent = _mock_scheduling_agent()
    agent.suggest_alternatives = AsyncMock(side_effect=RuntimeError("LLM error"))
    calendar = _mock_calendar_service(is_free=False)
    orch = _make_orchestrator(scheduling_agent=agent, calendar_service=calendar)

    result = await orch._handle_scheduling(_MEETING_EMAIL, _EMAIL_ID, _USER_ID)

    _assert("alts_fail: status=conflict", result is not None and result.get("status") == "conflict")
    _assert(
        "alts_fail: alternatives=[]",
        result is not None and result.get("alternatives") == [],
        f"got: {result.get('alternatives') if result else 'N/A'}",
    )


# ── Entry point ───────────────────────────────────────────────────────────────

_ALL_TESTS = [
    ("no_agents_configured", test_no_agents_configured),
    ("free_slot", test_free_slot),
    ("busy_slot_returns_alternatives", test_busy_slot_returns_alternatives),
    ("not_a_meeting_request", test_not_a_meeting_request),
    ("meeting_request_without_action", test_meeting_request_without_action),
    ("calendar_api_error", test_calendar_api_error),
    ("calendar_timeout", test_calendar_timeout),
    ("extract_fails_gracefully", test_extract_fails_gracefully),
    ("busy_slot_alternatives_empty_on_failure", test_busy_slot_alternatives_empty_on_failure),
]


def _separator(title: str) -> None:
    bar = "=" * 68
    print(f"\n{bar}\n  {title}\n{bar}")


async def run_all() -> int:
    _separator("Scheduling Overlap — Unit Tests")
    print()

    for name, fn in _ALL_TESTS:
        print(f"  ── {name}")
        try:
            await fn()
        except Exception as exc:
            _record(name, _FAIL, f"unhandled exception: {exc}")

    # Summary
    passed = sum(1 for _, s, _ in _results if s == _PASS)
    failed = sum(1 for _, s, _ in _results if s == _FAIL)
    _separator(f"Result: {passed} passed, {failed} failed")

    if failed:
        print("\n  Failed cases:")
        for name, status, detail in _results:
            if status == _FAIL:
                print(f"    ✗ {name}" + (f": {detail}" if detail else ""))

    return failed


# ── pytest-compatible wrappers (collected automatically by pytest) ────────────

def test_no_agents_configured_pytest() -> None:
    asyncio.run(test_no_agents_configured())
    fails = [r for r in _results if r[0].startswith("no_agents") and r[1] == _FAIL]
    assert not fails, fails

def test_free_slot_pytest() -> None:
    asyncio.run(test_free_slot())
    fails = [r for r in _results if r[0].startswith("free_slot") and r[1] == _FAIL]
    assert not fails, fails

def test_busy_slot_pytest() -> None:
    asyncio.run(test_busy_slot_returns_alternatives())
    fails = [r for r in _results if r[0].startswith("busy_slot:") and r[1] == _FAIL]
    assert not fails, fails

def test_not_meeting_pytest() -> None:
    asyncio.run(test_not_a_meeting_request())
    fails = [r for r in _results if r[0].startswith("not_meeting") and r[1] == _FAIL]
    assert not fails, fails

def test_no_action_pytest() -> None:
    asyncio.run(test_meeting_request_without_action())
    fails = [r for r in _results if r[0].startswith("no_action") and r[1] == _FAIL]
    assert not fails, fails

def test_api_error_pytest() -> None:
    asyncio.run(test_calendar_api_error())
    fails = [r for r in _results if r[0].startswith("api_error") and r[1] == _FAIL]
    assert not fails, fails

def test_timeout_pytest() -> None:
    asyncio.run(test_calendar_timeout())
    fails = [r for r in _results if r[0].startswith("timeout") and r[1] == _FAIL]
    assert not fails, fails

def test_extract_fails_pytest() -> None:
    asyncio.run(test_extract_fails_gracefully())
    fails = [r for r in _results if r[0].startswith("extract_fail") and r[1] == _FAIL]
    assert not fails, fails

def test_alts_fail_pytest() -> None:
    asyncio.run(test_busy_slot_alternatives_empty_on_failure())
    fails = [r for r in _results if r[0].startswith("alts_fail") and r[1] == _FAIL]
    assert not fails, fails


def main() -> None:
    failed = asyncio.run(run_all())
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
