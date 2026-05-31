"""FastAPI router for email orchestration, draft updates, and send."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.auth_dependencies import get_current_user
from backend.api.dependencies import (
    get_classifier_agent,
    get_db,
    get_gmail_service,
    get_response_agent,
)
from backend.models.draft import Draft
from backend.models.email_scheduling import EmailScheduling
from backend.models.user import User
from backend.schemas.api_schemas import (
    CreateEventResponse,
    DraftResponse,
    DraftSendResponse,
    DraftUpdateSchema,
    ProcessEmailsResponse,
)
from backend.services.agents import (
    EmailClassifierAgent,
    EmailResponseAgent,
)
from backend.services.calendar_service import (
    CalendarAPIError,
    CalendarAuthenticationError,
    GoogleCalendarService,
)
from backend.services.gmail_service import (
    GmailAuthenticationError,
    GmailService,
    google_credentials_from_token_json,
)
from backend.services.orchestrator import EmailOrchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/emails", tags=["Emails"])


@router.post(
    "/process",
    response_model=ProcessEmailsResponse,
    summary="Process new emails",
    description=(
        "Fetches unread messages from Gmail, runs classification "
        "and optional reply drafting through ``EmailOrchestrator``, and persists results."
    ),
)
async def process_emails(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    classifier_agent: EmailClassifierAgent = Depends(get_classifier_agent),
    response_agent: EmailResponseAgent = Depends(get_response_agent),
) -> ProcessEmailsResponse:
    """Trigger a batch run that ingests unread mail and runs the multi-agent pipeline."""
    if not current_user.google_oauth_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Google OAuth token missing. Please sign in with Google again.",
        )

    try:
        creds = google_credentials_from_token_json(current_user.google_oauth_token)
    except GmailAuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc

    gmail_service = GmailService(credentials=creds)
    raw_emails = await gmail_service.fetch_unread_emails(limit=5)

    orchestrator = EmailOrchestrator(
        db=db,
        gmail_service=gmail_service,
        classifier_agent=classifier_agent,
        response_agent=response_agent,
        user_id=current_user.id,
        raw_emails=raw_emails,
    )

    result = await orchestrator.process_new_emails(limit=5)

    refreshed_token = gmail_service.credentials_to_json()
    if refreshed_token != current_user.google_oauth_token:
        current_user.google_oauth_token = refreshed_token
        db.commit()

    return ProcessEmailsResponse.model_validate(result)


@router.put(
    "/{email_id}/draft",
    response_model=DraftResponse,
    summary="Update draft content",
    description="Updates the stored reply draft body for the given email id (manual edit).",
)
def update_draft(
    email_id: UUID,
    payload: DraftUpdateSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DraftResponse:
    """Replace ``draft_content`` on the draft linked to ``email_id`` and mark as modified."""
    draft = db.scalar(select(Draft).where(Draft.email_id == email_id))
    if draft is None:
        raise HTTPException(status_code=404, detail="No draft exists for this email.")

    draft.draft_content = payload.draft_content
    draft.is_modified = True
    db.commit()
    db.refresh(draft)

    return DraftResponse.model_validate(draft)


@router.post(
    "/{email_id}/send",
    response_model=DraftSendResponse,
    summary="Send Gmail draft",
    description="Sends the Gmail draft identified by ``draft_gmail_id`` on the stored draft row.",
)
async def send_draft(
    email_id: UUID,
    db: Session = Depends(get_db),
    gmail_service: GmailService = Depends(get_gmail_service),
    current_user: User = Depends(get_current_user),
) -> DraftSendResponse:
    """Send the reply draft through Gmail and mark the local draft as sent."""
    draft = db.scalar(select(Draft).where(Draft.email_id == email_id))
    if draft is None:
        raise HTTPException(status_code=404, detail="No draft exists for this email.")

    if not draft.draft_gmail_id:
        raise HTTPException(
            status_code=400,
            detail="Draft has no Gmail draft id; create a draft via the orchestrator first.",
        )

    try:
        sent = await gmail_service.send_draft(draft.draft_gmail_id)
    except Exception as exc:
        logger.exception("Gmail send failed for email %s: %s", email_id, exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    draft.is_sent = True
    draft.sent_at = datetime.now(timezone.utc)
    db.commit()

    return DraftSendResponse(
        message="Draft sent successfully.",
        gmail_message_id=sent.get("id"),
        gmail_thread_id=sent.get("threadId"),
    )


@router.post(
    "/{email_id}/create-event",
    response_model=CreateEventResponse,
    summary="Create Google Calendar event from scheduling data",
    description=(
        "Creates a Google Calendar event with a Google Meet link from stored scheduling data, "
        "then sends the reply draft if one exists."
    ),
)
async def create_calendar_event(
    email_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    gmail_service: GmailService = Depends(get_gmail_service),
) -> CreateEventResponse:
    """Create a Calendar event using the scheduling data stored for the email."""
    scheduling = db.scalar(
        select(EmailScheduling).where(EmailScheduling.email_id == email_id)
    )
    if scheduling is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No scheduling data found. Call POST /schedule first.",
        )
    if not scheduling.is_meeting_request:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This email was not classified as a meeting request.",
        )
    if not scheduling.start_datetime or not scheduling.end_datetime:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Scheduling data is missing exact datetimes. "
                "The AI could not extract a specific time — ask the sender for clarification."
            ),
        )

    try:
        cal_service = GoogleCalendarService(credentials=gmail_service.credentials)
    except CalendarAuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Calendar authentication failed: {exc}",
        ) from exc

    try:
        is_available = await cal_service.check_availability(
            scheduling.start_datetime, scheduling.end_datetime
        )
    except CalendarAPIError as exc:
        logger.warning("Freebusy check failed for email %s, proceeding anyway: %s", email_id, exc)
        is_available = True

    try:
        event = await cal_service.create_event(
            summary=scheduling.event_summary or "Meeting",
            start_time=scheduling.start_datetime,
            end_time=scheduling.end_datetime,
            attendees=[],
            description=scheduling.suggested_reply or "",
        )
    except CalendarAPIError as exc:
        logger.exception("Calendar event creation failed for email %s: %s", email_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Google Calendar error: {exc}",
        ) from exc

    scheduling.calendar_event_id = event.get("event_id")
    scheduling.calendar_html_link = event.get("html_link")
    scheduling.meet_link = event.get("meet_link")
    scheduling.event_created_at = datetime.now(timezone.utc)
    db.commit()

    draft = db.scalar(select(Draft).where(Draft.email_id == email_id))
    if draft and not draft.is_sent:
        meet_url = event.get("meet_link") or event.get("html_link") or ""
        draft.draft_content = (draft.draft_content or "").replace("{{meet_link}}", meet_url)

        if draft.draft_gmail_id:
            try:
                await gmail_service.send_draft(draft.draft_gmail_id)
                draft.is_sent = True
                draft.sent_at = datetime.now(timezone.utc)
                db.commit()
                logger.info("Draft sent for email %s after calendar event creation.", email_id)
            except Exception as exc:
                logger.warning(
                    "Draft send failed after event creation for email %s: %s", email_id, exc
                )
        else:
            db.commit()

    return CreateEventResponse(
        message=(
            "Calendar event created successfully."
            if is_available
            else "Calendar event created (time conflict detected — you may have a scheduling overlap)."
        ),
        event_id=event.get("event_id"),
        html_link=event.get("html_link"),
        meet_link=event.get("meet_link"),
        is_available=is_available,
    )
