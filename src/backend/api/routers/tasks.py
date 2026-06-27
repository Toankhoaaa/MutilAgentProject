"""FastAPI router for user task management CRUD."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.auth_dependencies import get_current_user
from backend.api.dependencies import get_db
from backend.core.scheduler import cancel_task_reminder, schedule_task_reminder
from backend.models.audit_log import AuditLog
from backend.models.task import Task
from backend.models.user import User
from backend.schemas.api_schemas import TaskCreate, TaskResponse, TaskStatus, TaskUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", tags=["Tasks"])

# ---------------------------------------------------------------------------
# User task management CRUD
# ---------------------------------------------------------------------------


def _write_audit(
    db: Session,
    action: str,
    user_id: uuid.UUID,
    task_id: uuid.UUID,
    extra: dict | None = None,
) -> None:
    details: dict = {"task_id": str(task_id), "user_id": str(user_id)}
    if extra:
        details.update(extra)
    db.add(
        AuditLog(
            user_id=user_id,
            agent_name="task_management",
            action=action,
            status="success",
            details=details,
        )
    )


def _get_owned_task(db: Session, task_id: uuid.UUID, current_user: User) -> Task:
    row = db.get(Task, task_id)
    if row is None or row.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Task not found.")
    return row


def _safe_schedule(task_id: str, remind_at: datetime) -> None:
    """Schedule a reminder, swallowing errors so they never break CRUD."""
    try:
        schedule_task_reminder(task_id, remind_at)
    except Exception:
        logger.exception("Failed to schedule reminder for task %s", task_id)


def _safe_cancel(task_id: str) -> None:
    """Cancel a reminder, swallowing errors so they never break CRUD."""
    try:
        cancel_task_reminder(task_id)
    except Exception:
        logger.exception("Failed to cancel reminder for task %s", task_id)


@router.get(
    "",
    response_model=list[TaskResponse],
    summary="List tasks for the current user",
)
def list_tasks(
    status: TaskStatus | None = Query(default=None),
    priority: int | None = Query(default=None, ge=1, le=5),
    source: str | None = Query(default=None),
    deadline_before: str | None = Query(default=None, description="ISO date, e.g. 2025-12-31"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Task]:
    stmt = select(Task).where(Task.user_id == current_user.id)
    if status is not None:
        stmt = stmt.where(Task.status == status.value)
    if priority is not None:
        stmt = stmt.where(Task.priority == priority)
    if source is not None:
        stmt = stmt.where(Task.source == source)
    if deadline_before is not None:
        from datetime import date as _date
        stmt = stmt.where(Task.deadline <= _date.fromisoformat(deadline_before))
    stmt = stmt.order_by(Task.priority.desc(), Task.deadline.asc())
    return list(db.scalars(stmt).all())


@router.post(
    "",
    response_model=TaskResponse,
    status_code=201,
    summary="Create a manual task",
)
def create_task(
    payload: TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Task:
    row = Task(
        user_id=current_user.id,
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        deadline=payload.deadline,
        remind_at=payload.remind_at,
        status="todo",
        source="manual",
    )
    db.add(row)
    db.flush()  # populate row.id before audit
    _write_audit(db, "task_create", current_user.id, row.id)
    db.commit()
    db.refresh(row)

    if payload.remind_at:
        _safe_schedule(str(row.id), payload.remind_at)

    return row


@router.patch(
    "/{task_id}",
    response_model=TaskResponse,
    summary="Update a task",
)
def update_task(
    task_id: uuid.UUID,
    payload: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Task:
    row = _get_owned_task(db, task_id, current_user)
    old_status = row.status

    if payload.title is not None:
        row.title = payload.title
    if payload.description is not None:
        row.description = payload.description
    if payload.priority is not None:
        row.priority = payload.priority
    if payload.deadline is not None:
        row.deadline = payload.deadline

    # remind_at: only touch when explicitly included in the request body
    if "remind_at" in payload.model_fields_set:
        _safe_cancel(str(row.id))
        row.remind_at = payload.remind_at
        if payload.remind_at:
            _safe_schedule(str(row.id), payload.remind_at)

    if payload.status is not None:
        new_status = payload.status.value
        row.status = new_status
        if new_status == "done" and old_status != "done":
            row.completed_at = datetime.now(timezone.utc)
            _safe_cancel(str(row.id))
        elif new_status == "dismissed":
            _safe_cancel(str(row.id))
        elif new_status != "done" and old_status == "done":
            row.completed_at = None

    row.updated_at = datetime.now(timezone.utc)
    _write_audit(db, "task_update", current_user.id, row.id, {"status": row.status})
    db.commit()
    db.refresh(row)
    return row


@router.delete(
    "/{task_id}",
    status_code=204,
    summary="Delete a task (hard delete)",
)
def delete_task(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    row = _get_owned_task(db, task_id, current_user)
    _safe_cancel(str(row.id))
    _write_audit(db, "task_delete", current_user.id, row.id)
    db.delete(row)
    db.commit()


@router.post(
    "/{task_id}/confirm",
    response_model=TaskResponse,
    summary="Confirm a suggested task (suggested → todo)",
)
def confirm_task(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Task:
    row = _get_owned_task(db, task_id, current_user)
    if row.status != TaskStatus.suggested.value:
        raise HTTPException(status_code=400, detail="Task must be in 'suggested' status to confirm.")
    row.status = TaskStatus.todo.value
    row.updated_at = datetime.now(timezone.utc)
    _write_audit(db, "task_update", current_user.id, row.id, {"status": row.status})
    db.commit()
    db.refresh(row)
    return row


@router.post(
    "/{task_id}/dismiss",
    response_model=TaskResponse,
    summary="Dismiss a task (→ dismissed)",
)
def dismiss_task(
    task_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Task:
    row = _get_owned_task(db, task_id, current_user)
    _safe_cancel(str(row.id))
    row.status = TaskStatus.dismissed.value
    row.updated_at = datetime.now(timezone.utc)
    _write_audit(db, "task_update", current_user.id, row.id, {"status": row.status})
    db.commit()
    db.refresh(row)
    return row
