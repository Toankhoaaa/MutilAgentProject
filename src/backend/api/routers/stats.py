"""FastAPI router for dashboard analytics and statistics."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.api.dependencies import get_db, require_admin
from backend.models.agent_run import AgentRun
from backend.models.user import User
from backend.models.classification import Classification
from backend.models.draft import Draft
from backend.schemas.stats_schemas import (
    CategoryCountItem,
    CategoryDistributionResponse,
    OverviewStatsResponse,
)

router = APIRouter(prefix="/stats", tags=["Analytics"])


@router.get(
    "/overview",
    response_model=OverviewStatsResponse,
    summary="Dashboard overview KPIs",
    description="Aggregates processed email counts and estimated time saved from agent run history.",
)
def get_overview_stats(db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> OverviewStatsResponse:
    total_processed = db.scalar(
        select(func.coalesce(func.sum(AgentRun.total_emails_processed), 0))
    ) or 0

    total_llm_ms = db.scalar(
        select(func.coalesce(func.sum(AgentRun.llm_total_time_ms), 0))
    ) or 0

    urgent_count = db.scalar(
        select(func.count()).select_from(Classification).where(Classification.category == "urgent")
    ) or 0

    drafts_created = db.scalar(
        select(func.count()).select_from(Draft)
    ) or 0

    llm_minutes = total_llm_ms / 60_000
    time_saved_minutes = round(max(float(total_processed) * 5 - llm_minutes, 0), 2)

    return OverviewStatsResponse(
        total_processed=total_processed,
        urgent_count=urgent_count,
        drafts_created=drafts_created,
        time_saved_minutes=time_saved_minutes,
    )


@router.get(
    "/category-distribution",
    response_model=CategoryDistributionResponse,
    summary="Classification category distribution",
    description="Returns live category counts grouped from the classifications table.",
)
def get_category_distribution(db: Session = Depends(get_db), _admin: User = Depends(require_admin)) -> CategoryDistributionResponse:
    rows = db.execute(
        select(Classification.category, func.count().label("count"))
        .where(Classification.category.is_not(None))
        .group_by(Classification.category)
    ).all()

    items = [CategoryCountItem(category=row.category, count=row.count) for row in rows]
    return CategoryDistributionResponse(items=items)
