"""FastAPI router for email pipeline operations (stateless)."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.auth_dependencies import get_current_user
from backend.api.dependencies import (
    check_quota,
    get_analysis_agent,
    get_classifier_agent,
    get_db,
    get_gmail_service,
    get_response_agent,
    get_scheduling_agent,
    increment_request_count,
)
from backend.core import task_manager
from backend.core.websocket_manager import manager
from backend.models.email_scheduling import EmailScheduling
from backend.models.user import User
from backend.schemas.agent_schemas import EmailCategory
from backend.schemas.api_schemas import (
    AnalyzeEmailRequest,
    AnalyzeEmailResponse,
    EventDetailsResponse,
    GmailEmailItem,
    ProcessEmailRequest,
    ProcessEmailResult,
    ProcessEmailsResponse,
    ScheduleEventResponse,
)
from backend.services.agents import (
    EmailAnalysisAgent,
    EmailClassifierAgent,
    EmailResponseAgent,
    EmailSchedulingAgent,
)
from backend.services.gmail_service import GmailAPIError, GmailAuthenticationError, GmailService
from backend.services.orchestrator import EmailOrchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/emails", tags=["Emails"])


class ProcessTriggerRequest(BaseModel):
    """Optional body for /emails/process — carries a client-generated task_id."""

    task_id: str | None = None


@router.post(
    "/process",
    response_model=ProcessEmailsResponse,
    summary="Fetch and process new emails from Gmail",
    description=(
        "Fetches unread emails from Gmail, classifies them, and creates AI reply drafts. "
        "No email content is persisted to the database."
    ),
)
async def batch_process_emails(
    payload: ProcessTriggerRequest = Body(default_factory=ProcessTriggerRequest),
    current_user: User = Depends(check_quota),
    db: Session = Depends(get_db),
    gmail_service: GmailService = Depends(get_gmail_service),
    classifier_agent: EmailClassifierAgent = Depends(get_classifier_agent),
    response_agent: EmailResponseAgent = Depends(get_response_agent),
) -> ProcessEmailsResponse:
    """Trigger a Gmail fetch + classify + draft batch run for the logged-in user."""
    task_id = payload.task_id or str(uuid.uuid4())
    task_manager.register_task(task_id)
    try:
        orchestrator = EmailOrchestrator(
            db=db,
            gmail_service=gmail_service,
            classifier_agent=classifier_agent,
            response_agent=response_agent,
            user_id=current_user.id,
            task_id=task_id,
        )
        summary = await orchestrator.process_new_emails(limit=20)
        increment_request_count(current_user, db)
        return ProcessEmailsResponse(**{k: summary[k] for k in ProcessEmailsResponse.model_fields if k in summary})
    except asyncio.CancelledError:
        raise HTTPException(status_code=499, detail="Processing was cancelled by the user.")
    finally:
        task_manager.remove_task(task_id)


@router.get(
    "/list",
    response_model=list[GmailEmailItem],
    summary="Fetch inbox emails from Gmail (no DB persistence)",
    description="Fetches emails directly from Gmail and returns them. Nothing is written to the database.",
)
async def list_emails(
    limit: int = 20,
    query: str = "in:inbox",
    gmail_service: GmailService = Depends(get_gmail_service),
    _: User = Depends(get_current_user),
) -> list[dict]:
    """Return raw Gmail inbox emails without any DB persistence."""
    try:
        return await gmail_service.fetch_emails(query=query, limit=limit)
    except GmailAuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except GmailAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post(
    "/cleanup-spam",
    summary="Move all Gmail SPAM folder messages to trash",
)
async def cleanup_spam(
    gmail_service: GmailService = Depends(get_gmail_service),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Move every message in the Gmail SPAM folder to trash for the logged-in user."""
    try:
        result = await gmail_service.cleanup_spam_folder()
    except GmailAuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except GmailAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "message": f"Spam cleanup complete. Moved {result['trashed']} message(s) to trash.",
        "trashed": result["trashed"],
        "errors": result["errors"],
    }


@router.post(
    "/classify",
    response_model=ProcessEmailResult,
    summary="Classify a single email (stateless)",
    description=(
        "Accepts raw email text, runs classification and optional reply drafting "
        "without DB persistence."
    ),
)
async def classify_email(
    payload: ProcessEmailRequest,
    current_user: User = Depends(check_quota),
    db: Session = Depends(get_db),
    classifier_agent: EmailClassifierAgent = Depends(get_classifier_agent),
    response_agent: EmailResponseAgent = Depends(get_response_agent),
) -> ProcessEmailResult:
    """Classify raw email text and optionally draft a reply; no data is written to the database."""
    task_id = payload.task_id or str(uuid.uuid4())
    task_manager.register_task(task_id)
    try:
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
            task_id=task_id,
        )
        result = await orchestrator.process_one_stateless(raw_email, tone_override=payload.tone)
        increment_request_count(current_user, db)
        return ProcessEmailResult.model_validate(result)
    except asyncio.CancelledError:
        raise HTTPException(status_code=499, detail="Classification was cancelled by the user.")
    finally:
        task_manager.remove_task(task_id)


_CLEANABLE_CATEGORIES = {EmailCategory.SPAM, EmailCategory.NEWSLETTER}
_CLEANUP_CONFIDENCE_THRESHOLD = 0.7
_CLEANUP_INBOX_QUERY = "in:inbox category:promotions OR in:inbox category:social OR in:inbox category:updates"


class CleanupInboxRequest(BaseModel):
    """Optional body for /emails/cleanup-inbox."""

    task_id: str | None = None
    limit: int = 50


@router.post(
    "/cleanup-inbox",
    summary="AI-classify inbox emails and trash spam/newsletter ones",
    description=(
        "Fetches inbox emails from Promotions, Social, and Updates categories, "
        "runs AI classification, and moves messages classified as spam or newsletter "
        f"with confidence ≥ {_CLEANUP_CONFIDENCE_THRESHOLD} to trash."
    ),
)
async def cleanup_inbox(
    payload: CleanupInboxRequest = Body(default_factory=CleanupInboxRequest),
    current_user: User = Depends(check_quota),
    db: Session = Depends(get_db),
    gmail_service: GmailService = Depends(get_gmail_service),
    classifier_agent: EmailClassifierAgent = Depends(get_classifier_agent),
) -> dict:
    """Fetch inbox emails, classify with AI, and trash spam/newsletter messages."""
    task_id = payload.task_id or str(uuid.uuid4())
    task_manager.register_task(task_id)
    try:
        try:
            emails = await gmail_service.fetch_emails(query=_CLEANUP_INBOX_QUERY, limit=payload.limit)
        except GmailAuthenticationError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        except GmailAPIError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        scanned = len(emails)
        trashed = 0
        skipped = 0
        errors = 0

        for email in emails:
            if task_manager.is_cancelled(task_id):
                raise asyncio.CancelledError("Task was aborted by user")

            message_id = email.get("gmail_message_id", "")
            try:
                classification = await classifier_agent.classify(
                    subject=email.get("subject") or "",
                    body=email.get("body") or email.get("snippet") or "",
                    sender=email.get("sender"),
                )
                if task_manager.is_cancelled(task_id):
                    raise asyncio.CancelledError("Task was aborted by user")

                if (
                    classification.category in _CLEANABLE_CATEGORIES
                    and classification.confidence >= _CLEANUP_CONFIDENCE_THRESHOLD
                ):
                    await gmail_service.trash_message(message_id)
                    trashed += 1
                else:
                    skipped += 1
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.warning("Failed to process message %s during inbox cleanup: %s", message_id, exc)
                errors += 1

        increment_request_count(current_user, db)
        return {
            "message": f"Dọn dẹp xong. Đã xóa {trashed}/{scanned} email spam/quảng cáo.",
            "scanned": scanned,
            "trashed": trashed,
            "skipped": skipped,
            "errors": errors,
        }
    except asyncio.CancelledError:
        raise HTTPException(status_code=499, detail="Cleanup was cancelled by the user.")
    finally:
        task_manager.remove_task(task_id)


@router.post(
    "/analyze",
    response_model=AnalyzeEmailResponse,
    summary="AI analysis of a single email (stateless + optional event persistence)",
    description=(
        "Runs AnalysisAgent (summary, sentiment, action items) and SchedulingAgent "
        "(meeting detection) in parallel. If a scheduling intent is detected, the "
        "structured event metadata is persisted to ``email_schedulings`` and a "
        "real-time WebSocket event is broadcast. Raw email body is never stored."
    ),
)
async def analyze_email(
    payload: AnalyzeEmailRequest,
    current_user: User = Depends(check_quota),
    db: Session = Depends(get_db),
    analysis_agent: EmailAnalysisAgent = Depends(get_analysis_agent),
    scheduling_agent: EmailSchedulingAgent = Depends(get_scheduling_agent),
) -> AnalyzeEmailResponse:
    """Deep-analyze an email and optionally persist a detected calendar event."""
    analysis_result, scheduling_result = await asyncio.gather(
        analysis_agent.analyze(
            email_subject=payload.subject,
            email_body=payload.body,
            email_sender=payload.sender,
        ),
        scheduling_agent.extract_schedule(
            email_subject=payload.subject,
            email_body=payload.body,
            sender=payload.sender or "",
        ),
    )

    has_event = scheduling_result.is_meeting_request and scheduling_result.action is not None
    event_details: EventDetailsResponse | None = None
    scheduling_id: str | None = None

    if has_event:
        action = scheduling_result.action
        # action.start_time / action.end_time are timezone-aware datetime objects
        # validated by Pydantic — guaranteed ISO-8601 compliant on serialisation.
        start_iso = action.start_time.isoformat()
        end_iso = action.end_time.isoformat()

        event_details = EventDetailsResponse(
            event_title=scheduling_result.event_summary,
            start_time=start_iso,
            end_time=end_iso,
            attendees=action.attendees,
        )

        row = EmailScheduling(
            event_title=scheduling_result.event_summary,
            start_datetime=action.start_time,
            end_datetime=action.end_time,
            attendees_json=json.dumps(action.attendees),
            suggested_reply=scheduling_result.suggested_reply or None,
            status="PENDING",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        scheduling_id = str(row.id)

        await manager.broadcast({
            "type": "NEW_CALENDAR_EVENT",
            "event_title": scheduling_result.event_summary,
            "start_time": start_iso,
            "scheduling_id": scheduling_id,
        })

    increment_request_count(current_user, db)
    return AnalyzeEmailResponse(
        summary=analysis_result.summary,
        sentiment=analysis_result.sentiment,
        action_items=analysis_result.action_items,
        translation=analysis_result.translation,
        detected_language=analysis_result.detected_language,
        has_event=has_event,
        event_details=event_details,
        scheduling_id=scheduling_id,
    )


@router.get(
    "/scheduled-events",
    response_model=list[ScheduleEventResponse],
    summary="List persisted calendar events extracted from emails",
    description="Returns all rows from ``email_schedulings``, newest first.",
)
def list_scheduled_events(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[ScheduleEventResponse]:
    """Return all saved scheduling events ordered by creation time descending."""
    rows = db.scalars(
        select(EmailScheduling).order_by(EmailScheduling.created_at.desc())
    ).all()
    return [
        ScheduleEventResponse(
            id=str(row.id),
            title=row.event_title or "(Không có tiêu đề)",
            startTime=row.start_datetime.isoformat() if row.start_datetime else "",
            endTime=row.end_datetime.isoformat() if row.end_datetime else "",
            attendees=row.attendees,
            status=row.status,
            emailSnippet=row.event_title or "",
            alternativeSlots=[],
        )
        for row in rows
    ]


@router.post(
    "/scheduled-events/{scheduling_id}/confirm",
    summary="Confirm a pending calendar event",
    description="Marks an ``email_schedulings`` row as CONFIRMED.",
)
def confirm_scheduled_event(
    scheduling_id: uuid.UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> dict:
    """Mark a scheduling event as confirmed."""
    row = db.get(EmailScheduling, scheduling_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Scheduling event not found.")
    row.status = "CONFIRMED"
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Event confirmed.", "id": str(row.id)}
