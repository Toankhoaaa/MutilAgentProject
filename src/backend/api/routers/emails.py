"""FastAPI router for email pipeline operations (stateless)."""

from __future__ import annotations

import asyncio
import logging
import uuid

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel

from backend.api.auth_dependencies import get_current_user
from backend.api.dependencies import (
    check_quota,
    get_classifier_agent,
    get_db,
    get_gmail_service,
    get_response_agent,
    increment_request_count,
)
from backend.core import task_manager
from backend.models.user import User
from backend.schemas.agent_schemas import EmailCategory
from backend.schemas.api_schemas import (
    ProcessEmailRequest,
    ProcessEmailResult,
    ProcessEmailsResponse,
)
from backend.services.agents import (
    EmailClassifierAgent,
    EmailResponseAgent,
)
from backend.services.gmail_service import GmailAPIError, GmailAuthenticationError, GmailService
from backend.services.orchestrator import EmailOrchestrator
from sqlalchemy.orm import Session

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
        result = await orchestrator.process_one_stateless(raw_email)
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
