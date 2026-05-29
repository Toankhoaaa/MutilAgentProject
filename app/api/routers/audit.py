"""FastAPI router for audit log retrieval."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.models.audit_log import AuditLog
from app.schemas.api_schemas import AuditLogResponse, PaginatedResponse

router = APIRouter(prefix="/audit", tags=["Audit Logs"])


@router.get(
    "/",
    response_model=PaginatedResponse[AuditLogResponse],
    summary="List audit logs",
    description=(
        "Returns paginated audit trail entries with optional filters on "
        "``status`` and ``agent_name``."
    ),
)
def list_audit_logs(
    db: Session = Depends(get_db),
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
) -> PaginatedResponse[AuditLogResponse]:
    """
    List audit log entries newest-first with pagination and optional filters.
    """
    base = select(AuditLog.id)

    if status is not None:
        base = base.where(AuditLog.status == status)
    if agent_name is not None:
        base = base.where(AuditLog.agent_name == agent_name)

    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0

    list_stmt = select(AuditLog).order_by(AuditLog.created_at.desc())

    if status is not None:
        list_stmt = list_stmt.where(AuditLog.status == status)
    if agent_name is not None:
        list_stmt = list_stmt.where(AuditLog.agent_name == agent_name)

    rows = db.scalars(list_stmt.limit(limit).offset(offset)).all()

    return PaginatedResponse(
        items=[AuditLogResponse.model_validate(row) for row in rows],
        total=total,
        limit=limit,
        offset=offset,
    )
