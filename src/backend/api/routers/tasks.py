"""FastAPI router for cooperative task cancellation."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.core import task_manager

router = APIRouter(prefix="/tasks", tags=["Tasks"])


@router.post(
    "/{task_id}/cancel",
    summary="Cancel an in-progress AI pipeline task",
    description=(
        "Signals cooperative cancellation for the given task_id. "
        "The pipeline checks this flag between agent steps and raises "
        "CancelledError on the next check."
    ),
)
async def cancel_task(task_id: str) -> dict:
    """Set the cancellation flag for a running pipeline task."""
    found = task_manager.cancel_task(task_id)
    if not found:
        raise HTTPException(status_code=404, detail=f"Task '{task_id}' not found or already finished.")
    return {"cancelled": True, "task_id": task_id}
