"""FastAPI router for AI pipeline cooperative cancellation."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.api.auth_dependencies import get_current_user
from backend.core import task_manager
from backend.models.user import User

router = APIRouter(prefix="/pipeline", tags=["Pipeline"])


@router.post(
    "/{task_id}/cancel",
    summary="Cancel an in-progress AI pipeline task",
    description=(
        "Signals cooperative cancellation for the given task_id. "
        "Only the user who started the pipeline run may cancel it."
    ),
)
async def cancel_pipeline_task(
    task_id: str,
    current_user: User = Depends(get_current_user),
) -> dict:
    """Cancel a running pipeline task owned by the current user."""
    owner = task_manager.get_task_owner(task_id)
    if owner is None or owner != str(current_user.id):
        raise HTTPException(status_code=404, detail=f"Pipeline task '{task_id}' not found.")
    task_manager.cancel_task(task_id)
    return {"cancelled": True, "task_id": task_id}
