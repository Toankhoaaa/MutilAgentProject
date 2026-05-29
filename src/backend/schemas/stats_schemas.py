"""Pydantic schemas for dashboard analytics endpoints."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CategoryCountItem(BaseModel):
    """Single slice for category distribution charts."""

    category: str
    count: int = Field(..., ge=0)


class OverviewStatsResponse(BaseModel):
    """High-level KPIs for the dashboard overview panel."""

    total_processed: int = Field(..., ge=0, description="Emails marked as processed.")
    urgent_count: int = Field(..., ge=0, description="Emails classified as urgent.")
    drafts_created: int = Field(..., ge=0, description="Total AI drafts stored.")
    time_saved_minutes: float = Field(
        ...,
        description=(
            "Estimated minutes saved: (drafts × 5 min) minus total LLM runtime in minutes."
        ),
    )


class CategoryDistributionResponse(BaseModel):
    """Category breakdown for pie/donut charts."""

    items: list[CategoryCountItem]
