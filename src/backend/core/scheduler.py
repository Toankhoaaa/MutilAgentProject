"""Background email polling scheduler using APScheduler."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)

_JOB_ID = "poll_emails"
_SPAM_CLEANUP_JOB_ID = "daily_spam_cleanup"
_EXPIRY_JOB_ID = "daily_subscription_expiry"
_DEFAULT_INTERVAL_MINUTES = 5
_FREE_BASELINE_MAX_REQUESTS = 100

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

    from backend.api.dependencies import get_classifier_agent, get_response_agent
    from backend.core.database import SessionLocal
    from backend.models.user import User
    from backend.services.gmail_service import GmailService, google_credentials_from_token_json
    from backend.services.orchestrator import EmailOrchestrator
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


async def _spam_cleanup_job() -> None:
    """Daily job: move all SPAM folder messages to trash for every active user."""
    from backend.core.database import SessionLocal
    from backend.models.user import User
    from backend.services.gmail_service import GmailService, google_credentials_from_token_json
    from sqlalchemy import select

    db = SessionLocal()
    try:
        users = db.scalars(select(User).where(User.is_active.is_(True))).all()
        for user in users:
            if not user.google_oauth_token:
                continue
            try:
                creds = google_credentials_from_token_json(user.google_oauth_token)
                gmail_service = GmailService(credentials=creds)
                result = await gmail_service.cleanup_spam_folder()
                logger.info(
                    "Daily spam cleanup for user %s: trashed=%s errors=%s",
                    user.id,
                    result["trashed"],
                    result["errors"],
                )
                refreshed = gmail_service.credentials_to_json()
                if refreshed != user.google_oauth_token:
                    user.google_oauth_token = refreshed
                    db.commit()
            except Exception as exc:
                logger.error("Spam cleanup failed for user %s: %s", user.id, exc)
    except Exception as exc:
        logger.exception("Daily spam cleanup job failed: %s", exc)
    finally:
        db.close()


async def _check_subscription_expiry() -> None:
    """Daily job: downgrade expired paid tiers to FREE and broadcast a WS notification."""
    from backend.core.database import SessionLocal
    from backend.core.websocket_manager import manager
    from backend.models.user import User
    from sqlalchemy import select, update

    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        expired = db.scalars(
            select(User).where(
                User.tier_expires_at < now,
                User.subscription_tier != "FREE",
            )
        ).all()

        if not expired:
            logger.info("Subscription expiry check: no expired tiers found.")
            return

        expired_ids = [u.id for u in expired]
        db.execute(
            update(User)
            .where(User.id.in_(expired_ids))
            .values(
                subscription_tier="FREE",
                max_requests=_FREE_BASELINE_MAX_REQUESTS,
            )
            .execution_options(synchronize_session=False)
        )
        db.commit()

        for user in expired:
            await manager.broadcast({
                "type": "SUBSCRIPTION_EXPIRED",
                "user_id": str(user.id),
                "message": "Your account tier has expired and has been downgraded to FREE.",
            })

        logger.info("Subscription expiry check: downgraded %d user(s) to FREE.", len(expired_ids))
    except Exception as exc:
        logger.exception("Subscription expiry job failed: %s", exc)
        db.rollback()
    finally:
        db.close()


def start_scheduler() -> None:
    if scheduler.running:
        return
    scheduler.add_job(_poll_job, _make_trigger(), id=_JOB_ID, replace_existing=True)
    scheduler.add_job(
        _spam_cleanup_job,
        IntervalTrigger(hours=24),
        id=_SPAM_CLEANUP_JOB_ID,
        replace_existing=True,
    )
    scheduler.add_job(
        _check_subscription_expiry,
        IntervalTrigger(hours=24),
        id=_EXPIRY_JOB_ID,
        replace_existing=True,
    )
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


# ── Snooze jobs ───────────────────────────────────────────────────────────────

def _snooze_job_id(snooze_id: str) -> str:
    return f"snooze_{snooze_id}"


async def _snooze_notify_job(snooze_id: str) -> None:
    """Fire when a snoozed email is due — broadcast WS event and mark NOTIFIED."""
    from backend.core.database import SessionLocal
    from backend.core.websocket_manager import manager
    from backend.models.snoozed_email import SnoozedEmail

    db = SessionLocal()
    try:
        row = db.get(SnoozedEmail, uuid.UUID(snooze_id))
        if row is None or row.status != "PENDING":
            return
        row.status = "NOTIFIED"
        db.commit()
        await manager.broadcast({
            "type": "SNOOZED_EMAIL_DUE",
            "snooze_id": snooze_id,
            "gmail_message_id": row.gmail_message_id,
            "thread_id": row.thread_id,
            "subject": row.subject or "",
            "sender": row.sender or "",
        })
    except Exception as exc:
        logger.exception("Snooze notify job failed for %s: %s", snooze_id, exc)
    finally:
        db.close()


def schedule_snooze(snooze_id: str, snooze_until: datetime) -> None:
    """Schedule a one-shot job that fires when the snooze expires."""
    scheduler.add_job(
        _snooze_notify_job,
        DateTrigger(run_date=snooze_until),
        id=_snooze_job_id(snooze_id),
        args=[snooze_id],
        replace_existing=True,
    )
    logger.info("Snooze job scheduled: id=%s fire_at=%s", snooze_id, snooze_until.isoformat())


async def restore_snooze_jobs() -> None:
    """Re-register APScheduler jobs for all PENDING snoozed emails after a restart."""
    from backend.core.database import SessionLocal
    from backend.models.snoozed_email import SnoozedEmail
    from sqlalchemy import select

    now = datetime.now(timezone.utc)
    db = SessionLocal()
    try:
        rows = db.scalars(
            select(SnoozedEmail).where(
                SnoozedEmail.status == "PENDING",
                SnoozedEmail.snooze_until > now,
            )
        ).all()
        for row in rows:
            schedule_snooze(str(row.id), row.snooze_until)
        logger.info("Restored %d pending snooze job(s).", len(rows))
    except Exception as exc:
        logger.exception("Failed to restore snooze jobs: %s", exc)
    finally:
        db.close()
