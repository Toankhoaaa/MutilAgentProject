"""FastAPI router for email listing, orchestration, draft updates, and send."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.api.auth_dependencies import get_current_user
from backend.api.dependencies import (
    get_analysis_agent,
    get_classifier_agent,
    get_db,
    get_gmail_service,
    get_response_agent,
)
from backend.models.classification import Classification
from backend.models.draft import Draft
from backend.models.email import Email
from backend.models.email_analysis import EmailAnalysis
from backend.models.email_scheduling import EmailScheduling
from backend.models.user import User
from backend.schemas.api_schemas import (
    ClassificationResponse,
    CreateEventResponse,
    DraftResponse,
    DraftSendResponse,
    DraftUpdateSchema,
    EmailAnalysisResponse,
    EmailResponse,
    PaginatedResponse,
    ProcessEmailRequest,
    ProcessEmailResult,
    ProcessEmailsResponse,
    SchedulingDataResponse,
)
from backend.services.agents import (
    EmailAnalysisAgent,
    EmailClassifierAgent,
    EmailResponseAgent,
)
from backend.services.calendar_service import (
    CalendarAPIError,
    CalendarAuthenticationError,
    GoogleCalendarService,
)
from backend.services.gmail_service import GmailService
from backend.services.orchestrator import EmailOrchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/emails", tags=["Emails"])


@router.get(
    "/",
    response_model=PaginatedResponse[EmailResponse],
    summary="List processed emails",
    description="Returns a paginated list of emails for the current user, optionally filtered by category.",
)
def list_emails(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    category: str = Query("all"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PaginatedResponse[EmailResponse]:
    """Return paginated emails with their classification, draft, and scheduling data."""
    stmt = select(Email).where(Email.user_id == current_user.id)

    if category != "all":
        stmt = stmt.join(Classification, Classification.email_id == Email.id, isouter=True).where(
            Classification.category == category
        )

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    emails = db.scalars(
        stmt.order_by(Email.received_at.desc().nulls_last()).offset(offset).limit(limit)
    ).all()

    items: list[EmailResponse] = []
    for email in emails:
        classification = db.scalar(select(Classification).where(Classification.email_id == email.id))
        draft = db.scalar(select(Draft).where(Draft.email_id == email.id))
        scheduling = db.scalar(select(EmailScheduling).where(EmailScheduling.email_id == email.id))

        row = EmailResponse.model_validate(email)
        row.classification = ClassificationResponse.model_validate(classification) if classification else None
        row.draft = DraftResponse.model_validate(draft) if draft else None
        row.scheduling = SchedulingDataResponse.model_validate(scheduling) if scheduling else None
        items.append(row)

    return PaginatedResponse(items=items, total=total, limit=limit, offset=offset)


@router.post(
    "/process",
    response_model=ProcessEmailsResponse,
    summary="Fetch and process new emails from Gmail",
    description=(
        "Fetches unread emails from Gmail, classifies them, and creates AI reply drafts. "
        "Persists all results to the database and returns batch processing statistics."
    ),
)
async def batch_process_emails(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    gmail_service: GmailService = Depends(get_gmail_service),
    classifier_agent: EmailClassifierAgent = Depends(get_classifier_agent),
    response_agent: EmailResponseAgent = Depends(get_response_agent),
) -> ProcessEmailsResponse:
    """Trigger a Gmail fetch + classify + draft batch run for the logged-in user."""
    orchestrator = EmailOrchestrator(
        db=db,
        gmail_service=gmail_service,
        classifier_agent=classifier_agent,
        response_agent=response_agent,
        user_id=current_user.id,
    )
    summary = await orchestrator.process_new_emails(limit=20)
    return ProcessEmailsResponse(**{k: summary[k] for k in ProcessEmailsResponse.model_fields if k in summary})


@router.get(
    "/{email_id}/analysis",
    response_model=EmailAnalysisResponse,
    summary="Get or generate AI analysis for an email",
    description=(
        "Returns cached deep-analysis (language, summary, translation, action items, sentiment). "
        "If no cached result exists, runs the analysis agent and persists the result."
    ),
)
async def get_email_analysis(
    email_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    analysis_agent: EmailAnalysisAgent = Depends(get_analysis_agent),
) -> EmailAnalysisResponse:
    """Return cached analysis or run the agent and cache the result."""
    email = db.scalar(
        select(Email).where(Email.id == email_id, Email.user_id == current_user.id)
    )
    if email is None:
        raise HTTPException(status_code=404, detail="Email not found.")

    cached = db.scalar(select(EmailAnalysis).where(EmailAnalysis.email_id == email_id))
    if cached is not None:
        return EmailAnalysisResponse.model_validate(cached)

    try:
        output = await analysis_agent.analyze(
            email_subject=email.subject or "",
            email_body=email.body or "",
            email_sender=email.sender,
        )
    except Exception as exc:
        logger.exception("Analysis agent failed for email %s: %s", email_id, exc)
        raise HTTPException(status_code=502, detail=f"Analysis failed: {exc}") from exc

    record = EmailAnalysis(
        email_id=email_id,
        detected_language=output.detected_language,
        summary=output.summary,
        translation=output.translation,
        action_items=output.action_items,
        sentiment=output.sentiment,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return EmailAnalysisResponse.model_validate(record)


@router.post(
    "/classify",
    response_model=ProcessEmailResult,
    summary="Classify a single email (stateless test)",
    description=(
        "Accepts raw email text, runs classification and optional reply drafting "
        "without DB persistence. Useful for testing the AI pipeline directly."
    ),
)
async def classify_email(
    payload: ProcessEmailRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    classifier_agent: EmailClassifierAgent = Depends(get_classifier_agent),
    response_agent: EmailResponseAgent = Depends(get_response_agent),
) -> ProcessEmailResult:
    """Classify raw email text and optionally draft a reply; no data is written to the database."""
    raw_email = {
        "subject": payload.subject,
        "body": payload.text,
        "sender": payload.sender,
    }

    orchestrator = EmailOrchestrator(
        db=db,
        gmail_service=None,
        classifier_agent=classifier_agent,
        response_agent=response_agent,
        user_id=current_user.id,
    )

    result = await orchestrator.process_one_stateless(raw_email)
    return ProcessEmailResult.model_validate(result)


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
