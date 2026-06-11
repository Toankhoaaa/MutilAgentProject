"""Chatbot agent with native Gemini function calling for job-search assistance.

Multi-turn agentic loop:
    User message → model may emit FunctionCall parts → tools execute →
    FunctionResponse sent back → model emits FunctionCall OR final text.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from backend.core.config import normalize_gemini_model, settings
from backend.services.agents.rag_agent import RagAgent
from backend.services.gmail_service import GmailService
from backend.services.tools.web_scraper import scrape_url

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "You are a Personal AI Assistant helping the user with job search and email management. "
    "Use the provided tools to answer user requests. "
    "If given a job link, use scrape_url to read the job description and find_user_cv to "
    "retrieve the user's CV, then help draft a tailored application response. "
    "If asked about emails, use search_emails to find relevant messages and "
    "get_email_content to read their full content. "
    "Always prefer using tools over guessing. Be concise and helpful."
)

# Maximum agentic tool-call rounds per user message before giving up.
_MAX_TOOL_ROUNDS = 5

# Human-readable status messages emitted to the frontend during tool execution.
_TOOL_STATUS_MESSAGES: dict[str, str] = {
    "scrape_url": "Scraping URL...",
    "find_user_cv": "Retrieving your CV...",
    "search_emails": "Searching emails...",
    "get_email_content": "Reading email content...",
}

# ---------------------------------------------------------------------------
# Tool declarations (read by the LLM to understand what it can call)
# ---------------------------------------------------------------------------

_TOOL_DECLARATIONS = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="scrape_url",
            description=(
                "Fetch a public webpage and return its readable plain text. "
                "Use this to extract job descriptions, company profiles, or any "
                "web content the user needs to analyse. "
                "Returns an 'Error:' prefixed string when the page cannot be fetched."
            ),
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "url": types.Schema(
                        type=types.Type.STRING,
                        description=(
                            "Fully-qualified URL of the page to fetch, "
                            "e.g. 'https://company.com/jobs/software-engineer'."
                        ),
                    ),
                },
                required=["url"],
            ),
        ),
        types.FunctionDeclaration(
            name="find_user_cv",
            description=(
                "Retrieve the user's CV or résumé from their personal knowledge base. "
                "Use this whenever you need the user's skills, work experience, education, "
                "or background to tailor a job application or answer a career-related question. "
                "Returns the CV text, or an empty string when no CV is stored."
            ),
            # No parameters — takes no arguments.
        ),
        types.FunctionDeclaration(
            name="search_emails",
            description=(
                "Search the user's Gmail mailbox and return a JSON list of matching emails. "
                "Accepts standard Gmail search syntax such as "
                "'from:recruiter@company.com subject:offer is:unread'. "
                "Each result includes gmail_message_id, subject, sender, date, and snippet. "
                "Use gmail_message_id with get_email_content to read a full message."
            ),
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "query": types.Schema(
                        type=types.Type.STRING,
                        description=(
                            "Gmail search string. Examples: "
                            "'subject:job offer', "
                            "'from:hr@company.com is:unread', "
                            "'label:inbox after:2024/01/01'."
                        ),
                    ),
                    "limit": types.Schema(
                        type=types.Type.INTEGER,
                        description=(
                            "Maximum number of emails to return. Defaults to 10. "
                            "Use a smaller value (e.g. 5) when you only need recent messages."
                        ),
                    ),
                },
                required=["query"],
            ),
        ),
        types.FunctionDeclaration(
            name="get_email_content",
            description=(
                "Fetch the full plain-text body of a single email by its Gmail message ID. "
                "Use a gmail_message_id obtained from a previous search_emails call. "
                "Returns the body text, or an 'Error:' string when the message is not found."
            ),
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={
                    "email_id": types.Schema(
                        type=types.Type.STRING,
                        description=(
                            "Gmail message ID string from a search_emails result, "
                            "e.g. '18f2a3b4c5d6e7f8'."
                        ),
                    ),
                },
                required=["email_id"],
            ),
        ),
    ]
)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class ChatbotAgentError(Exception):
    """Raised when the agent cannot produce a valid response."""


# ---------------------------------------------------------------------------
# Agent
# ---------------------------------------------------------------------------


class ChatbotAgent:
    """Conversational agent backed by Gemini native function calling.

    Maintains per-instance conversation history so the model retains context
    across multiple ``chat`` calls. Call ``clear_history`` to start a new
    session without creating a new instance.

    Tool execution is async-safe: synchronous tools (scrape_url, find_user_cv)
    are dispatched via ``asyncio.to_thread`` to avoid blocking the event loop.
    """

    def __init__(
        self,
        gmail_service: GmailService,
        rag_agent: RagAgent | None = None,
        api_key: str | None = None,
        model: str | None = None,
    ) -> None:
        """
        Args:
            gmail_service: Authenticated Gmail service used by the email tools.
            rag_agent: Optional shared RagAgent for CV retrieval. A fresh
                instance is created when not provided.
            api_key: Override for ``settings.GEMINI_API_KEY``.
            model: Override for ``settings.GEMINI_MODEL``.

        Raises:
            ValueError: When no Gemini API key is available.
        """
        resolved_key = api_key or settings.GEMINI_API_KEY
        if not resolved_key:
            raise ValueError(
                "GEMINI_API_KEY is not configured. Set it in the environment or .env file."
            )

        self._gmail = gmail_service
        self._rag = rag_agent or RagAgent()
        self._model = normalize_gemini_model(model or settings.GEMINI_MODEL)
        self._client = genai.Client(api_key=resolved_key)
        self._history: list[types.Content] = []

        self._config = types.GenerateContentConfig(
            system_instruction=_SYSTEM_PROMPT,
            tools=[_TOOL_DECLARATIONS],
            temperature=0.7,
        )

    # ── Public API ────────────────────────────────────────────────────────

    async def chat(self, user_message: str) -> str:
        """Process a user message and return the assistant's final text reply.

        Runs the agentic loop internally:

        1. Append the user message to conversation history.
        2. Call Gemini with the full history and tool declarations.
        3. If the model emits ``FunctionCall`` parts, execute each tool and
           append a ``FunctionResponse`` content back to history.
        4. Repeat until the model emits a plain text response (no function
           calls) or ``_MAX_TOOL_ROUNDS`` is reached.
        5. Return the final response text.

        Args:
            user_message: The user's natural-language input.

        Returns:
            The model's plain-text reply after all tool calls are resolved.

        Raises:
            ChatbotAgentError: On a blocked or persistently empty model response.
        """
        self._history.append(
            types.Content(role="user", parts=[types.Part(text=user_message)])
        )

        response: Any = None

        for round_num in range(_MAX_TOOL_ROUNDS):
            try:
                response = await self._client.aio.models.generate_content(
                    model=self._model,
                    contents=self._history,
                    config=self._config,
                )
            except genai_errors.APIError as exc:
                raise ChatbotAgentError(f"Gemini API error: {exc}") from exc

            if not response.candidates:
                raise ChatbotAgentError(
                    "Gemini returned no candidates — the request may have been blocked."
                )

            candidate_content: types.Content = response.candidates[0].content
            self._history.append(candidate_content)

            # Collect function-call parts from this model turn
            function_call_parts = [
                p for p in (candidate_content.parts or []) if p.function_call
            ]
            if not function_call_parts:
                # No tool requests — model produced its final answer
                break

            logger.debug(
                "Round %d: model requested %d tool call(s): %s",
                round_num + 1,
                len(function_call_parts),
                [p.function_call.name for p in function_call_parts],
            )

            # Execute every requested tool call in declaration order
            result_parts: list[types.Part] = []
            for part in function_call_parts:
                fc = part.function_call
                tool_result = await self._execute_tool(fc.name, dict(fc.args or {}))
                logger.debug(
                    "Tool '%s' returned %d chars.", fc.name, len(tool_result)
                )
                result_parts.append(
                    types.Part(
                        function_response=types.FunctionResponse(
                            name=fc.name,
                            response={"result": tool_result},
                        )
                    )
                )

            # Send all tool results back as a single user turn
            self._history.append(types.Content(role="user", parts=result_parts))

        if response is None:
            raise ChatbotAgentError("No response received from the model.")

        final_text = (response.text or "").strip()
        if not final_text:
            raise ChatbotAgentError(
                "Model produced an empty response after tool execution. "
                f"Max rounds ({_MAX_TOOL_ROUNDS}) may have been reached."
            )
        return final_text

    def clear_history(self) -> None:
        """Discard all conversation history to begin a fresh session."""
        self._history = []

    def load_history(self, messages: list[dict[str, str]]) -> None:
        """Pre-populate conversation history from a list of role/content dicts.

        Converts the frontend's message format (role ``"user"`` / ``"assistant"``,
        key ``"content"``) to Gemini's ``Content`` format (role ``"user"`` /
        ``"model"``). Only text turns are restored; tool-call parts are not
        representable in this simplified form and are omitted.

        Args:
            messages: List of ``{"role": ..., "content": ...}`` dicts ordered
                oldest-first. ``role`` must be ``"user"`` or ``"assistant"``.
        """
        self._history = []
        for msg in messages:
            role = "model" if msg.get("role") == "assistant" else "user"
            content = msg.get("content", "").strip()
            if content:
                self._history.append(
                    types.Content(role=role, parts=[types.Part(text=content)])
                )

    async def stream_chat(
        self, user_message: str
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Agentic loop that yields SSE-ready event dicts in real time.

        Runs the same multi-turn tool-calling loop as ``chat`` but yields
        progress events so the frontend can show tool status while the agent
        works, then delivers the final reply as a ``token`` event.

        Args:
            user_message: The user's natural-language input.

        Yields:
            ``{"type": "status", "text": "..."}`` — emitted before each tool
            call so the client can show a progress indicator.

            ``{"type": "token",  "text": "..."}`` — the model's final reply.

            ``{"type": "error",  "text": "..."}`` — emitted instead of
            ``token`` when the model or a tool fails unrecoverably.
        """
        self._history.append(
            types.Content(role="user", parts=[types.Part(text=user_message)])
        )

        response: Any = None

        for round_num in range(_MAX_TOOL_ROUNDS):
            try:
                response = await self._client.aio.models.generate_content(
                    model=self._model,
                    contents=self._history,
                    config=self._config,
                )
            except genai_errors.APIError as exc:
                yield {"type": "error", "text": f"Gemini API error: {exc}"}
                return

            if not response.candidates:
                yield {
                    "type": "error",
                    "text": "Gemini returned no candidates — request may have been blocked.",
                }
                return

            candidate_content: types.Content = response.candidates[0].content
            self._history.append(candidate_content)

            function_call_parts = [
                p for p in (candidate_content.parts or []) if p.function_call
            ]
            if not function_call_parts:
                # No tool requests — model produced its final answer.
                break

            logger.debug(
                "Round %d: model requested %d tool call(s): %s",
                round_num + 1,
                len(function_call_parts),
                [p.function_call.name for p in function_call_parts],
            )

            # Emit a status event before executing each tool.
            for part in function_call_parts:
                fc = part.function_call
                status_text = _TOOL_STATUS_MESSAGES.get(fc.name, f"Using {fc.name}...")
                yield {"type": "status", "text": status_text}

            result_parts: list[types.Part] = []
            for part in function_call_parts:
                fc = part.function_call
                tool_result = await self._execute_tool(fc.name, dict(fc.args or {}))
                logger.debug("Tool '%s' returned %d chars.", fc.name, len(tool_result))
                result_parts.append(
                    types.Part(
                        function_response=types.FunctionResponse(
                            name=fc.name,
                            response={"result": tool_result},
                        )
                    )
                )

            self._history.append(types.Content(role="user", parts=result_parts))

        if response is None:
            yield {"type": "error", "text": "No response received from the model."}
            return

        final_text = (response.text or "").strip()
        if not final_text:
            yield {
                "type": "error",
                "text": (
                    "Model produced an empty response after tool execution. "
                    f"Max rounds ({_MAX_TOOL_ROUNDS}) may have been reached."
                ),
            }
            return

        yield {"type": "token", "text": final_text}

    # ── Internal tool dispatcher ──────────────────────────────────────────

    async def _execute_tool(self, name: str, args: dict[str, Any]) -> str:
        """Dispatch a tool call by name and return the result as a plain string.

        Catches all exceptions so a tool failure is reported to the model
        as an error string rather than crashing the agentic loop.

        Args:
            name: The tool name declared in ``_TOOL_DECLARATIONS``.
            args: Keyword arguments extracted from the model's ``FunctionCall``.

        Returns:
            Tool output as a plain string, or an ``"Error: ..."`` string on
            failure so the model can inform the user gracefully.
        """
        try:
            if name == "scrape_url":
                return await asyncio.to_thread(scrape_url, args["url"])

            if name == "find_user_cv":
                return await asyncio.to_thread(self._rag.find_user_cv)

            if name == "search_emails":
                emails: list[dict[str, Any]] = await self._gmail.search_emails(
                    query=args["query"],
                    limit=int(args.get("limit", 10)),
                )
                return json.dumps(emails, ensure_ascii=False, default=str)

            if name == "get_email_content":
                return await self._gmail.get_email_content(args["email_id"])

            return f"Error: unknown tool '{name}'."

        except Exception as exc:  # noqa: BLE001
            logger.error("Tool '%s' raised an exception: %s", name, exc)
            return f"Error executing tool '{name}': {exc}"
