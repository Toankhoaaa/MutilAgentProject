"""Email processing orchestrator coordinating Gmail, DB, and AI agents."""

from __future__ import annotations

import logging
import time
import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.core.websocket_manager import manager
from backend.models.agent_run import AgentRun
from backend.models.audit_log import AuditLog
from backend.models.classification import Classification
from backend.models.configuration import Configuration
from backend.models.draft import Draft
from backend.models.processing_queue import ProcessingQueue
from backend.models.user import User
from backend.schemas.agent_schemas import EmailCategory, EmailClassificationOutput
from backend.services.agents.classifier_agent import EmailClassifierAgent
from backend.services.agents.privacy_agent import PrivacyAgent
from backend.services.agents.rag_agent import RagAgent
from backend.services.agents.response_agent import EmailResponseAgent
from backend.services.gmail_service import GmailService

logger = logging.getLogger(__name__)

_AGENT_ORCHESTRATOR = "EmailOrchestrator"
_AGENT_CLASSIFIER = "ClassifierAgent"
_AGENT_RESPONSE = "ResponseAgent"
_CONFIG_KEY_AGENT_TONE = "agent_tone"
_CONFIG_KEY_USER_SIGNATURE = "user_signature"
_DEFAULT_AGENT_TONE = "professional"


class EmailOrchestrator:
    """
    Coordinates the end-to-end email ingestion and multi-agent processing pipeline.

    Flow: Fetch -> Filter/Save -> Classify -> Conditional Draft -> Mark Processed.
    Each per-email step is audit-logged; failures are isolated per message.
    """

    def __init__(
        self,
        db: Session,
        gmail_service: GmailService | None,
        classifier_agent: EmailClassifierAgent,
        response_agent: EmailResponseAgent,
        user_id: uuid.UUID | None = None,
        raw_emails: list[dict[str, Any]] | None = None,
        privacy_agent: PrivacyAgent | None = None,
        rag_agent: RagAgent | None = None,
    ) -> None:
        self._db = db
        self._gmail = gmail_service
        self._classifier = classifier_agent
        self._response = response_agent
        self._user_id = user_id
        self._raw_emails: list[dict[str, Any]] = raw_emails or []
        self._privacy = privacy_agent or PrivacyAgent()
        self._rag = rag_agent or RagAgent()

    async def process_new_emails(self, limit: int = 5) -> dict[str, Any]:
        """
        Run the full business workflow for newly fetched unread emails.

        Args:
            limit: Maximum number of unread Gmail messages to fetch.

        Returns:
            Summary dict with counts, ``run_id``, and batch timing metrics.
        """
        summary: dict[str, Any] = {
            "fetched": 0,
            "processed": 0,
            "skipped_duplicate": 0,
            "failed": 0,
            "drafts_created": 0,
            "errors": [],
            "run_id": None,
            "llm_calls_count": 0,
            "llm_total_time_ms": 0,
            "total_time_ms": 0,
        }

        batch_started = time.monotonic()
        llm_calls_count = 0
        llm_total_time_ms = 0
        agent_run: AgentRun | None = None
        batch_error: str | None = None

        try:
            user_id = self._resolve_user_id()
            agent_run = self._start_agent_run(triggered_by="SYSTEM")
            summary["run_id"] = str(agent_run.id)
            self._db.commit()

            raw_emails: list[dict[str, Any]] = self._raw_emails or []
            summary["fetched"] = len(raw_emails)

            self._audit(
                user_id=user_id,
                email_id=None,
                agent_name=_AGENT_ORCHESTRATOR,
                action="fetch_emails",
                status="success",
                details={"count": len(raw_emails), "limit": limit, "run_id": str(agent_run.id)},
            )
            self._db.commit()

            for raw_email in raw_emails:
                gmail_message_id = raw_email.get("gmail_message_id", "")
                email_id = uuid.uuid4()

                try:
                    raw_email = self._privacy.mask_email_dict(raw_email)
                    classification_output, classify_ms = await self._classify_email(raw_email)
                    llm_calls_count += 1
                    llm_total_time_ms += classify_ms or 0
                    self._save_classification(email_id, classification_output, classify_ms)

                    self._audit(
                        user_id=user_id,
                        email_id=email_id,
                        agent_name=_AGENT_CLASSIFIER,
                        action="classify_email",
                        status="success",
                        details={
                            "category": classification_output.category.value,
                            "priority_score": classification_output.priority_score,
                            "confidence": classification_output.confidence,
                        },
                    )

                    if classification_output.category == EmailCategory.URGENT:
                        await manager.broadcast(
                            {
                                "type": "NEW_URGENT_EMAIL",
                                "subject": raw_email.get("subject"),
                                "summary": classification_output.summary,
                            }
                        )

                    if EmailResponseAgent.is_eligible(classification_output.category):
                        rag_context = self._rag.retrieve(
                            raw_email.get("body") or raw_email.get("snippet") or ""
                        )
                        draft_gmail_id, draft_ms = await self._draft_and_save(
                            user_id=user_id,
                            email_id=email_id,
                            raw_email=raw_email,
                            classification=classification_output,
                            rag_context=rag_context,
                        )
                        llm_calls_count += 1
                        llm_total_time_ms += draft_ms or 0
                        summary["drafts_created"] += 1
                        self._audit(
                            user_id=user_id,
                            email_id=email_id,
                            agent_name=_AGENT_RESPONSE,
                            action="create_draft",
                            status="success",
                            details={
                                "category": classification_output.category.value,
                                "draft_gmail_id": draft_gmail_id,
                            },
                        )
                    else:
                        self._audit(
                            user_id=user_id,
                            email_id=email_id,
                            agent_name=_AGENT_ORCHESTRATOR,
                            action="skip_auto_reply",
                            status="skipped",
                            details={"category": classification_output.category.value},
                        )

                    self._db.commit()
                    summary["processed"] += 1

                except Exception as exc:
                    logger.exception(
                        "Failed to process email %s: %s",
                        gmail_message_id,
                        exc,
                    )
                    self._db.rollback()

                    self._audit(
                        user_id=user_id,
                        email_id=email_id,
                        agent_name=_AGENT_ORCHESTRATOR,
                        action="process_email",
                        status="failed",
                        details={
                            "gmail_message_id": gmail_message_id,
                            "error": str(exc),
                            "error_type": type(exc).__name__,
                        },
                    )
                    self._upsert_processing_queue_failure(
                        user_id=user_id,
                        gmail_message_id=gmail_message_id,
                        error=str(exc),
                    )
                    self._db.commit()

                    summary["failed"] += 1
                    summary["errors"].append(
                        {"gmail_message_id": gmail_message_id, "error": str(exc)}
                    )

            final_status = "FAILED" if summary["failed"] > 0 and summary["processed"] == 0 else "COMPLETED"
            if summary["failed"] > 0 and summary["processed"] > 0:
                final_status = "COMPLETED"

            summary["llm_calls_count"] = llm_calls_count
            summary["llm_total_time_ms"] = llm_total_time_ms
            summary["total_time_ms"] = int((time.monotonic() - batch_started) * 1000)

            self._finalize_agent_run(
                agent_run=agent_run,
                status=final_status,
                total_emails_processed=summary["processed"],
                total_time_ms=summary["total_time_ms"],
                llm_calls_count=llm_calls_count,
                llm_total_time_ms=llm_total_time_ms,
                error_message=(
                    f"{summary['failed']} email(s) failed during batch processing."
                    if summary["failed"] > 0
                    else None
                ),
            )
            self._db.commit()

        except Exception as exc:
            batch_error = str(exc)
            logger.exception("Batch processing failed critically: %s", exc)
            self._db.rollback()

            if agent_run is not None:
                summary["total_time_ms"] = int((time.monotonic() - batch_started) * 1000)
                summary["llm_calls_count"] = llm_calls_count
                summary["llm_total_time_ms"] = llm_total_time_ms
                self._finalize_agent_run(
                    agent_run=agent_run,
                    status="FAILED",
                    total_emails_processed=summary["processed"],
                    total_time_ms=summary["total_time_ms"],
                    llm_calls_count=llm_calls_count,
                    llm_total_time_ms=llm_total_time_ms,
                    error_message=batch_error,
                )
                self._db.commit()

            summary["errors"].append({"batch_error": batch_error})
            raise

        return summary

    async def process_one_stateless(
        self, raw_email: dict[str, Any]
    ) -> dict[str, Any]:
        """Classify a single email and optionally draft a reply with no DB writes."""
        raw_email = self._privacy.mask_email_dict(raw_email)
        classification, _ = await self._classify_email(raw_email)
        result: dict[str, Any] = {
            "category": classification.category.value,
            "priority_score": classification.priority_score,
            "summary": classification.summary,
            "confidence": classification.confidence,
            "draft_content": None,
            "draft_subject": None,
        }

        if EmailResponseAgent.is_eligible(classification.category):
            tone, signature = self._load_agent_customization()
            rag_context = self._rag.retrieve(
                raw_email.get("body") or raw_email.get("snippet") or ""
            )
            reply = await self._response.draft_reply(
                email_subject=raw_email.get("subject") or "",
                email_body=raw_email.get("body") or "",
                classification=classification,
                tone=tone,
                signature=signature,
                rag_context=rag_context,
            )
            result["draft_content"] = reply.body_content
            result["draft_subject"] = reply.subject

        return result

    def _resolve_user_id(self) -> uuid.UUID:
        """Return the configured or first active user id for mailbox ownership."""
        if self._user_id is not None:
            return self._user_id

        user = self._db.scalar(select(User).where(User.is_active.is_(True)).limit(1))
        if user is not None:
            self._user_id = user.id
            return user.id

        bootstrap = User(
            email="orchestrator@local",
            display_name="Default Orchestrator User",
            is_active=True,
        )
        self._db.add(bootstrap)
        self._db.flush()
        self._user_id = bootstrap.id
        logger.warning("Created bootstrap user %s for orchestrator processing.", bootstrap.email)
        return bootstrap.id

    async def _classify_email(
        self,
        raw_email: dict[str, Any],
    ) -> tuple[EmailClassificationOutput, int | None]:
        """Invoke the classifier agent and measure elapsed time."""
        started = time.monotonic()
        result = await self._classifier.classify(
            subject=raw_email.get("subject") or "",
            body=raw_email.get("body") or raw_email.get("snippet") or "",
            sender=raw_email.get("sender"),
        )
        elapsed_ms = int((time.monotonic() - started) * 1000)
        return result, elapsed_ms

    def _save_classification(
        self,
        email_id: uuid.UUID,
        output: EmailClassificationOutput,
        processing_time_ms: int | None,
    ) -> Classification:
        """Persist classification results linked to an email."""
        classification = Classification(
            email_id=email_id,
            category=output.category.value,
            priority_score=output.priority_score,
            summary=output.summary,
            deadline=self._parse_deadline(output.deadline),
            confidence=output.confidence,
            raw_response=output.model_dump(mode="json"),
            processing_time_ms=processing_time_ms,
            fallback_used=False,
        )
        self._db.add(classification)
        return classification

    def _start_agent_run(self, triggered_by: str = "SYSTEM") -> AgentRun:
        """Create a RUNNING batch record in ``agent_runs``."""
        run = AgentRun(
            run_type="BATCH_PROCESSING",
            triggered_by=triggered_by,
            status="RUNNING",
            started_at=datetime.now(timezone.utc),
        )
        self._db.add(run)
        self._db.flush()
        return run

    def _finalize_agent_run(
        self,
        agent_run: AgentRun,
        status: str,
        total_emails_processed: int,
        total_time_ms: int,
        llm_calls_count: int,
        llm_total_time_ms: int,
        error_message: str | None = None,
    ) -> None:
        """Update the batch ``agent_runs`` record when processing ends."""
        agent_run.status = status
        agent_run.total_emails_processed = total_emails_processed
        agent_run.total_time_ms = total_time_ms
        agent_run.llm_calls_count = llm_calls_count
        agent_run.llm_total_time_ms = llm_total_time_ms
        agent_run.error_message = error_message
        agent_run.ended_at = datetime.now(timezone.utc)

    async def _draft_and_save(
        self,
        user_id: uuid.UUID,
        email_id: uuid.UUID,
        raw_email: dict[str, Any],
        classification: EmailClassificationOutput,
        rag_context: str = "",
    ) -> tuple[str, int]:
        started = time.monotonic()
        tone, signature = self._load_agent_customization()

        reply = await self._response.draft_reply(
            email_subject=raw_email.get("subject") or "",
            email_body=raw_email.get("body") or raw_email.get("snippet") or "",
            classification=classification,
            tone=tone,
            signature=signature,
            rag_context=rag_context,
        )

        sender = raw_email.get("sender") or ""
        if not sender:
            raise ValueError("Cannot create draft: original sender address is missing.")

        draft_gmail_id = await self._gmail.create_draft(
            to=sender,
            subject=reply.subject,
            body=reply.body_content,
            thread_id=raw_email.get("thread_id"),
        )

        elapsed_ms = int((time.monotonic() - started) * 1000)
        draft_record = Draft(
            email_id=email_id,
            draft_content=reply.body_content,
            draft_gmail_id=draft_gmail_id,
            subject=reply.subject,
            is_modified=False,
            is_sent=False,
            processing_time_ms=elapsed_ms,
        )
        self._db.add(draft_record)

        self._audit(
            user_id=user_id,
            email_id=email_id,
            agent_name=_AGENT_RESPONSE,
            action="compose_reply",
            status="success",
            details={"subject": reply.subject},
        )

        return draft_gmail_id, elapsed_ms

    def _load_agent_customization(self) -> tuple[str, str]:
        """Load agent tone and user signature from ``configurations``."""
        tone_row = self._db.get(Configuration, _CONFIG_KEY_AGENT_TONE)
        signature_row = self._db.get(Configuration, _CONFIG_KEY_USER_SIGNATURE)

        tone = (tone_row.value if tone_row and tone_row.value else _DEFAULT_AGENT_TONE)
        signature = (signature_row.value if signature_row and signature_row.value else "")
        return tone, signature

    def _audit(
        self,
        user_id: uuid.UUID | None,
        email_id: uuid.UUID | None,
        agent_name: str,
        action: str,
        status: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        """Insert an audit log entry for observability."""
        log_entry = AuditLog(
            user_id=user_id,
            email_id=email_id,
            agent_name=agent_name,
            action=action,
            status=status,
            details=details,
        )
        self._db.add(log_entry)

    def _upsert_processing_queue_failure(
        self,
        user_id: uuid.UUID,
        gmail_message_id: str,
        error: str,
    ) -> None:
        """Record or update a failed item in the processing queue."""
        existing = self._db.scalar(
            select(ProcessingQueue).where(
                ProcessingQueue.gmail_message_id == gmail_message_id
            )
        )

        if existing is not None:
            existing.status = "failed"
            existing.last_error = error
            existing.retry_count = (existing.retry_count or 0) + 1
            existing.processed_at = datetime.now(timezone.utc)
            return

        queue_item = ProcessingQueue(
            gmail_message_id=gmail_message_id,
            user_id=user_id,
            status="failed",
            priority=1,
            retry_count=1,
            last_error=error,
            processed_at=datetime.now(timezone.utc),
        )
        self._db.add(queue_item)

    @staticmethod
    def _parse_deadline(deadline: str | date | None) -> date | None:
        """Normalize classifier deadline into a date for database storage."""
        if deadline is None:
            return None
        if isinstance(deadline, date) and not isinstance(deadline, datetime):
            return deadline
        if isinstance(deadline, datetime):
            return deadline.date()

        text = str(deadline).strip().lower()
        if text in {"", "none", "null", "unknown", "today", "tomorrow"}:
            return None

        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None
