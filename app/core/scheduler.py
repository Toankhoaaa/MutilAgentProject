"""Background email polling scheduler using APScheduler."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

_JOB_ID = "poll_emails"
_DEFAULT_INTERVAL_MINUTES = 5

scheduler = AsyncIOScheduler()
_interval_minutes: int = _DEFAULT_INTERVAL_MINUTES
_last_run_at: datetime | None = None


def get_status() -> dict:
    job = scheduler.get_job(_JOB_ID)
    next_run = None
    if job:
        nrt = getattr(job, "next_run_time", None)
        if nrt is not None:
            next_run = nrt.isoformat()

    return {
        "is_running": scheduler.running and job is not None,
        "interval_minutes": _interval_minutes,
        "next_run_at": next_run,
        "last_run_at": _last_run_at.isoformat() if _last_run_at else None,
    }


def _make_trigger() -> IntervalTrigger:
    return IntervalTrigger(minutes=_interval_minutes)


async def _poll_job() -> None:
    """Called by APScheduler on each tick — imports lazily to avoid circular deps."""
    global _last_run_at

    from app.api.dependencies import get_classifier_agent, get_response_agent
    from app.core.database import SessionLocal
    from app.models.user import User
    from app.services.gmail_service import GmailService, google_credentials_from_token_json
    from app.services.orchestrator import EmailOrchestrator
    from sqlalchemy import select

    _last_run_at = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.is_active.is_(True)).limit(1))
        if user is None or not user.google_oauth_token:
            logger.info("Scheduler: no active user with OAuth token — skipping poll.")
            return

        creds = google_credentials_from_token_json(user.google_oauth_token)
        gmail_service = GmailService(credentials=creds)
        orchestrator = EmailOrchestrator(
            db=db,
            gmail_service=gmail_service,
            classifier_agent=get_classifier_agent(),
            response_agent=get_response_agent(),
            user_id=user.id,
        )
        summary = await orchestrator.process_new_emails(limit=10)
        logger.info(
            "Scheduler poll complete — fetched=%s processed=%s drafts=%s",
            summary["fetched"],
            summary["processed"],
            summary["drafts_created"],
        )

        refreshed = gmail_service.credentials_to_json()
        if refreshed != user.google_oauth_token:
            user.google_oauth_token = refreshed
            db.commit()
    except Exception as exc:
        logger.exception("Scheduler poll failed: %s", exc)
    finally:
        db.close()


def start_scheduler() -> None:
    if scheduler.running:
        return
    scheduler.add_job(_poll_job, _make_trigger(), id=_JOB_ID, replace_existing=True)
    scheduler.start()
    logger.info("Email poll scheduler started (interval=%s min).", _interval_minutes)


def stop_scheduler() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Email poll scheduler stopped.")


def update_interval(minutes: int) -> None:
    global _interval_minutes
    _interval_minutes = minutes
    if scheduler.running:
        scheduler.reschedule_job(_JOB_ID, trigger=_make_trigger())
        logger.info("Scheduler interval updated to %s min.", minutes)


async def run_now() -> None:
    """Fire a single poll immediately without waiting for the next tick."""
    await _poll_job()
