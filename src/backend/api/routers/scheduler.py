"""FastAPI router for background email scheduler control."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.core import scheduler as sched

router = APIRouter(prefix="/scheduler", tags=["Scheduler"])


class SchedulerStatusResponse(BaseModel):
    is_running: bool
    interval_minutes: int
    next_run_at: str | None = None
    last_run_at: str | None = None


class UpdateIntervalRequest(BaseModel):
    interval_minutes: int = Field(..., ge=1, le=1440, description="Poll interval in minutes (1–1440).")


@router.get("/status", response_model=SchedulerStatusResponse, summary="Scheduler status")
def get_status() -> SchedulerStatusResponse:
    return SchedulerStatusResponse(**sched.get_status())


@router.post("/start", response_model=SchedulerStatusResponse, summary="Start scheduler")
def start() -> SchedulerStatusResponse:
    sched.start_scheduler()
    return SchedulerStatusResponse(**sched.get_status())


@router.post("/stop", response_model=SchedulerStatusResponse, summary="Stop scheduler")
def stop() -> SchedulerStatusResponse:
    sched.stop_scheduler()
    return SchedulerStatusResponse(**sched.get_status())


@router.post("/run-now", response_model=SchedulerStatusResponse, summary="Trigger immediate poll")
async def run_now() -> SchedulerStatusResponse:
    """Fire one email-processing run right now without affecting the schedule."""
    try:
        await sched.run_now()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return SchedulerStatusResponse(**sched.get_status())


@router.put("/config", response_model=SchedulerStatusResponse, summary="Update poll interval")
def update_config(payload: UpdateIntervalRequest) -> SchedulerStatusResponse:
    sched.update_interval(payload.interval_minutes)
    return SchedulerStatusResponse(**sched.get_status())
