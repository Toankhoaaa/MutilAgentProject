"""Unit tests for scheduling deduplication helpers."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from backend.models.email_scheduling import EmailScheduling
from backend.services.scheduling_service import find_existing_scheduling, upsert_scheduling_from_extraction

_VN = timezone(timedelta(hours=7))
_START = datetime(2026, 6, 12, 14, 0, tzinfo=_VN)
_END = datetime(2026, 6, 12, 15, 0, tzinfo=_VN)
_USER = uuid.uuid4()


def _mock_db_with_row(row: EmailScheduling | None) -> MagicMock:
    db = MagicMock()
    db.scalar.return_value = row
    return db


def test_find_existing_by_gmail_message_id():
    existing = EmailScheduling(user_id=_USER, gmail_message_id="msg-1")
    db = _mock_db_with_row(existing)

    found = find_existing_scheduling(
        db,
        _USER,
        gmail_message_id="msg-1",
        start_datetime=_START,
        end_datetime=_END,
    )

    assert found is existing
    db.scalar.assert_called_once()


def test_upsert_updates_same_time_slot_instead_of_insert():
    existing = EmailScheduling(
        user_id=_USER,
        gmail_message_id="msg-old",
        event_title="Old title",
        start_datetime=_START,
        end_datetime=_END,
        status="PENDING",
    )
    db = MagicMock()
    db.scalar.side_effect = [None, existing]

    row = upsert_scheduling_from_extraction(
        db,
        _USER,
        gmail_message_id="msg-new",
        event_title="Updated title",
        start_datetime=_START,
        end_datetime=_END,
        attendees=["a@b.com"],
        suggested_reply="ok",
    )

    assert row is existing
    assert row.event_title == "Updated title"
    assert row.gmail_message_id == "msg-new"
    db.add.assert_not_called()
