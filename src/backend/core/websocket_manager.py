"""WebSocket connection pool for real-time dashboard notifications."""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages per-user WebSocket connections and sends directed JSON messages.

    Connections are keyed by user_id so that broadcasts can be isolated to a
    single user (e.g. security alerts, calendar events).  System-wide messages
    (e.g. ADMIN_ANNOUNCEMENT) omit target_user_id to fan-out to every client.
    """

    def __init__(self) -> None:
        # user_id → list[WebSocket] — supports multiple tabs per user
        self._connections: dict[UUID, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, user_id: UUID) -> None:
        """Accept the WebSocket and register it under the given user."""
        await websocket.accept()
        self._connections.setdefault(user_id, []).append(websocket)
        total = sum(len(v) for v in self._connections.values())
        logger.info(
            "WebSocket connected user=%s. Active clients: %s", user_id, total
        )

    def disconnect(self, websocket: WebSocket) -> None:
        """Remove the WebSocket from whichever user bucket it belongs to."""
        for uid, conns in list(self._connections.items()):
            if websocket in conns:
                conns.remove(websocket)
                if not conns:
                    del self._connections[uid]
                break
        total = sum(len(v) for v in self._connections.values())
        logger.info("WebSocket disconnected. Active clients: %s", total)

    async def broadcast(
        self,
        message: dict[str, Any],
        *,
        target_user_id: UUID | None = None,
    ) -> None:
        """Send a JSON payload to WebSocket clients.

        When *target_user_id* is given, only that user's connections receive
        the message.  Pass ``None`` only for system-wide events such as
        ADMIN_ANNOUNCEMENT — all other callers must supply a target.
        """
        if target_user_id is not None:
            connections = list(self._connections.get(target_user_id, []))
        else:
            connections = [ws for conns in self._connections.values() for ws in conns]

        if not connections:
            logger.debug("Broadcast skipped — no matching WebSocket clients.")
            return

        stale: list[WebSocket] = []
        for connection in connections:
            try:
                await connection.send_json(message)
            except Exception as exc:
                logger.warning("Failed to send WebSocket message: %s", exc)
                stale.append(connection)

        for connection in stale:
            self.disconnect(connection)


manager = ConnectionManager()
