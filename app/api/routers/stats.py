"""FastAPI router for dashboard analytics and statistics."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.models.agent_run import AgentRun
from app.models.classification import Classification
from app.models.draft import Draft
from app.models.email import Email
from app.schemas.stats_schemas import (
    CategoryCountItem,
    CategoryDistributionResponse,
    OverviewStatsResponse,
)

router = APIRouter(prefix="/stats", tags=["Analytics"])


@router.get(
    "/overview",
    response_model=OverviewStatsResponse,
    summary="Dashboard overview KPIs",
    description=(
        "Aggregates processed email counts, urgent classifications, draft totals, "
        "and estimated time saved for the dashboard."
    ),
)
def get_overview_stats(db: Session = Depends(get_db)) -> OverviewStatsResponse:
    """
    Return overview statistics for the dashboard.

    Time saved formula: ``(drafts_created × 5) − (sum(llm_total_time_ms) / 60000)`` minutes.
    """
    total_processed = db.scalar(
        select(func.count()).select_from(Email).where(Email.is_processed.is_(True))
    ) or 0

    urgent_count = db.scalar(
        select(func.count())
        .select_from(Classification)
        .where(Classification.category == "urgent")
    ) or 0

    drafts_created = db.scalar(select(func.count()).select_from(Draft)) or 0

    total_llm_ms = db.scalar(
        select(func.coalesce(func.sum(AgentRun.llm_total_time_ms), 0))
    ) or 0

    llm_minutes = total_llm_ms / 60_000
    time_saved_minutes = round((drafts_created * 5) - llm_minutes, 2)

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
    description="Returns per-category counts from ``classifications`` for pie charts.",
)
def get_category_distribution(db: Session = Depends(get_db)) -> CategoryDistributionResponse:
    """Group classifications by category and return counts for charting."""
    rows = db.execute(
        select(Classification.category, func.count(Classification.id))
        .where(Classification.category.is_not(None))
        .group_by(Classification.category)
        .order_by(func.count(Classification.id).desc())
    ).all()

    items = [
        CategoryCountItem(category=category or "unknown", count=count)
        for category, count in rows
    ]
    return CategoryDistributionResponse(items=items)
