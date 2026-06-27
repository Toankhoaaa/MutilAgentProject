"""FastAPI router for audit log retrieval."""

from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.api.dependencies import get_db, require_admin
from backend.models.audit_log import AuditLog
from backend.models.user import User
from backend.schemas.api_schemas import AuditLogResponse, PaginatedResponse

router = APIRouter(prefix="/audit", tags=["Audit Logs"])


@router.get(
    "/",
    response_model=PaginatedResponse[AuditLogResponse],
    summary="List audit logs",
    description=(
        "Returns paginated audit trail entries with optional filters on "
        "``status``, ``agent_name``, and ``user_id``."
    ),
)
def list_audit_logs(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
    limit: int = Query(default=20, ge=1, le=200, description="Page size."),
    offset: int = Query(default=0, ge=0, description="Rows to skip."),
    status: str | None = Query(
        default=None,
        description='Filter by status (e.g. "success", "failed", "skipped").',
    ),
    agent_name: str | None = Query(
        default=None,
        description='Filter by agent name (e.g. "ClassifierAgent").',
    ),
    user_id: uuid.UUID | None = Query(
        default=None,
        description="Filter by user UUID.",
    ),
    action: str | None = Query(
        default=None,
        description='Filter by action (e.g. "classify", "generate_draft").',
    ),
    from_date: datetime | None = Query(
        default=None,
        description="Filter logs at or after this datetime (ISO-8601).",
    ),
    to_date: datetime | None = Query(
        default=None,
        description="Filter logs at or before this datetime (ISO-8601).",
    ),
) -> PaginatedResponse[AuditLogResponse]:
    """
    List audit log entries newest-first with pagination and optional filters.
    """
    base = select(AuditLog.id)

    if status is not None:
        base = base.where(AuditLog.status == status)
    if agent_name is not None:
        base = base.where(AuditLog.agent_name == agent_name)
    if user_id is not None:
        base = base.where(AuditLog.user_id == user_id)
    if action is not None:
        base = base.where(AuditLog.action == action)
    if from_date is not None:
        base = base.where(AuditLog.created_at >= from_date)
    if to_date is not None:
        base = base.where(AuditLog.created_at <= to_date)

    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0

    list_stmt = select(AuditLog).order_by(AuditLog.created_at.desc())

    if status is not None:
        list_stmt = list_stmt.where(AuditLog.status == status)
    if agent_name is not None:
        list_stmt = list_stmt.where(AuditLog.agent_name == agent_name)
    if user_id is not None:
        list_stmt = list_stmt.where(AuditLog.user_id == user_id)
    if action is not None:
        list_stmt = list_stmt.where(AuditLog.action == action)
    if from_date is not None:
        list_stmt = list_stmt.where(AuditLog.created_at >= from_date)
    if to_date is not None:
        list_stmt = list_stmt.where(AuditLog.created_at <= to_date)

    rows = db.scalars(list_stmt.limit(limit).offset(offset)).all()

    return PaginatedResponse(
        items=[AuditLogResponse.model_validate(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
