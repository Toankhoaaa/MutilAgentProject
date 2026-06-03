"""Privacy masking agent — redacts PII from email content before LLM processing."""

from __future__ import annotations

import re
from typing import Any

_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # Email addresses
    (
        re.compile(r'\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b'),
        "[REDACTED_EMAIL]",
    ),
    # Names preceded by a common honorific (best-effort without NLP)
    (
        re.compile(r'\b(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b'),
        "[REDACTED_NAME]",
    ),
    # Credit card numbers — 16 digits in 4×4 groups (optional space/dash separators)
    (
        re.compile(r'\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b'),
        "[REDACTED_CC]",
    ),
    # Phone numbers — North American and international formats
    (
        re.compile(r'\b(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b'),
        "[REDACTED_PHONE]",
    ),
]


class PrivacyAgent:
    """Masks PII in email text using regex patterns before passing content to LLM agents."""

    def mask(self, text: str) -> str:
        """Return *text* with PII replaced by labelled placeholders."""
        for pattern, replacement in _PATTERNS:
            text = pattern.sub(replacement, text)
        return text

    def mask_email_dict(self, raw_email: dict[str, Any]) -> dict[str, Any]:
        """Return a shallow copy of *raw_email* with content fields masked.

        Only ``body``, ``subject``, and ``snippet`` are redacted — routing
        fields (``sender``, ``gmail_message_id``, ``thread_id``) are left
        intact so downstream dispatch logic continues to work.
        """
        return {
            **raw_email,
            "body": self.mask(raw_email.get("body") or ""),
            "subject": self.mask(raw_email.get("subject") or ""),
            "snippet": self.mask(raw_email.get("snippet") or ""),
        }
