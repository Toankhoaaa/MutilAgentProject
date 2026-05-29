"""WebSocket routes for real-time notifications."""

from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.websocket_manager import manager

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket"])


@router.websocket("/ws/notifications")
async def notifications_websocket(websocket: WebSocket) -> None:
    """
    Maintain a persistent WebSocket for urgent-email and system notifications.

    Clients receive JSON messages broadcast by the orchestrator, e.g.::

        {"type": "NEW_URGENT_EMAIL", "subject": "...", "summary": "..."}
    """
    await manager.connect(websocket)
    try:
        while True:
            # Keep the connection alive; optional client pings are ignored.
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.debug("Client disconnected from /ws/notifications")
    except Exception as exc:
        logger.warning("WebSocket error on /ws/notifications: %s", exc)
    finally:
        manager.disconnect(websocket)
