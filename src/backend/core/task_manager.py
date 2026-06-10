"""In-memory cooperative task cancellation registry.

Lifecycle: register → (optionally cancel) → remove (always in finally).
Keys are cleaned up by the caller; stale entries do not accumulate.
"""

from __future__ import annotations

# Module-level dict — intentionally process-scoped (not shared across workers).
ACTIVE_TASKS: dict[str, dict] = {}


def register_task(task_id: str) -> None:
    """Mark a task as active and not yet cancelled."""
    ACTIVE_TASKS[task_id] = {"is_cancelled": False}


def cancel_task(task_id: str) -> bool:
    """Signal cancellation. Returns True if the task was found."""
    entry = ACTIVE_TASKS.get(task_id)
    if entry is None:
        return False
    entry["is_cancelled"] = True
    return True


def is_cancelled(task_id: str) -> bool:
    """Return True if the task has been cancelled."""
    return ACTIVE_TASKS.get(task_id, {}).get("is_cancelled", False)


def remove_task(task_id: str) -> None:
    """Remove a task entry to free memory. Call in a finally block."""
    ACTIVE_TASKS.pop(task_id, None)
