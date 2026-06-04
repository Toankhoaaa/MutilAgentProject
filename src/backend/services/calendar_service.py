"""Google Calendar API integration for availability checks and event creation."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2 import credentials as oauth2_credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

logger = logging.getLogger(__name__)

CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar"

# Vietnam Standard Time (no DST — always UTC+7).
_VN_TZ = "Asia/Ho_Chi_Minh"
_VN_OFFSET = timezone(timedelta(hours=7))


def _to_rfc3339(dt: datetime) -> str:
    """Return dt as RFC 3339 string with +07:00 offset; naive datetimes assumed VN time."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_VN_OFFSET)
    else:
        dt = dt.astimezone(_VN_OFFSET)
    return dt.isoformat()


class CalendarServiceError(Exception):
    """Base exception for Google Calendar service failures."""


class CalendarAuthenticationError(CalendarServiceError):
    """Raised when Calendar credentials cannot be loaded or refreshed."""


class CalendarAPIError(CalendarServiceError):
    """Raised when the Calendar API returns an error response."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class GoogleCalendarService:
    """
    Async-friendly Google Calendar API wrapper.

    Uses the same ``google.oauth2.credentials.Credentials`` object as
    ``GmailService`` — a single OAuth consent covers both scopes as long
    as the ``calendar`` scope was requested at login.
    """

    def __init__(self, credentials: oauth2_credentials.Credentials) -> None:
        """
        Args:
            credentials: Google OAuth2 user credentials that include the
                ``https://www.googleapis.com/auth/calendar`` scope.
        """
        self._credentials = credentials
        self._service: Any | None = None

    # ── Internal helpers ──────────────────────────────────────────────────

    def _build_service(self) -> Any:
        """Build the Calendar API v3 service client (blocking, call via thread)."""
        if self._credentials.expired and self._credentials.refresh_token:
            try:
                self._credentials.refresh(Request())
            except Exception as exc:
                raise CalendarAuthenticationError(
                    "Google Calendar token expired and refresh failed. Please sign in again."
                ) from exc

        try:
            service = build(
                "calendar",
                "v3",
                credentials=self._credentials,
                cache_discovery=False,
            )
        except Exception as exc:
            raise CalendarAuthenticationError(
                f"Failed to build Google Calendar client: {exc}"
            ) from exc

        self._service = service
        return service

    async def _get_service(self) -> Any:
        """Return a cached Calendar service, building it on first use."""
        if self._service is None:
            self._service = await asyncio.to_thread(self._build_service)
        return self._service

    @staticmethod
    def _wrap_http_error(exc: HttpError, context: str) -> CalendarAPIError:
        """Convert a googleapiclient ``HttpError`` into a domain exception."""
        status_code = getattr(exc.resp, "status", None)
        message = f"{context} Calendar API error ({status_code}): {exc}"
        logger.error(message)
        return CalendarAPIError(message, status_code=status_code)

    # ── Public API ────────────────────────────────────────────────────────

    async def check_availability(self, start_time: str, end_time: str) -> bool:
        """
        Check whether the authenticated user is free in the given time window.

        Uses the ``calendar.freebusy.query`` API — returns ``True`` when there
        are no conflicting events on the primary calendar.

        Args:
            start_time: ISO 8601 string with timezone, e.g. ``2026-05-29T14:00:00+07:00``.
            end_time:   ISO 8601 string with timezone, e.g. ``2026-05-29T15:00:00+07:00``.

        Returns:
            ``True`` when the user is free; ``False`` when at least one
            existing event overlaps the requested window.

        Raises:
            CalendarAPIError: When the Freebusy API call fails.
        """
        service = await self._get_service()

        body = {
            "timeMin": start_time,
            "timeMax": end_time,
            "timeZone": _VN_TZ,
            "items": [{"id": "primary"}],
        }

        try:
            response: dict[str, Any] = await asyncio.to_thread(
                lambda: service.freebusy().query(body=body).execute()
            )
        except HttpError as exc:
            raise self._wrap_http_error(exc, "Freebusy query failed.") from exc

        busy_slots: list[dict[str, str]] = (
            response.get("calendars", {})
            .get("primary", {})
            .get("busy", [])
        )
        is_free = len(busy_slots) == 0
        if not is_free:
            logger.info(
                "User has %d conflicting event(s) between %s and %s",
                len(busy_slots),
                start_time,
                end_time,
            )
        return is_free

    async def check_free_busy(self, start_time: datetime, end_time: datetime) -> bool:
        """
        Check whether the authenticated user is free in the given time window.

        Typed variant of :meth:`check_availability` that accepts ``datetime``
        objects instead of raw strings.  Naive datetimes are treated as
        ``Asia/Ho_Chi_Minh`` (+07:00); aware datetimes are converted to that
        timezone before the API call.

        Args:
            start_time: Meeting start (timezone-naive or aware).
            end_time:   Meeting end (timezone-naive or aware).

        Returns:
            ``True`` when the user is free; ``False`` when at least one
            existing event overlaps the requested window.

        Raises:
            ValueError: When ``start_time`` is not strictly before ``end_time``.
            CalendarAPIError: When the Freebusy API call fails.
        """
        if start_time >= end_time:
            raise ValueError(
                f"start_time must be before end_time: {start_time!r} >= {end_time!r}"
            )
        return await self.check_availability(_to_rfc3339(start_time), _to_rfc3339(end_time))

    async def create_event(
        self,
        summary: str,
        start_time: str,
        end_time: str,
        attendees: list[str] | None = None,
        description: str | None = None,
        location: str | None = None,
    ) -> dict[str, Any]:
        """
        Create a Google Calendar event with an auto-generated Google Meet link.

        Args:
            summary:    Event title shown in Google Calendar.
            start_time: ISO 8601 string with timezone (e.g. ``2026-05-29T14:00:00+07:00``).
            end_time:   ISO 8601 string with timezone.
            attendees:  Optional list of attendee email addresses.
            description: Optional plain-text event description.
            location:   Optional location string.

        Returns:
            Dict containing at minimum:
            - ``event_id``: Google Calendar event ID.
            - ``html_link``: URL to open the event in Google Calendar.
            - ``meet_link``: Google Meet video conference URL (or ``None``).

        Raises:
            CalendarAPIError: When the Calendar API insert call fails.
        """
        service = await self._get_service()

        event_body: dict[str, Any] = {
            "summary": summary,
            "start": {
                "dateTime": start_time,
                "timeZone": _VN_TZ,
            },
            "end": {
                "dateTime": end_time,
                "timeZone": _VN_TZ,
            },
            # Request a new Google Meet conference link.
            "conferenceData": {
                "createRequest": {
                    "requestId": str(uuid.uuid4()),
                    "conferenceSolutionKey": {"type": "hangoutsMeet"},
                }
            },
        }

        if description:
            event_body["description"] = description

        if location:
            event_body["location"] = location

        if attendees:
            event_body["attendees"] = [{"email": addr} for addr in attendees]

        try:
            # conferenceDataVersion=1 triggers Meet link generation.
            created: dict[str, Any] = await asyncio.to_thread(
                lambda: service.events()
                .insert(
                    calendarId="primary",
                    body=event_body,
                    conferenceDataVersion=1,
                    sendUpdates="all",  # notify all attendees via email
                )
                .execute()
            )
        except HttpError as exc:
            raise self._wrap_http_error(exc, "Failed to create Calendar event.") from exc

        meet_link: str | None = None
        conference_data = created.get("conferenceData", {})
        entry_points: list[dict[str, str]] = conference_data.get("entryPoints", [])
        for ep in entry_points:
            if ep.get("entryPointType") == "video":
                meet_link = ep.get("uri")
                break

        logger.info(
            "Created Calendar event '%s' (%s): html_link=%s  meet=%s",
            summary,
            created.get("id"),
            created.get("htmlLink"),
            meet_link,
        )

        return {
            "event_id": created.get("id"),
            "html_link": created.get("htmlLink"),
            "meet_link": meet_link,
            "status": created.get("status"),
            "created": created.get("created"),
            "start": created.get("start"),
            "end": created.get("end"),
        }
