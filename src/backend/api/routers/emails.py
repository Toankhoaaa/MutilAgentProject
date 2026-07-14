"""FastAPI router for email pipeline operations (stateless)."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.api.auth_dependencies import get_current_user
from backend.api.dependencies import (
    check_quota,
    get_analysis_agent,
    get_calendar_service,
    get_classifier_agent,
    get_db,
    get_gmail_service,
    get_response_agent,
    get_scheduling_agent,
    get_security_agent,
    increment_request_count,
)
from backend.models.classification import Classification
from backend.models.draft_cache import DraftCache
from backend.models.email_analysis_cache import EmailAnalysisCache
from backend.services.calendar_service import CalendarServiceError, GoogleCalendarService
from backend.core import task_manager
from backend.core.websocket_manager import manager
from backend.models.email_scheduling import EmailScheduling
from backend.models.snoozed_email import SnoozedEmail
from backend.models.user import User
from backend.schemas.agent_schemas import EmailCategory, EmailClassificationOutput, SchedulingOutput
from backend.schemas.api_schemas import (
    AnalyzeEmailRequest,
    AnalyzeEmailResponse,
    CreateScheduleEventRequest,
    EventDetailsResponse,
    GmailEmailItem,
    GmailListResponse,
    ProcessEmailRequest,
    ProcessEmailResult,
    ProcessEmailsResponse,
    QuickClassifyItem,
    QuickClassifyResult,
    ResolveScheduleConflictRequest,
    ScheduleEventResponse,
    UpdateScheduleEventRequest,
)
from backend.services.agents import (
    EmailAnalysisAgent,
    EmailClassifierAgent,
    EmailResponseAgent,
    EmailSchedulingAgent,
    EmailSecurityAgent,
)
from backend.services.agents.privacy_agent import PrivacyAgent
from backend.services.gmail_service import GmailAPIError, GmailAuthenticationError, GmailService
from backend.services.orchestrator import EmailOrchestrator
from backend.services.scheduling_service import (
    get_user_scheduling,
    row_to_response,
    upsert_scheduling_from_extraction,
)

_privacy = PrivacyAgent()

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/emails", tags=["Emails"])


def _upsert_classification_cache(
    db: Session,
    *,
    user_id: uuid.UUID,
    gmail_message_id: str,
    category: str,
    priority_score: int,
    summary: str,
    confidence: float,
    thread_id: str | None = None,
) -> None:
    """Insert or update a classification cache row; tolerate concurrent inserts."""
    existing = db.scalar(
        select(Classification).where(
            Classification.gmail_message_id == gmail_message_id,
            Classification.user_id == user_id,
        )
    )
    if existing:
        existing.category = category
        existing.priority_score = priority_score
        existing.summary = summary
        existing.confidence = confidence
        if thread_id is not None:
            existing.thread_id = thread_id
        return

    try:
        with db.begin_nested():
            db.add(Classification(
                user_id=user_id,
                gmail_message_id=gmail_message_id,
                thread_id=thread_id,
                category=category,
                priority_score=priority_score,
                summary=summary,
                confidence=confidence,
            ))
    except IntegrityError:
        logger.debug(
            "classification cache race on insert gmail_message_id=%s — keeping existing row",
            gmail_message_id,
        )


def _upsert_draft_cache(
    db: Session,
    *,
    user_id: uuid.UUID,
    gmail_message_id: str,
    draft_subject: str,
    draft_content: str,
) -> None:
    """Insert or update a draft cache row; tolerate concurrent inserts."""
    existing = db.scalar(
        select(DraftCache).where(
            DraftCache.gmail_message_id == gmail_message_id,
            DraftCache.user_id == user_id,
        )
    )
    if existing:
        existing.draft_subject = draft_subject
        existing.draft_content = draft_content
        return

    try:
        with db.begin_nested():
            db.add(DraftCache(
                user_id=user_id,
                gmail_message_id=gmail_message_id,
                draft_subject=draft_subject,
                draft_content=draft_content,
            ))
    except IntegrityError:
        logger.debug(
            "draft cache race on insert gmail_message_id=%s — keeping existing row",
            gmail_message_id,
        )


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
    task_manager.register_task(task_id, str(current_user.id))
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
    response_model=GmailListResponse,
    summary="Fetch inbox emails from Gmail (no DB persistence)",
    description="Fetches one page of emails from Gmail. Pass nextPageToken as page_token to load subsequent pages.",
)
async def list_emails(
    limit: int = 20,
    query: str = "in:inbox -category:promotions",
    page_token: str | None = None,
    gmail_service: GmailService = Depends(get_gmail_service),
    _: User = Depends(get_current_user),
) -> GmailListResponse:
    """Return one page of Gmail inbox emails without any DB persistence."""
    try:
        emails, next_page_token = await gmail_service.fetch_emails(
            query=query, limit=limit, page_token=page_token
        )
        return GmailListResponse(emails=emails, next_page_token=next_page_token)
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
        "Accepts raw email text, runs classification and optional reply drafting. "
        "Email content is not persisted; AuditLog entries are written for observability."
    ),
)
async def classify_email(
    payload: ProcessEmailRequest,
    current_user: User = Depends(check_quota),
    db: Session = Depends(get_db),
    gmail_service: GmailService = Depends(get_gmail_service),
    classifier_agent: EmailClassifierAgent = Depends(get_classifier_agent),
    response_agent: EmailResponseAgent = Depends(get_response_agent),
) -> ProcessEmailResult:
    """Classify raw email text and optionally draft a reply; email content is not persisted."""
    if payload.gmail_message_id:
        cached = db.scalar(
            select(Classification).where(
                Classification.gmail_message_id == payload.gmail_message_id,
                Classification.user_id == current_user.id,
            )
        )
        if cached and not payload.generate_draft:
            logger.info("classify cache hit (single): gmail_message_id=%s", payload.gmail_message_id)
            return ProcessEmailResult(
                category=cached.category or "unknown",
                priority_score=cached.priority_score or 0,
                summary=cached.summary or "",
                confidence=cached.confidence or 0.0,
            )

        if cached and payload.generate_draft:
            cached_draft = db.scalar(
                select(DraftCache).where(
                    DraftCache.gmail_message_id == payload.gmail_message_id,
                    DraftCache.user_id == current_user.id,
                )
            )
            if cached_draft:
                logger.info("draft cache hit, skipping generation: gmail_message_id=%s", payload.gmail_message_id)
                return ProcessEmailResult(
                    category=cached.category or "unknown",
                    priority_score=cached.priority_score or 0,
                    summary=cached.summary or "",
                    confidence=cached.confidence or 0.0,
                    draft_content=cached_draft.draft_content,
                    draft_subject=cached_draft.draft_subject,
                )

    email_body = payload.text
    if payload.generate_draft and payload.gmail_message_id:
        try:
            fetched = await gmail_service.get_email_content(payload.gmail_message_id)
            if fetched and not fetched.startswith("Error:"):
                email_body = fetched
                logger.info("classify: fetched full body for draft (msg=%s, len=%d)", payload.gmail_message_id, len(fetched))
        except Exception:
            logger.warning("classify: could not fetch full body for %s, falling back to snippet", payload.gmail_message_id)

    task_id = payload.task_id or str(uuid.uuid4())
    task_manager.register_task(task_id, str(current_user.id))
    try:
        raw_email = {
            "subject": payload.subject,
            "body": email_body,
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
        result = await orchestrator.process_one_stateless(raw_email, tone_override=payload.tone, force_draft=payload.generate_draft)
        increment_request_count(current_user, db)

        if payload.gmail_message_id:
            _upsert_classification_cache(
                db,
                user_id=current_user.id,
                gmail_message_id=payload.gmail_message_id,
                category=result["category"],
                priority_score=result["priority_score"],
                summary=result["summary"],
                confidence=result["confidence"],
            )
            if result["draft_content"]:
                _upsert_draft_cache(
                    db,
                    user_id=current_user.id,
                    gmail_message_id=payload.gmail_message_id,
                    draft_subject=result["draft_subject"] or "",
                    draft_content=result["draft_content"],
                )
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                logger.warning(
                    "classify: classification cache commit race gmail_message_id=%s",
                    payload.gmail_message_id,
                )

        return ProcessEmailResult.model_validate(result)
    except asyncio.CancelledError:
        raise HTTPException(status_code=499, detail="Classification was cancelled by the user.")
    finally:
        task_manager.remove_task(task_id)


class CreateGmailDraftRequest(BaseModel):
    """Payload for pushing a draft reply into Gmail."""

    to: str
    subject: str
    body: str
    thread_id: str | None = None


@router.post("/gmail-draft", summary="Create a Gmail draft reply")
async def create_gmail_draft(
    payload: CreateGmailDraftRequest,
    gmail_service: GmailService = Depends(get_gmail_service),
    _user: User = Depends(get_current_user),
) -> dict:
    """Push a draft reply into the authenticated user's Gmail Drafts folder."""
    try:
        draft_id = await gmail_service.create_draft(
            to=payload.to,
            subject=payload.subject,
            body=payload.body,
            thread_id=payload.thread_id,
        )
    except GmailAuthenticationError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except GmailAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"draft_id": draft_id}


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
    task_manager.register_task(task_id, str(current_user.id))
    try:
        try:
            emails, _ = await gmail_service.fetch_emails(query=_CLEANUP_INBOX_QUERY, limit=payload.limit)
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
                cached_cls = (
                    db.scalar(
                        select(Classification).where(
                            Classification.gmail_message_id == message_id,
                            Classification.user_id == current_user.id,
                        )
                    )
                    if message_id else None
                )
                if cached_cls:
                    logger.info("classify cache hit (cleanup): gmail_message_id=%s", message_id)
                    try:
                        _cat = EmailCategory(cached_cls.category)
                    except (ValueError, TypeError):
                        _cat = EmailCategory.NEWSLETTER
                    classification = EmailClassificationOutput.model_construct(
                        category=_cat,
                        priority_score=cached_cls.priority_score or 0,
                        summary=cached_cls.summary or "",
                        deadline=None,
                        confidence=cached_cls.confidence or 0.0,
                    )
                else:
                    classification = await classifier_agent.classify(
                        subject=email.get("subject") or "",
                        body=email.get("body") or email.get("snippet") or "",
                        sender=email.get("sender"),
                    )
                    if message_id:
                        try:
                            db.add(Classification(
                                user_id=current_user.id,
                                gmail_message_id=message_id,
                                thread_id=email.get("thread_id") or None,
                                category=classification.category.value,
                                priority_score=classification.priority_score,
                                summary=classification.summary,
                                confidence=classification.confidence,
                            ))
                            db.commit()
                        except IntegrityError:
                            # Row already exists (inserted by another path/user); reuse classification result.
                            db.rollback()

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
                db.rollback()
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
    security_agent: EmailSecurityAgent = Depends(get_security_agent),
    classifier_agent: EmailClassifierAgent = Depends(get_classifier_agent),
) -> AnalyzeEmailResponse:
    """Deep-analyze an email and optionally persist a detected calendar event."""
    if payload.gmail_message_id:
        cached = db.scalar(
            select(EmailAnalysisCache).where(
                EmailAnalysisCache.gmail_message_id == payload.gmail_message_id,
                EmailAnalysisCache.user_id == current_user.id,
            )
        )
        if cached:
            logger.info("analyze cache hit: gmail_message_id=%s", payload.gmail_message_id)
            return AnalyzeEmailResponse.model_validate_json(cached.response_json)

    masked_subject = _privacy.mask(payload.subject)
    masked_body = _privacy.mask(payload.body)
    # mask() strips email addresses from the sender display name (e.g. "Name <a@b.com>")
    # but SecurityAgent receives the real sender so it can detect domain spoofing —
    # comparing the From header domain against the email body links requires the raw value.
    masked_sender = _privacy.mask(payload.sender or "")

    # Check classifications table before calling Classifier LLM (same cache-check-first pattern).
    cached_cls: Classification | None = None
    if payload.gmail_message_id:
        cached_cls = db.scalar(
            select(Classification).where(
                Classification.gmail_message_id == payload.gmail_message_id,
                Classification.user_id == current_user.id,
            )
        )
        if cached_cls:
            logger.info("classify cache hit in analyze: gmail_message_id=%s", payload.gmail_message_id)

    run_classifier = cached_cls is None
    coroutines: list = [
        analysis_agent.analyze(
            email_subject=masked_subject,
            email_body=masked_body,
            email_sender=masked_sender,
        ),
        scheduling_agent.extract_schedule(
            email_subject=masked_subject,
            email_body=masked_body,
            sender=masked_sender,
        ),
        security_agent.analyze(
            email_subject=masked_subject,
            email_body=masked_body,
            sender=payload.sender or "",  # real sender — needed for spoofing domain check
        ),
    ]
    if run_classifier:
        coroutines.append(
            classifier_agent.classify(masked_subject, masked_body, masked_sender or None)
        )

    _gather_results = await asyncio.gather(*coroutines, return_exceptions=True)

    if run_classifier:
        analysis_result, scheduling_result, security_result, classifier_output = _gather_results
    else:
        analysis_result, scheduling_result, security_result = _gather_results
        classifier_output = None

    if isinstance(scheduling_result, BaseException):
        scheduling_result = SchedulingOutput(is_meeting_request=False, suggested_reply="")
    if isinstance(analysis_result, BaseException):
        raise analysis_result
    if isinstance(security_result, BaseException):
        raise security_result

    # Resolve category from cache hit or fresh classifier output.
    category: str | None = None
    confidence: float | None = None
    if cached_cls:
        category = cached_cls.category
        confidence = cached_cls.confidence
    elif isinstance(classifier_output, EmailClassificationOutput):
        category = classifier_output.category.value
        confidence = classifier_output.confidence
        if payload.gmail_message_id:
            _upsert_classification_cache(
                db,
                user_id=current_user.id,
                gmail_message_id=payload.gmail_message_id,
                category=category,
                priority_score=classifier_output.priority_score,
                summary=classifier_output.summary,
                confidence=confidence or 0.0,
            )
    elif isinstance(classifier_output, BaseException):
        logger.warning("Classifier failed in analyze_email, category omitted: %s", classifier_output)

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

        row = upsert_scheduling_from_extraction(
            db,
            current_user.id,
            gmail_message_id=payload.gmail_message_id,
            event_title=scheduling_result.event_summary,
            start_datetime=action.start_time,
            end_datetime=action.end_time,
            attendees=action.attendees,
            suggested_reply=scheduling_result.suggested_reply or None,
            status="PENDING",
        )
        db.commit()
        db.refresh(row)
        scheduling_id = str(row.id)

        await manager.broadcast(
            {
                "type": "NEW_CALENDAR_EVENT",
                "event_title": scheduling_result.event_summary,
                "start_time": start_iso,
                "scheduling_id": scheduling_id,
            },
            target_user_id=current_user.id,
        )

    if security_result.risk_level == "high":
        await manager.broadcast(
            {
                "type": "SECURITY_ALERT",
                "risk_level": "high",
                "warnings": security_result.warnings,
                "sender": payload.sender,
                "subject": payload.subject,
            },
            target_user_id=current_user.id,
        )

    increment_request_count(current_user, db)
    response = AnalyzeEmailResponse(
        summary=analysis_result.summary,
        sentiment=analysis_result.sentiment,
        action_items=analysis_result.action_items,
        translation=analysis_result.translation,
        detected_language=analysis_result.detected_language,
        has_event=has_event,
        event_details=event_details,
        scheduling_id=scheduling_id,
        is_safe=security_result.is_safe,
        risk_level=security_result.risk_level,
        warnings=security_result.warnings,
        category=category,
        confidence=confidence,
    )
    if payload.gmail_message_id:
        existing_cache = db.scalar(
            select(EmailAnalysisCache).where(
                EmailAnalysisCache.gmail_message_id == payload.gmail_message_id,
                EmailAnalysisCache.user_id == current_user.id,
            )
        )
        if existing_cache:
            existing_cache.response_json = response.model_dump_json()
        else:
            try:
                with db.begin_nested():
                    db.add(EmailAnalysisCache(
                        user_id=current_user.id,
                        gmail_message_id=payload.gmail_message_id,
                        response_json=response.model_dump_json(),
                    ))
            except IntegrityError:
                logger.debug(
                    "analyze cache race on insert gmail_message_id=%s — keeping existing row",
                    payload.gmail_message_id,
                )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            logger.warning(
                "analyze: cache commit race gmail_message_id=%s",
                payload.gmail_message_id,
            )
    return response


@router.get(
    "/scheduled-events",
    response_model=list[ScheduleEventResponse],
    summary="List persisted calendar events extracted from emails",
    description="Returns all rows from ``email_schedulings``, newest first.",
)
def list_scheduled_events(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ScheduleEventResponse]:
    """Return all saved scheduling events ordered by creation time descending."""
    rows = db.scalars(
        select(EmailScheduling)
        .where(EmailScheduling.user_id == current_user.id)
        .order_by(EmailScheduling.created_at.desc())
    ).all()
    return [row_to_response(row) for row in rows]


@router.post(
    "/scheduled-events",
    response_model=ScheduleEventResponse,
    summary="Create a calendar event manually",
)
def create_scheduled_event(
    payload: CreateScheduleEventRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ScheduleEventResponse:
    """Create a new scheduling row from the UI (deduped by time slot)."""
    if payload.end_time <= payload.start_time:
        raise HTTPException(status_code=400, detail="Thời gian kết thúc phải sau thời gian bắt đầu.")

    row = upsert_scheduling_from_extraction(
        db,
        current_user.id,
        gmail_message_id=None,
        event_title=payload.title,
        start_datetime=payload.start_time,
        end_datetime=payload.end_time,
        attendees=payload.attendees,
        suggested_reply=None,
        status="PENDING",
    )
    db.commit()
    db.refresh(row)
    return row_to_response(row)


@router.put(
    "/scheduled-events/{scheduling_id}",
    response_model=ScheduleEventResponse,
    summary="Update a pending or conflict calendar event",
)
def update_scheduled_event(
    scheduling_id: uuid.UUID,
    payload: UpdateScheduleEventRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ScheduleEventResponse:
    """Update title, time, or attendees for a non-confirmed event."""
    row = get_user_scheduling(db, current_user.id, scheduling_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Scheduling event not found.")
    if row.status == "CONFIRMED":
        raise HTTPException(
            status_code=400,
            detail="Không thể chỉnh sửa lịch đã xác nhận. Hãy huỷ lịch trước khi tạo lại.",
        )

    if payload.title is not None:
        row.event_title = payload.title
    if payload.start_time is not None:
        row.start_datetime = payload.start_time
    if payload.end_time is not None:
        row.end_datetime = payload.end_time
    if payload.attendees is not None:
        row.attendees_json = json.dumps(payload.attendees)

    start = row.start_datetime
    end = row.end_datetime
    if start is None or end is None:
        raise HTTPException(status_code=400, detail="Lịch hẹn thiếu thời gian bắt đầu hoặc kết thúc.")
    if end <= start:
        raise HTTPException(status_code=400, detail="Thời gian kết thúc phải sau thời gian bắt đầu.")

    if row.status == "CONFLICT":
        row.status = "PENDING"
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row_to_response(row)


@router.delete(
    "/scheduled-events/{scheduling_id}",
    summary="Delete a calendar event permanently",
    description="Hard-deletes a PENDING/CONFLICT/CANCELLED row. CONFIRMED rows must use /cancel.",
)
async def delete_scheduled_event(
    scheduling_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Remove a scheduling row from the database."""
    row = get_user_scheduling(db, current_user.id, scheduling_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Scheduling event not found.")

    if row.status == "CONFIRMED":
        raise HTTPException(
            status_code=400,
            detail="Lịch đã xác nhận — dùng huỷ lịch thay vì xóa.",
        )

    db.delete(row)
    db.commit()
    return {"message": "Event deleted.", "id": str(scheduling_id)}


@router.post(
    "/scheduled-events/{scheduling_id}/resolve",
    response_model=ScheduleEventResponse,
    summary="Resolve a scheduling conflict with a new time slot",
)
def resolve_scheduled_conflict(
    scheduling_id: uuid.UUID,
    payload: ResolveScheduleConflictRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ScheduleEventResponse:
    """Apply an alternative start time and mark the row as PENDING."""
    row = get_user_scheduling(db, current_user.id, scheduling_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Scheduling event not found.")
    if row.status != "CONFLICT":
        raise HTTPException(status_code=400, detail="Lịch hẹn không ở trạng thái xung đột.")

    new_end = payload.new_end_time
    if new_end is None and row.start_datetime and row.end_datetime:
        duration = row.end_datetime - row.start_datetime
        new_end = payload.new_time + duration
    elif new_end is None:
        new_end = payload.new_time + timedelta(hours=1)

    if new_end <= payload.new_time:
        raise HTTPException(status_code=400, detail="Thời gian kết thúc phải sau thời gian bắt đầu.")

    row.start_datetime = payload.new_time
    row.end_datetime = new_end
    row.status = "PENDING"
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row_to_response(row)


@router.post(
    "/scheduled-events/{scheduling_id}/confirm",
    summary="Confirm a pending calendar event and sync to Google Calendar",
    description=(
        "Creates a Google Calendar event, persists the event ID and links, "
        "then marks the row as CONFIRMED. If Calendar API fails the DB is not mutated."
    ),
)
async def confirm_scheduled_event(
    scheduling_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    calendar_service: GoogleCalendarService = Depends(get_calendar_service),
) -> dict:
    """Create a Calendar event then mark the scheduling row as CONFIRMED."""
    row = db.get(EmailScheduling, scheduling_id)
    if row is None or row.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Scheduling event not found.")
    if row.status == "CONFIRMED":
        return {
            "message": "Event already confirmed.",
            "id": str(row.id),
            "html_link": row.google_calendar_html_link,
            "meet_link": row.google_meet_link,
        }

    start_iso = row.start_datetime.isoformat() if row.start_datetime else None
    end_iso = row.end_datetime.isoformat() if row.end_datetime else None
    if not start_iso or not end_iso:
        raise HTTPException(status_code=400, detail="Event is missing start or end time.")

    _email_re = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")
    valid_attendees = [a for a in row.attendees if _email_re.match(a)]

    try:
        result = await calendar_service.create_event(
            summary=row.event_title or "(No title)",
            start_time=start_iso,
            end_time=end_iso,
            attendees=valid_attendees or None,
            description=row.suggested_reply or None,
        )
    except CalendarServiceError as exc:
        raise HTTPException(status_code=502, detail=f"Google Calendar error: {exc}") from exc

    row.google_calendar_event_id = result.get("event_id")
    row.google_calendar_html_link = result.get("html_link")
    row.google_meet_link = result.get("meet_link")
    row.status = "CONFIRMED"
    row.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "message": "Event confirmed.",
        "id": str(row.id),
        "html_link": row.google_calendar_html_link,
        "meet_link": row.google_meet_link,
    }


@router.delete(
    "/scheduled-events/{scheduling_id}/cancel",
    summary="Cancel a confirmed calendar event",
    description="Deletes the event from Google Calendar (if synced) and marks the row as CANCELLED.",
)
async def cancel_scheduled_event(
    scheduling_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    calendar_service: GoogleCalendarService = Depends(get_calendar_service),
) -> dict:
    """Delete the Google Calendar event (if present) and mark the row CANCELLED."""
    row = db.get(EmailScheduling, scheduling_id)
    if row is None or row.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Scheduling event not found.")

    if row.google_calendar_event_id:
        try:
            await calendar_service.delete_event(row.google_calendar_event_id)
        except CalendarServiceError as exc:
            raise HTTPException(status_code=500, detail=f"Google Calendar error: {exc}") from exc

    row.status = "CANCELLED"
    row.google_calendar_event_id = None
    row.google_calendar_html_link = None
    row.google_meet_link = None
    row.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"message": "Event cancelled.", "id": str(row.id)}


class SnoozeEmailRequest(BaseModel):
    gmail_message_id: str
    thread_id: str | None = None
    subject: str | None = None
    sender: str | None = None
    snooze_until: datetime


@router.post(
    "/snooze",
    summary="Snooze an email until a given time",
    description=(
        "Persists a snooze record and schedules a one-shot APScheduler job that "
        "broadcasts a ``SNOOZED_EMAIL_DUE`` WebSocket event when the time expires."
    ),
)
async def snooze_email(
    payload: SnoozeEmailRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    from backend.core.scheduler import schedule_snooze

    if payload.snooze_until <= datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="snooze_until must be in the future.")

    row = SnoozedEmail(
        user_id=current_user.id,
        gmail_message_id=payload.gmail_message_id,
        thread_id=payload.thread_id,
        subject=payload.subject,
        sender=payload.sender,
        snooze_until=payload.snooze_until,
        status="PENDING",
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    schedule_snooze(str(row.id), row.snooze_until)

    return {
        "snooze_id": str(row.id),
        "snooze_until": row.snooze_until.isoformat(),
        "message": "Email snoozed successfully.",
    }


@router.post(
    "/classify-quick",
    response_model=list[QuickClassifyResult],
    summary="Batch classify email threads (lightweight)",
    description=(
        "Classifies a batch of threads using only subject/snippet. "
        "Results are cached in DB by thread_id — repeat calls return instantly without LLM calls."
    ),
)
async def classify_quick(
    items: list[QuickClassifyItem],
    current_user: User = Depends(get_current_user),
    classifier_agent: EmailClassifierAgent = Depends(get_classifier_agent),
    db: Session = Depends(get_db),
) -> list[QuickClassifyResult]:
    """Return cached classifications where available; classify and cache only misses."""
    if not items:
        return []

    valid_items = [item for item in items if item.thread_id]
    if not valid_items:
        return []

    thread_ids = [item.thread_id for item in valid_items]
    cached_rows = db.scalars(
        select(Classification).where(
            Classification.thread_id.in_(thread_ids),
            Classification.user_id == current_user.id,
        )
    ).all()
    # Multiple rows may share a thread_id (from per-message orchestrator runs); keep the most recent per thread.
    cache: dict[str, Classification] = {}
    for row in cached_rows:
        if row.thread_id and row.thread_id not in cache:
            cache[row.thread_id] = row

    misses = [item for item in valid_items if item.thread_id not in cache]
    if misses:
        new_results = await asyncio.gather(
            *(
                classifier_agent.classify(
                    subject=_privacy.mask(item.subject),
                    body=_privacy.mask(item.snippet or ""),
                    sender=item.sender or "",
                )
                for item in misses
            )
        )
        for item, result in zip(misses, new_results):
            existing = cache.get(item.thread_id)
            if existing:
                existing.category = result.category.value
                existing.priority_score = result.priority_score
                existing.confidence = result.confidence
            else:
                row = Classification(
                    user_id=current_user.id,
                    thread_id=item.thread_id,
                    category=result.category.value,
                    priority_score=result.priority_score,
                    confidence=result.confidence,
                )
                db.add(row)
                cache[item.thread_id] = row
        db.commit()

    return [
        QuickClassifyResult(
            thread_id=item.thread_id,
            category=cache[item.thread_id].category or "unknown",
            priority_score=cache[item.thread_id].priority_score or 0,
            confidence=cache[item.thread_id].confidence or 0.0,
        )
        for item in valid_items
        if item.thread_id in cache
    ]


# Tuneable cap — reduce to 3 if Gemini is still unstable during demo rehearsal.
MAX_PIPELINE_PER_LOAD = 5


@router.post(
    "/fetch-cached-analyses",
    response_model=dict[str, AnalyzeEmailResponse],
    summary="Batch cache lookup — returns cached AnalyzeEmailResponse entries only (no Gemini calls)",
    description=(
        "Fast DB-only lookup across email_analysis_cache keyed by (user_id, gmail_message_id). "
        "Returns only the message IDs that have a cached entry; missing keys = not yet processed. "
        "Used by the inbox loader to determine which emails skip the full pipeline."
    ),
)
def fetch_cached_analyses(
    gmail_message_ids: list[str] = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, AnalyzeEmailResponse]:
    """Return cached AnalyzeEmailResponse for each gmail_message_id that has a cache hit."""
    if not gmail_message_ids:
        return {}
    rows = db.scalars(
        select(EmailAnalysisCache).where(
            EmailAnalysisCache.gmail_message_id.in_(gmail_message_ids),
            EmailAnalysisCache.user_id == current_user.id,
        )
    ).all()
    return {
        row.gmail_message_id: AnalyzeEmailResponse.model_validate_json(row.response_json)
        for row in rows
    }
