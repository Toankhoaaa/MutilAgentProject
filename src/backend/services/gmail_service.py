"""Gmail API integration using injected Google OAuth credentials."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.utils import parseaddr, parsedate_to_datetime
from typing import Any

from google.auth.exceptions import RefreshError
from google.auth.transport.requests import Request
from google.oauth2 import credentials as oauth2_credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from backend.core.config import settings

logger = logging.getLogger(__name__)

GMAIL_SCOPES: list[str] = ["https://www.googleapis.com/auth/gmail.modify"]
_GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token"


def _parse_token_expiry(data: dict[str, Any]) -> datetime | None:
    """Normalize authlib / Google token expiry fields to a timezone-aware datetime."""
    expiry = data.get("expiry")
    if isinstance(expiry, str) and expiry.strip():
        try:
            parsed = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
            if parsed.tzinfo:
                parsed = parsed.astimezone(timezone.utc)
            return parsed.replace(tzinfo=None)
        except ValueError:
            pass

    expires_at = data.get("expires_at")
    if isinstance(expires_at, (int, float)):
        # google-auth compares expiry as naive UTC internally.
        return datetime.utcfromtimestamp(expires_at)

    return None


class GmailServiceError(Exception):
    """Base exception for Gmail service failures."""


class GmailAuthenticationError(GmailServiceError):
    """Raised when Gmail credentials cannot be loaded or refreshed."""


class GmailAPIError(GmailServiceError):
    """Raised when the Gmail API returns an error response."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


def google_credentials_from_token_json(token_json: str) -> oauth2_credentials.Credentials:
    """
    Restore ``google.oauth2.credentials.Credentials`` from stored OAuth JSON.

    Supports tokens persisted by authlib (``access_token``) and Google client
    libraries (``token``). Refreshes expired access tokens when a refresh token
    is available.
    """
    if not token_json.strip():
        raise GmailAuthenticationError("OAuth token JSON is empty.")

    try:
        data: dict[str, Any] = json.loads(token_json)
    except json.JSONDecodeError as exc:
        raise GmailAuthenticationError("OAuth token JSON is invalid.") from exc

    access_token = data.get("access_token") or data.get("token")
    if not access_token:
        raise GmailAuthenticationError("OAuth token JSON has no access token.")

    scopes = data.get("scopes") or data.get("scope")
    if isinstance(scopes, str):
        scope_list = scopes.split()
    elif isinstance(scopes, list):
        scope_list = scopes
    else:
        scope_list = GMAIL_SCOPES

    client_id = data.get("client_id") or settings.GOOGLE_CLIENT_ID
    client_secret = data.get("client_secret") or settings.GOOGLE_CLIENT_SECRET
    refresh_token = data.get("refresh_token")
    token_expiry = _parse_token_expiry(data)

    creds = oauth2_credentials.Credentials(
        token=access_token,
        refresh_token=refresh_token,
        token_uri=data.get("token_uri") or _GOOGLE_TOKEN_URI,
        client_id=client_id,
        client_secret=client_secret,
        scopes=scope_list,
        expiry=token_expiry,
    )

    if creds.expired:
        if refresh_token:
            try:
                creds.refresh(Request())
            except RefreshError as exc:
                raise GmailAuthenticationError(
                    "Google access token expired and refresh failed. Please sign in again."
                ) from exc
        else:
            raise GmailAuthenticationError(
                "Google access token expired. Please sign out and sign in with Google again."
            )

    if not creds.valid:
        raise GmailAuthenticationError("Google OAuth credentials are invalid.")

    return creds


class GmailService:
    """Async-friendly Gmail API wrapper backed by injected user credentials."""

    def __init__(self, credentials: oauth2_credentials.Credentials) -> None:
        """
        Args:
            credentials: Google OAuth2 user credentials for the mailbox owner.
        """
        self._credentials = credentials
        self._service: Any | None = None

    @property
    def credentials(self) -> oauth2_credentials.Credentials:
        """Return the underlying Google credentials (may be refreshed in place)."""
        return self._credentials

    def credentials_to_json(self) -> str:
        """Serialize credentials for persisting back to ``users.google_oauth_token``."""
        return self._credentials.to_json()

    def authenticate(self) -> Any:
        """
        Build the Gmail API service client.

        Returns:
            A googleapiclient ``Resource`` for Gmail API v1.
        """
        if self._credentials.expired and self._credentials.refresh_token:
            self._credentials.refresh(Request())

        try:
            service = build(
                "gmail",
                "v1",
                credentials=self._credentials,
                cache_discovery=False,
            )
        except Exception as exc:  # noqa: BLE001 - surface as domain error
            raise GmailAuthenticationError(f"Failed to build Gmail client: {exc}") from exc

        self._service = service
        return service

    async def get_service(self) -> Any:
        """Return a cached Gmail API client, building it on first use."""
        if self._service is None:
            self._service = await asyncio.to_thread(self.authenticate)
        return self._service

    async def fetch_unread_emails(
        self,
        limit: int = 10,
        mark_as_read: bool = True,
    ) -> list[dict[str, Any]]:
        """Fetch unread messages from the authenticated mailbox."""
        service = await self.get_service()
        try:
            list_response = await asyncio.to_thread(
                lambda: service.users()
                .messages()
                .list(userId="me", q="is:unread", maxResults=limit)
                .execute()
            )
        except HttpError as exc:
            raise self._wrap_http_error(exc, "Failed to list unread Gmail messages.") from exc

        messages = list_response.get("messages", [])
        results: list[dict[str, Any]] = []

        for message_ref in messages:
            message_id = message_ref["id"]
            try:
                full_message = await asyncio.to_thread(
                    lambda mid=message_id: service.users()
                    .messages()
                    .get(userId="me", id=mid, format="full")
                    .execute()
                )
            except HttpError as exc:
                logger.error("Failed to fetch Gmail message %s: %s", message_id, exc)
                continue

            parsed = self._parse_message(full_message)
            results.append(parsed)

            if mark_as_read:
                await self._mark_message_as_read(service, message_id)

        return results

    async def create_draft(
        self,
        to: str,
        subject: str,
        body: str,
        thread_id: str | None = None,
    ) -> str:
        """Create a Gmail draft for the authenticated user."""
        service = await self.get_service()
        raw_message = self._build_raw_message(to=to, subject=subject, body=body, thread_id=thread_id)
        draft_body: dict[str, Any] = {"message": {"raw": raw_message}}
        if thread_id:
            draft_body["message"]["threadId"] = thread_id

        try:
            draft = await asyncio.to_thread(
                lambda: service.users().drafts().create(userId="me", body=draft_body).execute()
            )
        except HttpError as exc:
            raise self._wrap_http_error(exc, "Failed to create Gmail draft.") from exc

        draft_id = draft.get("id")
        if not draft_id:
            raise GmailAPIError("Gmail draft creation succeeded but returned no draft ID.")
        return draft_id

    async def send_draft(self, draft_gmail_id: str) -> dict[str, Any]:
        """Send an existing draft by Gmail draft identifier."""
        service = await self.get_service()
        try:
            sent = await asyncio.to_thread(
                lambda: service.users()
                .drafts()
                .send(userId="me", body={"id": draft_gmail_id})
                .execute()
            )
        except HttpError as exc:
            raise self._wrap_http_error(exc, "Failed to send Gmail draft.") from exc

        return sent

    async def modify_message_labels(
        self,
        message_id: str,
        add_labels: list[str] | None = None,
        remove_labels: list[str] | None = None,
    ) -> dict[str, Any]:
        """Add or remove Gmail labels on a message."""
        add_labels = add_labels or []
        remove_labels = remove_labels or []

        service = await self.get_service()
        body: dict[str, list[str]] = {}
        if add_labels:
            body["addLabelIds"] = add_labels
        if remove_labels:
            body["removeLabelIds"] = remove_labels

        try:
            return await asyncio.to_thread(
                lambda: service.users()
                .messages()
                .modify(userId="me", id=message_id, body=body)
                .execute()
            )
        except HttpError as exc:
            raise self._wrap_http_error(exc, "Failed to modify Gmail message labels.") from exc

    async def archive_message(self, message_id: str) -> dict[str, Any]:
        """Archive a message by removing the ``INBOX`` label."""
        return await self.modify_message_labels(message_id, remove_labels=["INBOX"])

    async def trash_message(self, message_id: str) -> dict[str, Any]:
        """Move a message to trash via ``users.messages.trash``."""
        service = await self.get_service()
        try:
            return await asyncio.to_thread(
                lambda: service.users()
                .messages()
                .trash(userId="me", id=message_id)
                .execute()
            )
        except HttpError as exc:
            raise self._wrap_http_error(exc, "Failed to trash Gmail message.") from exc

    async def star_message(self, message_id: str) -> dict[str, Any]:
        """Star a message by adding the ``STARRED`` label."""
        return await self.modify_message_labels(message_id, add_labels=["STARRED"])

    async def _mark_message_as_read(self, service: Any, message_id: str) -> None:
        """Remove the UNREAD label to avoid duplicate processing."""
        try:
            await asyncio.to_thread(
                lambda: service.users()
                .messages()
                .modify(
                    userId="me",
                    id=message_id,
                    body={"removeLabelIds": ["UNREAD"]},
                )
                .execute()
            )
        except HttpError as exc:
            logger.warning("Failed to mark message %s as read: %s", message_id, exc)

    def _parse_message(self, message: dict[str, Any]) -> dict[str, Any]:
        """Parse a Gmail API message resource into a normalized dictionary."""
        payload = message.get("payload", {})
        headers = {header["name"].lower(): header["value"] for header in payload.get("headers", [])}

        subject = headers.get("subject", "")
        sender = headers.get("from", "")
        recipient = headers.get("to", "")
        date_header = headers.get("date", "")

        body, body_html = self._extract_bodies_from_payload(payload)
        snippet = message.get("snippet", "")

        parsed_date = self._parse_date_header(date_header)

        return {
            "gmail_message_id": message.get("id", ""),
            "thread_id": message.get("threadId", ""),
            "subject": subject,
            "sender": parseaddr(sender)[1] or sender,
            "recipient": parseaddr(recipient)[1] or recipient,
            "date": parsed_date,
            "snippet": snippet,
            "body": body,
            "body_html": body_html,
        }

    def _extract_bodies_from_payload(
        self,
        payload: dict[str, Any],
    ) -> tuple[str | None, str | None]:
        """Recursively extract plain-text and HTML bodies from a MIME payload tree."""
        plain_parts: list[str] = []
        html_parts: list[str] = []

        def walk(part: dict[str, Any]) -> None:
            mime_type = part.get("mimeType", "")
            body = part.get("body", {})
            data = body.get("data")

            if data:
                decoded = self._decode_base64url(data)
                if mime_type == "text/plain":
                    plain_parts.append(decoded)
                elif mime_type == "text/html":
                    html_parts.append(decoded)
                elif mime_type.startswith("text/") and not plain_parts:
                    plain_parts.append(decoded)

            for child in part.get("parts", []) or []:
                walk(child)

        walk(payload)

        plain = "\n".join(plain_parts).strip() or None
        html = "\n".join(html_parts).strip() or None
        return plain, html

    @staticmethod
    def _decode_base64url(data: str) -> str:
        """Decode a Gmail API base64url-encoded payload segment."""
        padding = "=" * (-len(data) % 4)
        raw_bytes = base64.urlsafe_b64decode(data + padding)
        return raw_bytes.decode("utf-8", errors="replace")

    @staticmethod
    def _parse_date_header(date_header: str) -> str | None:
        """Convert an RFC 2822 date header to ISO-8601 when possible."""
        if not date_header:
            return None
        try:
            return parsedate_to_datetime(date_header).isoformat()
        except (TypeError, ValueError, OverflowError):
            return date_header

    @staticmethod
    def _build_raw_message(
        to: str,
        subject: str,
        body: str,
        thread_id: str | None = None,
    ) -> str:
        """Build a base64url-encoded RFC 2822 message for the Gmail API."""
        mime_message = MIMEText(body, "plain", "utf-8")
        mime_message["to"] = to
        mime_message["subject"] = subject
        if thread_id:
            mime_message["X-Gmail-Thread-Id"] = thread_id

        raw_bytes = mime_message.as_bytes()
        return base64.urlsafe_b64encode(raw_bytes).decode("utf-8")

    @staticmethod
    def _wrap_http_error(exc: HttpError, context: str) -> GmailAPIError:
        """Convert googleapiclient HttpError into a domain-specific exception."""
        status_code = getattr(exc.resp, "status", None)
        message = f"{context} Gmail API error ({status_code}): {exc}"
        logger.error(message)
        return GmailAPIError(message, status_code=status_code)
