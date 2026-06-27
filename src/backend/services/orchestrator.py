"""Email processing orchestrator coordinating Gmail, DB, and AI agents."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.core import task_manager
from backend.core.websocket_manager import manager
from backend.models.agent_run import AgentRun
from backend.models.audit_log import AuditLog
from backend.models.classification import Classification
from backend.models.configuration import Configuration
from backend.models.task import Task as _TaskModel
from backend.models.user import User
from backend.schemas.agent_schemas import EmailCategory, EmailClassificationOutput, SchedulingOutput, SecurityAnalysisOutput
from backend.models.email_rule import EmailRule
from backend.services.agents.classifier_agent import EmailClassifierAgent
from backend.services.agents.privacy_agent import PrivacyAgent
from backend.services.agents.rag_agent import RagAgent
from backend.services.agents.response_agent import EmailResponseAgent, ResponseAgentSkippedError
from backend.services.agents.scheduling_agent import EmailSchedulingAgent
from backend.services.agents.analysis_agent import EmailAnalysisAgent
from backend.services.agents.security_agent import EmailSecurityAgent
from backend.services.calendar_service import CalendarAPIError, GoogleCalendarService
from backend.services.gmail_service import GmailService
from backend.services.rule_engine import RuleEngine

logger = logging.getLogger(__name__)

_AGENT_ORCHESTRATOR = "EmailOrchestrator"
_AGENT_CLASSIFIER = "ClassifierAgent"
_AGENT_RESPONSE = "ResponseAgent"
_AGENT_SCHEDULING = "SchedulingAgent"
_AGENT_RULE_ENGINE = "RuleEngine"
_AGENT_SECURITY = "SecurityAgent"
_CONFIG_KEY_AGENT_TONE = "agent_tone"
_CONFIG_KEY_USER_SIGNATURE = "user_signature"
_DEFAULT_AGENT_TONE = "professional"

_AGENT_TASK_SUGGESTOR = "TaskSuggestor"
_TASK_ELIGIBLE_CATEGORIES: frozenset = frozenset({
    EmailCategory.URGENT,
    EmailCategory.NEED_REPLY,
    EmailCategory.IMPORTANT,
})
_TASK_MIN_CONFIDENCE: float = 0.7
_TASK_MIN_ITEM_LEN: int = 5
_TASK_MAX_PER_EMAIL: int = 5


class EmailOrchestrator:
    """
    Coordinates the end-to-end email processing pipeline.

    Stateless: emails are fetched, classified, and drafted in memory only.
    AgentRun and AuditLog entries are still persisted for observability.
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
        scheduling_agent: EmailSchedulingAgent | None = None,
        calendar_service: GoogleCalendarService | None = None,
        task_id: str | None = None,
        security_agent: EmailSecurityAgent | None = None,
        analysis_agent: EmailAnalysisAgent | None = None,
    ) -> None:
        self._db = db
        self._gmail = gmail_service
        self._classifier = classifier_agent
        self._response = response_agent
        self._user_id = user_id
        self._raw_emails: list[dict[str, Any]] = raw_emails or []
        self._privacy = privacy_agent or PrivacyAgent()
        self._rag = rag_agent or RagAgent()
        self._scheduling = scheduling_agent
        self._calendar = calendar_service
        self._task_id = task_id
        self._rule_engine = RuleEngine()
        self._security = security_agent or EmailSecurityAgent()
        self._analysis = analysis_agent or EmailAnalysisAgent()

    async def process_new_emails(self, limit: int = 5) -> dict[str, Any]:
        """
        Fetch unread emails from Gmail, classify them, and create Gmail drafts.

        No email content is persisted to the database. Only AgentRun and AuditLog
        entries are written for observability.
        """
        summary: dict[str, Any] = {
            "fetched": 0,
            "processed": 0,
            "skipped_duplicate": 0,
            "failed": 0,
            "drafts_created": 0,
            "scheduled_events": [],
            "scheduling_conflicts": [],
            "errors": [],
            "run_id": None,
            "llm_calls_count": 0,
            "llm_total_time_ms": 0,
            "total_time_ms": 0,
            "processed_emails": [],
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

            if self._raw_emails:
                raw_emails = self._raw_emails
            elif self._gmail is not None:
                raw_emails = await self._gmail.fetch_unread_emails(limit=limit)
            else:
                raw_emails = []
            summary["fetched"] = len(raw_emails)

            self._audit(
                user_id=user_id,
                agent_name=_AGENT_ORCHESTRATOR,
                action="fetch_emails",
                status="success",
                details={"count": len(raw_emails), "limit": limit, "run_id": str(agent_run.id)},
            )
            self._db.commit()

            user_rules = self._db.scalars(
                select(EmailRule)
                .where(EmailRule.user_id == user_id, EmailRule.is_active.is_(True))
            ).all()

            for raw_email in raw_emails:
                gmail_message_id = raw_email.get("gmail_message_id", "")

                try:
                    self._check_cancelled()
                    raw_email = self._privacy.mask_email_dict(raw_email)

                    security_result: SecurityAnalysisOutput = await self._security.analyze(
                        email_subject=raw_email.get("subject") or "",
                        email_body=raw_email.get("body") or raw_email.get("snippet") or "",
                        sender=raw_email.get("sender"),
                    )
                    security_blocked = security_result.risk_level == "high" or not security_result.is_safe
                    if security_blocked:
                        await manager.broadcast(
                            {
                                "type": "SECURITY_ALERT",
                                "risk_level": "high",
                                "warnings": security_result.warnings,
                            },
                            target_user_id=user_id,
                        )
                        self._audit(
                            user_id=user_id,
                            agent_name=_AGENT_SECURITY,
                            action="security_check",
                            status="blocked",
                            details={
                                "gmail_message_id": gmail_message_id,
                                "risk_level": security_result.risk_level,
                                "is_safe": security_result.is_safe,
                                "warnings": security_result.warnings,
                            },
                        )
                    elif security_result.risk_level == "medium":
                        self._audit(
                            user_id=user_id,
                            agent_name=_AGENT_SECURITY,
                            action="security_check",
                            status="warning",
                            details={
                                "gmail_message_id": gmail_message_id,
                                "risk_level": security_result.risk_level,
                                "warnings": security_result.warnings,
                            },
                        )

                    skip_draft = False
                    rule_match = None
                    # Security block has absolute precedence over user rules.
                    if not security_blocked:
                        rule_match = self._rule_engine.evaluate(raw_email, list(user_rules))

                        if rule_match is not None:
                            self._audit(
                                user_id=user_id,
                                agent_name=_AGENT_RULE_ENGINE,
                                action="rule_matched",
                                status="success",
                                details={
                                    "gmail_message_id": gmail_message_id,
                                    "rule_id": str(rule_match.rule.id),
                                    "rule_name": rule_match.rule.name,
                                    "action": rule_match.action,
                                },
                            )
                            if rule_match.action == "trash":
                                if self._gmail is not None and gmail_message_id:
                                    await self._gmail.trash_message(gmail_message_id)
                                self._db.commit()
                                summary["processed"] += 1
                                summary["processed_emails"].append({
                                    "gmail_message_id": gmail_message_id,
                                    "subject": raw_email.get("subject"),
                                    "sender": raw_email.get("sender"),
                                    "category": "trashed_by_rule",
                                    "priority_score": None,
                                    "summary": None,
                                    "confidence": None,
                                    "draft_subject": None,
                                    "has_draft": False,
                                })
                                continue
                            elif rule_match.action == "skip_ai":
                                self._db.commit()
                                summary["processed"] += 1
                                summary["processed_emails"].append({
                                    "gmail_message_id": gmail_message_id,
                                    "subject": raw_email.get("subject"),
                                    "sender": raw_email.get("sender"),
                                    "category": "skipped_by_rule",
                                    "priority_score": None,
                                    "summary": None,
                                    "confidence": None,
                                    "draft_subject": None,
                                    "has_draft": False,
                                })
                                continue
                            elif rule_match.action == "alert":
                                await manager.broadcast(
                                    {
                                        "type": "NEW_URGENT_EMAIL",
                                        "subject": raw_email.get("subject"),
                                        "summary": rule_match.action_value or "Alert triggered by email rule.",
                                    },
                                    target_user_id=user_id,
                                )
                            elif rule_match.action == "skip_draft":
                                skip_draft = True

                    self._check_cancelled()
                    _forced_by_rule = rule_match is not None and rule_match.action == "force_category"
                    _from_cache = False
                    if security_blocked:
                        classification_output = EmailClassificationOutput.model_construct(
                            category=EmailCategory.SPAM,
                            priority_score=1,
                            summary="Email flagged as high-risk threat by security agent.",
                            deadline=None,
                            confidence=1.0,
                        )
                        skip_draft = True
                    elif _forced_by_rule:
                        raw_category = rule_match.action_value or "important"
                        try:
                            forced_cat = EmailCategory(raw_category)
                        except ValueError:
                            forced_cat = EmailCategory.IMPORTANT
                        classification_output = EmailClassificationOutput.model_construct(
                            category=forced_cat,
                            priority_score=3,
                            summary="Categorized by email rule engine.",
                            deadline=None,
                            confidence=1.0,
                        )
                    else:
                        _cached_cls = (
                            self._db.scalar(
                                select(Classification).where(
                                    Classification.gmail_message_id == gmail_message_id,
                                    Classification.user_id == user_id,
                                )
                            ) if gmail_message_id else None
                        )
                        if _cached_cls:
                            try:
                                _cached_cat = EmailCategory(_cached_cls.category)
                            except (ValueError, TypeError):
                                _cached_cat = EmailCategory.IMPORTANT
                            classification_output = EmailClassificationOutput.model_construct(
                                category=_cached_cat,
                                priority_score=_cached_cls.priority_score or 0,
                                summary=_cached_cls.summary or "",
                                deadline=None,
                                confidence=_cached_cls.confidence or 0.0,
                            )
                            _from_cache = True
                            logger.debug("classify cache hit (batch): gmail_message_id=%s", gmail_message_id)
                        else:
                            classification_output, classify_ms = await self._classify_email(raw_email)
                            llm_calls_count += 1
                            llm_total_time_ms += classify_ms or 0

                    _audit_source: dict = {}
                    if _forced_by_rule:
                        _audit_source = {"source": "rule_engine"}
                    elif _from_cache:
                        _audit_source = {"source": "cache"}
                    self._audit(
                        user_id=user_id,
                        agent_name=_AGENT_CLASSIFIER,
                        action="classify_email",
                        status="success",
                        details={
                            "gmail_message_id": gmail_message_id,
                            "category": classification_output.category.value,
                            "priority_score": classification_output.priority_score,
                            "confidence": classification_output.confidence,
                            **_audit_source,
                        },
                    )

                    thread_id = raw_email.get("thread_id") or ""
                    if not _from_cache:
                        self._upsert_classification(gmail_message_id, thread_id, classification_output)

                    self._check_cancelled()
                    scheduling_result = await self._handle_scheduling(raw_email, user_id, security_blocked=security_blocked)
                    if scheduling_result:
                        result_status = scheduling_result["status"]
                        if result_status == "scheduled":
                            summary["scheduled_events"].append(
                                {"gmail_message_id": gmail_message_id, **scheduling_result["payload"]}
                            )
                        elif result_status == "conflict":
                            summary["scheduling_conflicts"].append(
                                {
                                    "gmail_message_id": gmail_message_id,
                                    "alternatives": scheduling_result.get("alternatives", []),
                                }
                            )
                        self._db.commit()

                    if classification_output.category == EmailCategory.URGENT:
                        await manager.broadcast(
                            {
                                "type": "NEW_URGENT_EMAIL",
                                "subject": raw_email.get("subject"),
                                "summary": classification_output.summary,
                            },
                            target_user_id=user_id,
                        )

                    email_detail: dict[str, Any] = {
                        "gmail_message_id": gmail_message_id,
                        "subject": raw_email.get("subject"),
                        "sender": raw_email.get("sender"),
                        "category": classification_output.category.value,
                        "priority_score": classification_output.priority_score,
                        "summary": classification_output.summary,
                        "confidence": classification_output.confidence,
                        "draft_subject": None,
                        "has_draft": False,
                        "is_safe": security_result.is_safe,
                        "security_risk_level": security_result.risk_level,
                        "security_warnings": security_result.warnings,
                    }

                    self._check_cancelled()
                    if not skip_draft and EmailResponseAgent.is_eligible(classification_output.category):
                        rag_context = self._rag.retrieve(
                            raw_email.get("body") or raw_email.get("snippet") or "",
                            user_id=str(self._user_id) if self._user_id else None,
                        )
                        try:
                            draft_gmail_id, draft_subject, draft_ms = await self._create_draft(
                                raw_email=raw_email,
                                classification=classification_output,
                                rag_context=rag_context,
                            )
                            llm_calls_count += 1
                            llm_total_time_ms += draft_ms or 0
                            summary["drafts_created"] += 1
                            email_detail["has_draft"] = True
                            email_detail["draft_subject"] = draft_subject
                            self._audit(
                                user_id=user_id,
                                agent_name=_AGENT_RESPONSE,
                                action="create_draft",
                                status="success",
                                details={
                                    "gmail_message_id": gmail_message_id,
                                    "category": classification_output.category.value,
                                    "draft_gmail_id": draft_gmail_id,
                                },
                            )
                        except Exception as draft_exc:
                            logger.warning(
                                "Draft creation failed for %s: %s — email processed without draft.",
                                gmail_message_id,
                                draft_exc,
                            )
                            self._audit(
                                user_id=user_id,
                                agent_name=_AGENT_RESPONSE,
                                action="create_draft",
                                status="failed",
                                details={
                                    "gmail_message_id": gmail_message_id,
                                    "error": str(draft_exc),
                                },
                            )
                    else:
                        self._audit(
                            user_id=user_id,
                            agent_name=_AGENT_ORCHESTRATOR,
                            action="skip_auto_reply",
                            status="skipped",
                            details={
                                "gmail_message_id": gmail_message_id,
                                "category": classification_output.category.value,
                            },
                        )

                    self._db.commit()

                    # ── Suggest tasks (best-effort — never breaks pipeline) ──────────
                    try:
                        tasks_n = await self._suggest_tasks_for_email(
                            raw_email=raw_email,
                            classification=classification_output,
                            user_id=user_id,
                        )
                        if tasks_n > 0:
                            self._db.commit()
                    except Exception as task_exc:
                        logger.warning(
                            "Task suggestion failed for %s: %s — pipeline continues.",
                            gmail_message_id,
                            task_exc,
                        )
                        self._db.rollback()

                    summary["processed"] += 1
                    summary["processed_emails"].append(email_detail)

                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.exception("Failed to process email %s: %s", gmail_message_id, exc)
                    self._db.rollback()

                    self._audit(
                        user_id=user_id,
                        agent_name=_AGENT_ORCHESTRATOR,
                        action="process_email",
                        status="failed",
                        details={
                            "gmail_message_id": gmail_message_id,
                            "error": str(exc),
                            "error_type": type(exc).__name__,
                        },
                    )
                    self._db.commit()

                    summary["failed"] += 1
                    summary["errors"].append(
                        {"gmail_message_id": gmail_message_id, "error": str(exc)}
                    )

            final_status = "FAILED" if summary["failed"] > 0 and summary["processed"] == 0 else "COMPLETED"

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
        self, raw_email: dict[str, Any], tone_override: str | None = None, force_draft: bool = False
    ) -> dict[str, Any]:
        """Classify a single email and optionally draft a reply.

        Email content is not persisted. AuditLog entries are written for observability.
        """
        self._check_cancelled()
        raw_email = self._privacy.mask_email_dict(raw_email)

        security_result: SecurityAnalysisOutput = await self._security.analyze(
            email_subject=raw_email.get("subject") or "",
            email_body=raw_email.get("body") or raw_email.get("snippet") or "",
            sender=raw_email.get("sender"),
        )
        security_blocked = security_result.risk_level == "high" or not security_result.is_safe

        if security_blocked:
            self._audit(
                user_id=self._user_id,
                agent_name=_AGENT_SECURITY,
                action="security_check",
                status="blocked",
                details={
                    "subject": raw_email.get("subject"),
                    "sender": raw_email.get("sender"),
                    "risk_level": security_result.risk_level,
                    "is_safe": security_result.is_safe,
                    "warnings": security_result.warnings,
                },
            )
        elif security_result.risk_level == "medium":
            self._audit(
                user_id=self._user_id,
                agent_name=_AGENT_SECURITY,
                action="security_check",
                status="warning",
                details={
                    "subject": raw_email.get("subject"),
                    "sender": raw_email.get("sender"),
                    "risk_level": security_result.risk_level,
                    "warnings": security_result.warnings,
                },
            )

        self._check_cancelled()
        if security_blocked:
            classification, _ = EmailClassificationOutput.model_construct(
                category=EmailCategory.SPAM,
                priority_score=1,
                summary="Email flagged as high-risk threat by security agent.",
                deadline=None,
                confidence=1.0,
            ), None
        else:
            classification, _ = await self._classify_email(raw_email)

        self._audit(
            user_id=self._user_id,
            agent_name=_AGENT_CLASSIFIER,
            action="classify_email",
            status="success",
            details={
                "subject": raw_email.get("subject"),
                "category": classification.category.value,
                "priority_score": classification.priority_score,
                "confidence": classification.confidence,
                "security_blocked": security_blocked,
            },
        )

        result: dict[str, Any] = {
            "category": classification.category.value,
            "priority_score": classification.priority_score,
            "summary": classification.summary,
            "confidence": classification.confidence,
            "draft_content": None,
            "draft_subject": None,
            "is_safe": security_result.is_safe,
            "security_risk_level": security_result.risk_level,
            "security_warnings": security_result.warnings,
        }

        self._check_cancelled()
        if force_draft or EmailResponseAgent.is_eligible(classification.category):
            tone, signature = self._load_agent_customization()
            if tone_override:
                tone = tone_override
            rag_context = self._rag.retrieve(
                raw_email.get("body") or raw_email.get("snippet") or "",
                user_id=str(self._user_id) if self._user_id else None,
            )
            try:
                reply = await self._response.draft_reply(
                    email_subject=raw_email.get("subject") or "",
                    email_body=raw_email.get("body") or "",
                    classification=classification,
                    tone=tone,
                    signature=signature,
                    rag_context=rag_context,
                    on_demand=force_draft,
                )
                result["draft_content"] = reply.body_content
                result["draft_subject"] = reply.subject
                self._audit(
                    user_id=self._user_id,
                    agent_name=_AGENT_RESPONSE,
                    action="create_draft",
                    status="success",
                    details={
                        "subject": raw_email.get("subject"),
                        "category": classification.category.value,
                        "draft_subject": reply.subject,
                    },
                )
            except ResponseAgentSkippedError as exc:
                logger.info("Response agent skipped (auto pipeline): %s", exc)
                self._audit(
                    user_id=self._user_id,
                    agent_name=_AGENT_RESPONSE,
                    action="skip_auto_reply",
                    status="skipped",
                    details={
                        "subject": raw_email.get("subject"),
                        "category": classification.category.value,
                        "reason": str(exc),
                    },
                )
        else:
            self._audit(
                user_id=self._user_id,
                agent_name=_AGENT_ORCHESTRATOR,
                action="skip_auto_reply",
                status="skipped",
                details={
                    "subject": raw_email.get("subject"),
                    "category": classification.category.value,
                },
            )

        self._db.commit()
        return result

    async def _handle_scheduling(
        self,
        raw_email: dict[str, Any],
        user_id: uuid.UUID,
        security_blocked: bool = False,
    ) -> dict[str, Any] | None:
        """
        Run the scheduling sub-pipeline for one email.

        Returns a dict with "status" and either "payload" (free slot) or
        "alternatives" (conflict), or None when not a meeting request.
        """
        if self._scheduling is None or self._calendar is None:
            return None
        if security_blocked:
            return None

        subject = raw_email.get("subject") or ""
        body = raw_email.get("body") or raw_email.get("snippet") or ""
        sender = raw_email.get("sender") or ""
        gmail_message_id = raw_email.get("gmail_message_id") or ""

        try:
            sched_output: SchedulingOutput = await asyncio.wait_for(
                self._scheduling.extract_schedule(subject, body, sender),
                timeout=30.0,
            )
        except asyncio.TimeoutError:
            logger.warning("Scheduling extraction timed out for %s", gmail_message_id)
            return None
        except Exception as exc:
            logger.warning("Scheduling extraction failed for %s: %s", gmail_message_id, exc)
            return None

        if not sched_output.is_meeting_request or sched_output.action is None:
            return None

        action = sched_output.action
        self._audit(
            user_id=user_id,
            agent_name=_AGENT_SCHEDULING,
            action="extract_schedule",
            status="success",
            details={
                "gmail_message_id": gmail_message_id,
                "start_datetime": sched_output.start_datetime,
                "end_datetime": sched_output.end_datetime,
                "event_summary": sched_output.event_summary,
            },
        )

        try:
            is_free: bool = await asyncio.wait_for(
                self._calendar.check_free_busy(action.start_time, action.end_time),
                timeout=10.0,
            )
        except asyncio.TimeoutError:
            logger.warning("Calendar free/busy check timed out for %s", gmail_message_id)
            self._audit(
                user_id=user_id,
                agent_name=_AGENT_SCHEDULING,
                action="check_free_busy",
                status="timeout",
                details=None,
            )
            return {"status": "timeout"}
        except CalendarAPIError as exc:
            logger.warning("Calendar API error for %s: %s", gmail_message_id, exc)
            self._audit(
                user_id=user_id,
                agent_name=_AGENT_SCHEDULING,
                action="check_free_busy",
                status="error",
                details={"error": str(exc)},
            )
            return {"status": "calendar_error", "error": str(exc)}

        if is_free:
            payload = {
                "summary": sched_output.event_summary or subject,
                "start_time": action.start_time.isoformat(),
                "end_time": action.end_time.isoformat(),
                "attendees": action.attendees,
                "description": sched_output.suggested_reply,
            }
            self._audit(
                user_id=user_id,
                agent_name=_AGENT_SCHEDULING,
                action="slot_available",
                status="success",
                details={"start_time": payload["start_time"], "end_time": payload["end_time"]},
            )
            return {"status": "scheduled", "payload": payload}

        self._audit(
            user_id=user_id,
            agent_name=_AGENT_SCHEDULING,
            action="slot_conflict",
            status="conflict",
            details={
                "start_time": action.start_time.isoformat(),
                "end_time": action.end_time.isoformat(),
            },
        )

        try:
            alternatives = await asyncio.wait_for(
                self._scheduling.suggest_alternatives(
                    email_subject=subject,
                    email_body=body,
                    busy_start=action.start_time,
                    busy_end=action.end_time,
                ),
                timeout=30.0,
            )
        except asyncio.TimeoutError:
            logger.warning("Alternative slot suggestion timed out for %s", gmail_message_id)
            alternatives = []
        except Exception as exc:
            logger.warning("Alternative slot suggestion failed for %s: %s", gmail_message_id, exc)
            alternatives = []

        return {"status": "conflict", "alternatives": alternatives}

    def _resolve_user_id(self) -> uuid.UUID:
        """Return the configured or first active user id."""
        if self._user_id is not None:
            return self._user_id

        user = self._db.scalar(select(User).where(User.is_active.is_(True)).limit(1))
        if user is not None:
            logger.warning(
                "EmailOrchestrator instantiated without user_id — falling back to first active user (%s)."
                " This should not happen in production; always pass user_id explicitly.",
                user.id,
            )
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

    def _check_cancelled(self) -> None:
        """Raise CancelledError if the caller has signalled task cancellation."""
        if self._task_id and task_manager.is_cancelled(self._task_id):
            raise asyncio.CancelledError("Task was aborted by user")

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

    def _start_agent_run(self, triggered_by: str = "SYSTEM") -> AgentRun:
        """Create a RUNNING batch record in ``agent_runs``."""
        run = AgentRun(
            user_id=self._user_id,
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

    async def _create_draft(
        self,
        raw_email: dict[str, Any],
        classification: EmailClassificationOutput,
        rag_context: str = "",
    ) -> tuple[str, str, int]:
        """Generate a reply via the response agent and create a Gmail draft."""
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

        if self._gmail is None:
            raise ValueError("Cannot create draft: no Gmail service configured.")

        draft_gmail_id = await self._gmail.create_draft(
            to=sender,
            subject=reply.subject,
            body=reply.body_content,
            thread_id=raw_email.get("thread_id"),
        )

        elapsed_ms = int((time.monotonic() - started) * 1000)
        return draft_gmail_id, reply.subject, elapsed_ms

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
        agent_name: str,
        action: str,
        status: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        """Insert an audit log entry for observability."""
        log_entry = AuditLog(
            user_id=user_id,
            email_id=None,
            agent_name=agent_name,
            action=action,
            status=status,
            details=details,
        )
        self._db.add(log_entry)

    def _upsert_classification(
        self,
        gmail_message_id: str,
        thread_id: str,
        result: EmailClassificationOutput,
    ) -> None:
        """Insert or update a classification cache row keyed by gmail_message_id."""
        if not gmail_message_id:
            return
        existing = self._db.scalar(
            select(Classification).where(
                Classification.gmail_message_id == gmail_message_id,
                Classification.user_id == self._user_id,
            )
        )
        if existing:
            existing.thread_id = thread_id
            existing.category = result.category.value
            existing.priority_score = result.priority_score
            existing.summary = result.summary
            existing.confidence = result.confidence
        else:
            self._db.add(Classification(
                user_id=self._user_id,
                gmail_message_id=gmail_message_id,
                thread_id=thread_id,
                category=result.category.value,
                priority_score=result.priority_score,
                summary=result.summary,
                confidence=result.confidence,
            ))

    async def _suggest_tasks_for_email(
        self,
        raw_email: dict[str, Any],
        classification: EmailClassificationOutput,
        user_id: uuid.UUID,
    ) -> int:
        """
        4-tier filter + dedup, then create suggested tasks from email action items.
        Returns task count created; 0 if filtered out or already exists.
        raw_email must already be privacy-masked before this call.
        """
        # Tầng 1 — category
        if classification.category not in _TASK_ELIGIBLE_CATEGORIES:
            return 0

        # Tầng 2 — confidence
        if (classification.confidence or 0.0) < _TASK_MIN_CONFIDENCE:
            return 0

        gmail_message_id = raw_email.get("gmail_message_id", "")
        if not gmail_message_id:
            return 0

        # Chống trùng: đã từng sinh task từ email này (bất kỳ status) → bỏ qua
        existing = self._db.scalar(
            select(_TaskModel).where(
                _TaskModel.user_id == user_id,
                _TaskModel.source_email_id == gmail_message_id,
            ).limit(1)
        )
        if existing is not None:
            logger.debug(
                "Task suggestion skipped for %s — tasks already exist (status=%s).",
                gmail_message_id,
                existing.status,
            )
            return 0

        # Lấy action_items từ analysis agent (đã mask, an toàn)
        analysis = await self._analysis.analyze(
            email_subject=raw_email.get("subject") or "",
            email_body=raw_email.get("body") or raw_email.get("snippet") or "",
            email_sender=raw_email.get("sender"),
        )

        # Tầng 3 — bỏ item rỗng / quá ngắn
        raw_items = [
            item.strip()
            for item in (analysis.action_items or [])
            if item and len(item.strip()) >= _TASK_MIN_ITEM_LEN
        ]
        if not raw_items:
            return 0

        # Tầng 4 — cap số lượng
        items = raw_items[:_TASK_MAX_PER_EMAIL]

        priority = min(max(classification.priority_score or 3, 1), 5)
        deadline = self._parse_deadline(classification.deadline)
        thread_id: str | None = raw_email.get("thread_id") or None

        created = 0
        for item in items:
            self._db.add(_TaskModel(
                user_id=user_id,
                title=item[:255],
                status="suggested",
                source="ai_email",
                source_email_id=gmail_message_id,
                source_thread_id=thread_id,
                priority=priority,
                deadline=deadline,
            ))
            created += 1

        if created:
            self._audit(
                user_id=user_id,
                agent_name=_AGENT_TASK_SUGGESTOR,
                action="suggest_tasks",
                status="success",
                details={
                    "gmail_message_id": gmail_message_id,
                    "tasks_created": created,
                    "category": classification.category.value,
                    "confidence": classification.confidence,
                },
            )

        return created

    @staticmethod
    def _parse_deadline(deadline: str | date | None) -> date | None:
        """Normalize classifier deadline into a date."""
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
