"""Persistence helpers for email scheduling rows with duplicate detection."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models.email_scheduling import EmailScheduling
from backend.schemas.api_schemas import ScheduleEventResponse

_VN = timezone(timedelta(hours=7))


def _to_vn_iso(dt: datetime | None) -> str:
    if dt is None:
        return ""
    return dt.astimezone(_VN).isoformat()


def row_to_response(row: EmailScheduling, alternative_slots: list[str] | None = None) -> ScheduleEventResponse:
    """Map a DB row to the frontend ``ScheduleEvent`` shape."""
    return ScheduleEventResponse(
        id=str(row.id),
        title=row.event_title or "(Không có tiêu đề)",
        startTime=_to_vn_iso(row.start_datetime),
        endTime=_to_vn_iso(row.end_datetime),
        attendees=row.attendees,
        status=row.status,
        emailSnippet=row.event_title or "",
        alternativeSlots=alternative_slots or [],
        html_link=row.google_calendar_html_link,
        meet_link=row.google_meet_link,
        is_synced=bool(row.google_calendar_event_id),
    )


def find_existing_scheduling(
    db: Session,
    user_id: uuid.UUID,
    *,
    gmail_message_id: str | None,
    start_datetime: datetime | None,
    end_datetime: datetime | None,
) -> EmailScheduling | None:
    """
    Locate an existing scheduling row to update instead of inserting a duplicate.

    Priority:
    1. Same ``gmail_message_id`` for the user.
    2. Same ``start_datetime`` + ``end_datetime`` (non-cancelled rows only).
    """
    if gmail_message_id:
        row = db.scalar(
            select(EmailScheduling).where(
                EmailScheduling.user_id == user_id,
                EmailScheduling.gmail_message_id == gmail_message_id,
            )
        )
        if row is not None:
            return row

    if start_datetime is None or end_datetime is None:
        return None

    return db.scalar(
        select(EmailScheduling)
        .where(
            EmailScheduling.user_id == user_id,
            EmailScheduling.start_datetime == start_datetime,
            EmailScheduling.end_datetime == end_datetime,
            EmailScheduling.status != "CANCELLED",
        )
        .order_by(EmailScheduling.created_at.desc())
        .limit(1)
    )


def upsert_scheduling_from_extraction(
    db: Session,
    user_id: uuid.UUID,
    *,
    gmail_message_id: str | None,
    event_title: str | None,
    start_datetime: datetime,
    end_datetime: datetime,
    attendees: list[str],
    suggested_reply: str | None,
    status: str = "PENDING",
    alternative_slots: list[str] | None = None,
) -> EmailScheduling:
    """Create or update a scheduling row; never insert a duplicate slot."""
    now = datetime.now(timezone.utc)
    row = find_existing_scheduling(
        db,
        user_id,
        gmail_message_id=gmail_message_id,
        start_datetime=start_datetime,
        end_datetime=end_datetime,
    )

    if row is None:
        row = EmailScheduling(
            user_id=user_id,
            gmail_message_id=gmail_message_id,
            event_title=event_title,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            attendees_json=json.dumps(attendees),
            suggested_reply=suggested_reply,
            status=status,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
    else:
        if gmail_message_id:
            row.gmail_message_id = gmail_message_id
        row.event_title = event_title
        row.start_datetime = start_datetime
        row.end_datetime = end_datetime
        row.attendees_json = json.dumps(attendees)
        row.suggested_reply = suggested_reply
        if row.status == "CANCELLED":
            row.status = status
            row.google_calendar_event_id = None
            row.google_calendar_html_link = None
            row.google_meet_link = None
        elif status == "CONFLICT" and row.status == "PENDING":
            row.status = "CONFLICT"
        row.updated_at = now

    db.flush()
    return row


def get_user_scheduling(
    db: Session,
    user_id: uuid.UUID,
    scheduling_id: uuid.UUID,
) -> EmailScheduling | None:
    row = db.get(EmailScheduling, scheduling_id)
    if row is None or row.user_id != user_id:
        return None
    return row
