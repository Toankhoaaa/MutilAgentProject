"""WebSocket routes for real-time notifications."""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from backend.core.security import decode_access_token
from backend.core.websocket_manager import manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws/notifications")
async def notifications_websocket(
    websocket: WebSocket,
    token: str | None = Query(default=None),
) -> None:
    """
    Maintain a persistent WebSocket for urgent-email and system notifications.

    Clients must pass a valid JWT as ``?token=<jwt>``.  The connection is
    closed with code 1008 (Policy Violation) if the token is missing or
    invalid.  Messages are only delivered to connections belonging to the
    authenticated user — no cross-user leakage.

    Example connection URL::

        ws://localhost:8000/ws/notifications?token=<jwt>

    Clients receive JSON messages, e.g.::

        {"type": "NEW_URGENT_EMAIL", "subject": "...", "summary": "..."}
    """
    if not token:
        await websocket.close(code=1008)
        return

    try:
        payload = decode_access_token(token)
        user_id = UUID(payload["sub"])
    except Exception:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, user_id)
    try:
        while True:
            # Keep the connection alive; optional client pings are ignored.
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.debug("Client disconnected from /ws/notifications user=%s", user_id)
    except Exception as exc:
        logger.warning("WebSocket error on /ws/notifications user=%s: %s", user_id, exc)
    finally:
        manager.disconnect(websocket)
