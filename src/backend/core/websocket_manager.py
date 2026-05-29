"""WebSocket connection pool for real-time dashboard notifications."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages active WebSocket clients and broadcasts JSON messages."""

    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        """Accept and register a new WebSocket client."""
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info("WebSocket connected. Active clients: %s", len(self.active_connections))

    def disconnect(self, websocket: WebSocket) -> None:
        """Remove a WebSocket client from the active pool."""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info("WebSocket disconnected. Active clients: %s", len(self.active_connections))

    async def broadcast(self, message: dict[str, Any]) -> None:
        """
        Send a JSON payload to every connected client.

        Stale or broken connections are removed automatically.
        """
        if not self.active_connections:
            logger.debug("Broadcast skipped — no active WebSocket clients.")
            return

        stale: list[WebSocket] = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception as exc:
                logger.warning("Failed to send WebSocket message: %s", exc)
                stale.append(connection)

        for connection in stale:
            self.disconnect(connection)


manager = ConnectionManager()
