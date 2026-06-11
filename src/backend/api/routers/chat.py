"""FastAPI router for the Chatbot Agent — Server-Sent Events streaming."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.api.auth_dependencies import get_current_user
from backend.api.dependencies import get_gmail_service
from backend.models.user import User
from backend.services.agents.chat_agent import ChatbotAgent, ChatbotAgentError
from backend.services.gmail_service import GmailService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["Chat"])


class ChatMessage(BaseModel):
    """A single turn in the conversation history sent from the frontend."""

    role: str
    """Either ``"user"`` or ``"assistant"``."""

    content: str
    """Plain-text message content."""


class ChatRequest(BaseModel):
    """Request body for the chat endpoint."""

    message: str
    """The user's current input."""

    history: list[ChatMessage] = []
    """Previous turns, oldest-first, used to seed the agent's context."""


@router.post(
    "",
    summary="Chat with the AI assistant (SSE stream)",
    description=(
        "Send a message to the Chatbot Agent and receive a Server-Sent Events stream. "
        "Event shapes: "
        "``{type: 'status', text: '...'}`` while a tool is executing, "
        "``{type: 'token',  text: '...'}`` for the final assistant reply, "
        "``{type: 'error',  text: '...'}`` on failure, "
        "``{type: 'done'}`` always last."
    ),
    response_class=StreamingResponse,
)
async def chat(
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
    gmail_service: GmailService = Depends(get_gmail_service),
) -> StreamingResponse:
    """Stream the Chatbot Agent's response, including tool-execution status events."""
    try:
        agent = ChatbotAgent(gmail_service=gmail_service)
        agent.load_history([m.model_dump() for m in payload.history])
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    async def event_stream():
        try:
            async for event in agent.stream_chat(payload.message):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except ChatbotAgentError as exc:
            logger.error("ChatbotAgent error for user %s: %s", current_user.id, exc)
            yield f"data: {json.dumps({'type': 'error', 'text': str(exc)})}\n\n"
        except Exception:
            logger.exception("Unexpected error in chat stream for user %s", current_user.id)
            yield f"data: {json.dumps({'type': 'error', 'text': 'Internal server error.'})}\n\n"
        finally:
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
