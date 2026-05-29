"""FastAPI router for email listing, orchestration, draft updates, and send."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from backend.api.auth_dependencies import get_current_user
from backend.api.dependencies import (
    get_analysis_agent,
    get_classifier_agent,
    get_db,
    get_gmail_service,
    get_response_agent,
    get_scheduling_agent,
)
from backend.models.classification import Classification
from backend.models.draft import Draft
from backend.models.email import Email
from backend.models.email_analysis import EmailAnalysis
from backend.models.email_scheduling import EmailScheduling
from backend.models.user import User
from backend.schemas.api_schemas import (
    CreateEventResponse,
    DraftResponse,
    DraftSendResponse,
    DraftUpdateSchema,
    EmailActionResponse,
    EmailAnalysisResponse,
    EmailResponse,
    PaginatedResponse,
    ProcessEmailsResponse,
    SchedulingDataResponse,
)
from backend.services.agents import (
    EmailAnalysisAgent,
    EmailClassifierAgent,
    EmailResponseAgent,
    EmailSchedulingAgent,
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


def _get_authorized_email(
    db: Session,
    email_id: UUID,
    current_user: User,
    *,
    load_draft: bool = False,
) -> Email:
    """Load an email row and enforce ownership by the authenticated user."""
    stmt = select(Email).where(Email.id == email_id)
    if load_draft:
        stmt = stmt.options(selectinload(Email.draft))
    email = db.scalar(stmt)
    if email is None:
        raise HTTPException(status_code=404, detail="Email not found")
    if email.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to access this email.")
    return email


def _sync_labels_from_gmail(email: Email, gmail_result: dict) -> None:
    """Persist Gmail label ids returned after a label mutation."""
    label_ids = gmail_result.get("labelIds")
    if isinstance(label_ids, list):
        email.labels = label_ids


@router.get(
    "/",
    response_model=PaginatedResponse[EmailResponse],
    summary="List emails",
    description=(
        "Returns paginated emails with optional filters by classification category "
        "and processing status. Nested ``classification`` and ``draft`` are included when present."
    ),
)
def list_emails(
    db: Session = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100, description="Page size."),
    offset: int = Query(default=0, ge=0, description="Rows to skip."),
    category: str = Query(
        default="all",
        description='Filter by classification category, or "all" for no filter.',
    ),
    is_processed: bool | None = Query(
        default=None,
        description="When set, only emails with this processed flag are returned.",
    ),
) -> PaginatedResponse[EmailResponse]:
    """
    List stored emails with pagination and optional filters.

    Joins the ``classifications`` table when ``category`` is not ``all``.
    """
    base = select(Email.id)

    if category.lower() != "all":
        base = base.join(Classification, Classification.email_id == Email.id).where(
            Classification.category == category
        )

    if is_processed is not None:
        base = base.where(Email.is_processed == is_processed)

    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0

    list_stmt = (
        select(Email)
        .options(
            selectinload(Email.classification),
            selectinload(Email.draft),
            selectinload(Email.scheduling),
        )
        .order_by(Email.received_at.desc().nulls_last(), Email.created_at.desc())
    )

    if category.lower() != "all":
        list_stmt = list_stmt.join(Classification, Classification.email_id == Email.id).where(
            Classification.category == category
        )

    if is_processed is not None:
        list_stmt = list_stmt.where(Email.is_processed == is_processed)

    list_stmt = list_stmt.limit(limit).offset(offset)
    rows = db.scalars(list_stmt).unique().all()

    return PaginatedResponse(
        items=[EmailResponse.model_validate(e) for e in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{email_id}",
    response_model=EmailResponse,
    summary="Get email detail",
    description="Returns a single email with nested classification and draft.",
)
def get_email(
    email_id: UUID,
    db: Session = Depends(get_db),
) -> EmailResponse:
    """Fetch one email by id; 404 when not found."""
    stmt = (
        select(Email)
        .options(
            selectinload(Email.classification),
            selectinload(Email.draft),
            selectinload(Email.scheduling),
        )
        .where(Email.id == email_id)
    )
    email = db.scalar(stmt)
    if email is None:
        raise HTTPException(status_code=404, detail="Email not found.")
    return EmailResponse.model_validate(email)


@router.get(
    "/{email_id}/analysis",
    response_model=EmailAnalysisResponse,
    summary="Get AI analysis for an email",
    description=(
        "Returns deep AI analysis (language, summary, translation, action items, sentiment). "
        "Serves from DB cache when available; calls the Analysis Agent otherwise."
    ),
)
async def get_email_analysis(
    email_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    analysis_agent: EmailAnalysisAgent = Depends(get_analysis_agent),
) -> EmailAnalysisResponse:
    """Cache-first AI analysis: hit DB first, call LLM only on cache miss."""
    email = _get_authorized_email(db, email_id, current_user)

    cached = db.scalar(select(EmailAnalysis).where(EmailAnalysis.email_id == email_id))
    if cached is not None:
        return EmailAnalysisResponse.model_validate(cached)

    try:
        result = await analysis_agent.analyze(
            email_subject=email.subject or "",
            email_body=email.body or "",
            email_sender=email.sender or "",
        )
    except Exception as exc:
        logger.exception("Analysis agent failed for email %s: %s", email_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Analysis agent error: {exc}",
        ) from exc

    record = EmailAnalysis(
        email_id=email_id,
        detected_language=result.detected_language,
        summary=result.summary,
        translation=result.translation,
        action_items=result.action_items,
        sentiment=result.sentiment,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return EmailAnalysisResponse.model_validate(record)


@router.post(
    "/{email_id}/schedule",
    response_model=SchedulingDataResponse,
    summary="Extract scheduling data from an email",
    description=(
        "Detects whether the email is a meeting request and extracts ISO 8601 datetime fields. "
        "Cache-first: returns stored result when available, otherwise calls the Scheduling Agent."
    ),
)
async def get_email_scheduling(
    email_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    scheduling_agent: EmailSchedulingAgent = Depends(get_scheduling_agent),
) -> SchedulingDataResponse:
    """Cache-first scheduling extraction: DB hit first, LLM only on miss."""
    email = _get_authorized_email(db, email_id, current_user)

    cached = db.scalar(
        select(EmailScheduling).where(EmailScheduling.email_id == email_id)
    )
    if cached is not None:
        return SchedulingDataResponse.model_validate(cached)

    try:
        result = await scheduling_agent.extract_schedule(
            email_subject=email.subject or "",
            email_body=email.body or "",
            sender=email.sender or "",
        )
    except Exception as exc:
        logger.exception("Scheduling agent failed for email %s: %s", email_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Scheduling agent error: {exc}",
        ) from exc

    record = EmailScheduling(
        email_id=email_id,
        is_meeting_request=result.is_meeting_request,
        start_datetime=result.start_datetime,
        end_datetime=result.end_datetime,
        event_summary=result.event_summary,
        suggested_reply=result.suggested_reply,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return SchedulingDataResponse.model_validate(record)


@router.post(
    "/{email_id}/create-event",
    response_model=CreateEventResponse,
    summary="Create Google Calendar event from scheduling data",
    description=(
        "Checks the user's availability via Freebusy API, creates a Google Calendar event "
        "with a Google Meet link, then sends the reply draft email. "
        "Requires a prior call to ``/{email_id}/schedule`` to populate scheduling data."
    ),
)
async def create_calendar_event(
    email_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    gmail_service: GmailService = Depends(get_gmail_service),
) -> CreateEventResponse:
    """
    Create a Calendar event using the scheduling data stored for the email.

    Flow:
    1. Load and validate scheduling record.
    2. Check user availability via Freebusy API.
    3. Create event (auto-includes Google Meet link).
    4. Persist event metadata back to ``email_schedulings``.
    5. If a draft reply exists, insert the Meet link and send it.
    """
    email = _get_authorized_email(db, email_id, current_user, load_draft=True)

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

    # Build Calendar service from the same OAuth credentials
    try:
        cal_service = GoogleCalendarService(credentials=gmail_service.credentials)
    except CalendarAuthenticationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Calendar authentication failed: {exc}",
        ) from exc

    # Availability check
    try:
        is_available = await cal_service.check_availability(
            scheduling.start_datetime, scheduling.end_datetime
        )
    except CalendarAPIError as exc:
        logger.warning("Freebusy check failed for email %s, proceeding anyway: %s", email_id, exc)
        is_available = True  # non-blocking: allow creation even if check fails

    # Create the event
    attendees = [email.sender] if email.sender else []
    try:
        event = await cal_service.create_event(
            summary=scheduling.event_summary or email.subject or "Meeting",
            start_time=scheduling.start_datetime,
            end_time=scheduling.end_datetime,
            attendees=attendees,
            description=scheduling.suggested_reply or "",
        )
    except CalendarAPIError as exc:
        logger.exception("Calendar event creation failed for email %s: %s", email_id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Google Calendar error: {exc}",
        ) from exc

    # Persist event details
    scheduling.calendar_event_id = event.get("event_id")
    scheduling.calendar_html_link = event.get("html_link")
    scheduling.meet_link = event.get("meet_link")
    scheduling.event_created_at = datetime.now(timezone.utc)
    db.commit()

    # Inject Meet link into draft and send, if draft exists
    if email.draft and not email.draft.is_sent:
        meet_placeholder = "{{meet_link}}"
        meet_url = event.get("meet_link") or event.get("html_link") or ""
        updated_body = (email.draft.draft_content or "").replace(meet_placeholder, meet_url)
        email.draft.draft_content = updated_body

        if email.draft.draft_gmail_id:
            try:
                await gmail_service.send_draft(email.draft.draft_gmail_id)
                email.draft.is_sent = True
                email.draft.sent_at = datetime.now(timezone.utc)
                db.commit()
                logger.info("Draft sent for email %s after calendar event creation.", email_id)
            except Exception as exc:
                logger.warning(
                    "Draft send failed after event creation for email %s: %s", email_id, exc
                )
        else:
            db.commit()

    return CreateEventResponse(
        message="Calendar event created successfully." if is_available
        else "Calendar event created (time conflict detected — you may have a scheduling overlap).",
        event_id=event.get("event_id"),
        html_link=event.get("html_link"),
        meet_link=event.get("meet_link"),
        is_available=is_available,
    )


@router.post(
    "/process",
    response_model=ProcessEmailsResponse,
    summary="Process new emails",
    description=(
        "Fetches unread messages from Gmail (via ``GmailService``), runs classification "
        "and optional reply drafting through ``EmailOrchestrator``, and persists results."
    ),
)
async def process_emails(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    classifier_agent: EmailClassifierAgent = Depends(get_classifier_agent),
    response_agent: EmailResponseAgent = Depends(get_response_agent),
) -> ProcessEmailsResponse:
    """
    Trigger a batch run that ingests unread mail and runs the multi-agent pipeline.

    Uses the signed-in user's Google OAuth token from the database (no mock Gmail).
    """
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
    orchestrator = EmailOrchestrator(
        db=db,
        gmail_service=gmail_service,
        classifier_agent=classifier_agent,
        response_agent=response_agent,
        user_id=current_user.id,
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
    """
    Replace ``draft_content`` on the draft linked to ``email_id`` and mark as modified.

    Raises 404 if the email or its draft does not exist.
    """
    email = _get_authorized_email(db, email_id, current_user, load_draft=True)

    if email.draft is None:
        raise HTTPException(
            status_code=404,
            detail="No draft exists for this email.",
        )

    email.draft.draft_content = payload.draft_content
    email.draft.is_modified = True
    db.commit()
    db.refresh(email.draft)

    return DraftResponse.model_validate(email.draft)


@router.post(
    "/{email_id}/send",
    response_model=DraftSendResponse,
    summary="Send Gmail draft",
    description=(
        "Sends the Gmail draft identified by ``draft_gmail_id`` on the stored draft row "
        "using ``GmailService.send_draft``."
    ),
)
async def send_draft(
    email_id: UUID,
    db: Session = Depends(get_db),
    gmail_service: GmailService = Depends(get_gmail_service),
    current_user: User = Depends(get_current_user),
) -> DraftSendResponse:
    """
    Send the reply draft through Gmail and mark the local draft as sent.

    Requires a persisted ``draft_gmail_id`` from draft creation.
    """
    email = _get_authorized_email(db, email_id, current_user, load_draft=True)

    if email.draft is None:
        raise HTTPException(
            status_code=404,
            detail="No draft exists for this email.",
        )

    if not email.draft.draft_gmail_id:
        raise HTTPException(
            status_code=400,
            detail="Draft has no Gmail draft id; create a draft via the orchestrator first.",
        )

    try:
        sent = await gmail_service.send_draft(email.draft.draft_gmail_id)
    except Exception as exc:
        logger.exception("Gmail send failed for email %s: %s", email_id, exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    email.draft.is_sent = True
    email.draft.sent_at = datetime.now(timezone.utc)
    db.commit()

    return DraftSendResponse(
        message="Draft sent successfully.",
        gmail_message_id=sent.get("id"),
        gmail_thread_id=sent.get("threadId"),
    )


@router.put(
    "/{email_id}/archive",
    response_model=EmailActionResponse,
    summary="Archive email",
    description="Removes the INBOX label in Gmail and updates local label metadata.",
)
async def archive_email(
    email_id: UUID,
    db: Session = Depends(get_db),
    gmail_service: GmailService = Depends(get_gmail_service),
    current_user: User = Depends(get_current_user),
) -> EmailActionResponse:
    """Archive an email owned by the current user."""
    email = _get_authorized_email(db, email_id, current_user)
    try:
        result = await gmail_service.archive_message(email.gmail_message_id)
    except Exception as exc:
        logger.exception("Gmail archive failed for %s: %s", email_id, exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    _sync_labels_from_gmail(email, result)
    db.commit()
    db.refresh(email)

    return EmailActionResponse(
        message="Email archived successfully.",
        email_id=email.id,
        gmail_message_id=email.gmail_message_id,
        labels=email.labels,
    )


@router.put(
    "/{email_id}/trash",
    response_model=EmailActionResponse,
    summary="Trash email",
    description="Moves the Gmail message to trash and updates local label metadata.",
)
async def trash_email(
    email_id: UUID,
    db: Session = Depends(get_db),
    gmail_service: GmailService = Depends(get_gmail_service),
    current_user: User = Depends(get_current_user),
) -> EmailActionResponse:
    """Move an email to trash for the authenticated owner."""
    email = _get_authorized_email(db, email_id, current_user)
    try:
        result = await gmail_service.trash_message(email.gmail_message_id)
    except Exception as exc:
        logger.exception("Gmail trash failed for %s: %s", email_id, exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    _sync_labels_from_gmail(email, result)
    db.commit()
    db.refresh(email)

    return EmailActionResponse(
        message="Email moved to trash successfully.",
        email_id=email.id,
        gmail_message_id=email.gmail_message_id,
        labels=email.labels,
    )


@router.put(
    "/{email_id}/star",
    response_model=EmailActionResponse,
    summary="Star email",
    description="Adds the STARRED label in Gmail and updates local label metadata.",
)
async def star_email(
    email_id: UUID,
    db: Session = Depends(get_db),
    gmail_service: GmailService = Depends(get_gmail_service),
    current_user: User = Depends(get_current_user),
) -> EmailActionResponse:
    """Star an email owned by the current user."""
    email = _get_authorized_email(db, email_id, current_user)
    try:
        result = await gmail_service.star_message(email.gmail_message_id)
    except Exception as exc:
        logger.exception("Gmail star failed for %s: %s", email_id, exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    _sync_labels_from_gmail(email, result)
    db.commit()
    db.refresh(email)

    return EmailActionResponse(
        message="Email starred successfully.",
        email_id=email.id,
        gmail_message_id=email.gmail_message_id,
        labels=email.labels,
    )
