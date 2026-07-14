"""Pydantic contracts for multi-agent email processing."""

from __future__ import annotations

import re
from datetime import date, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class EmailCategory(str, Enum):
    """Allowed email classification categories."""

    URGENT = "urgent"
    IMPORTANT = "important"
    NEED_REPLY = "need_reply"
    NEWSLETTER = "newsletter"
    SPAM = "spam"


class EmailClassificationOutput(BaseModel):
    """
    Structured output produced by the Classifier Agent.

    This schema is the single source of truth for downstream orchestration.
    """

    model_config = {"strict": True}

    category: EmailCategory = Field(
        ...,
        description="One of: urgent, important, need_reply, newsletter, spam.",
    )
    priority_score: int = Field(
        ...,
        ge=1,
        le=5,
        description="Priority from 1 (lowest) to 5 (highest).",
    )
    summary: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Concise summary of the email in at most two sentences.",
    )
    deadline: str | date | None = Field(
        default=None,
        description="Detected deadline (ISO date string) or None when not mentioned.",
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Model confidence in the classification.",
    )

    @field_validator("summary")
    @classmethod
    def validate_summary_length(cls, value: str) -> str:
        """Truncate to two sentences when the model returns more."""
        cleaned = " ".join(value.split())
        sentences = re.split(r"(?<=[.!?])\s+", cleaned.strip())
        if len(sentences) > 2:
            return " ".join(sentences[:2])
        return cleaned


class EmailResponseOutput(BaseModel):
    """Structured draft reply produced by the Response Agent."""

    model_config = {"strict": True}

    subject: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Reply email subject line.",
    )
    body_content: str = Field(
        ...,
        min_length=1,
        description="Full plain-text body of the reply email.",
    )


class SecurityAnalysisOutput(BaseModel):
    """
    Structured security verdict produced by the Security Agent.

    ``is_safe`` is the primary signal; ``risk_level`` and ``warnings``
    provide actionable detail for the UI and downstream decision logic.
    """

    model_config = {"strict": True}

    is_safe: bool = Field(
        ...,
        description="True when the email carries no significant security risk.",
    )
    risk_level: Literal["low", "medium", "high"] = Field(
        ...,
        description=(
            "low — suspicious but not actionable; "
            "medium — likely malicious or deceptive; "
            "high — confirmed phishing, fraud, or malware vector."
        ),
    )
    warnings: list[str] = Field(
        default_factory=list,
        description=(
            "Human-readable list of detected threat indicators, "
            "e.g. 'Giả mạo sếp yêu cầu chuyển tiền gấp', 'URL ngụy trang'. "
            "Empty when is_safe is True."
        ),
    )


class EmailAnalysisOutput(BaseModel):
    """
    Structured deep-analysis produced by the Email Analysis Agent.

    Covers language detection, Vietnamese summary, translation (when needed),
    action-item extraction, and sentiment classification.
    """

    model_config = {"strict": True}

    detected_language: str = Field(
        ...,
        min_length=2,
        max_length=5,
        description="ISO 639-1 language code of the email body, e.g. 'vi', 'en', 'zh', 'ja'.",
    )
    summary: list[str] = Field(
        ...,
        min_length=1,
        max_length=3,
        description=(
            "Bullet-point summary in Vietnamese. Maximum 3 items, "
            "total across all bullets must stay under 80 words."
        ),
    )
    translation: str | None = Field(
        default=None,
        description=(
            "Core content translated to professional Vietnamese. "
            "Set to null when detected_language is 'vi'."
        ),
    )
    action_items: list[str] = Field(
        default_factory=list,
        description=(
            "Critical actions the recipient must take, written in Vietnamese. "
            "Empty list when the email contains no actionable requests."
        ),
    )
    sentiment: Literal["Positive", "Neutral", "Negative"] = Field(
        ...,
        description="Overall tone of the email: Positive, Neutral, or Negative.",
    )

    @field_validator("summary")
    @classmethod
    def validate_summary_word_count(cls, bullets: list[str]) -> list[str]:
        """Guard the 80-word limit across all bullet points combined."""
        total_words = sum(len(b.split()) for b in bullets)
        if total_words > 80:
            raise ValueError(
                f"Summary exceeds 80-word limit (got {total_words} words)."
            )
        return bullets


class SchedulingActionSchema(BaseModel):
    """Structured calendar action extracted from a meeting request."""

    action_type: Literal["CREATE", "UPDATE"] = Field(
        ...,
        description=(
            "CREATE for a new calendar event; UPDATE when the email explicitly "
            "asks to reschedule or modify an existing event."
        ),
    )
    start_time: datetime = Field(
        ...,
        description=(
            "Meeting start time. Assumed timezone: Asia/Ho_Chi_Minh (+07:00) "
            "when not specified in the source text."
        ),
    )
    end_time: datetime = Field(
        ...,
        description="Meeting end time. Defaults to start_time + 1 hour when not specified.",
    )
    attendees: list[str] = Field(
        default_factory=list,
        description=(
            "Email addresses of all meeting attendees. Always include the sender's "
            "email address. Add any other addresses explicitly mentioned in the email."
        ),
    )


class SchedulingOutput(BaseModel):
    """
    Structured output produced by the Scheduling Agent.

    When ``is_meeting_request`` is ``False``, the datetime and summary
    fields are ``None`` and no Calendar event should be created.
    When ``True``, all three fields are required non-empty strings in
    ISO 8601 format with explicit ``+07:00`` timezone offset.
    ``action`` carries the same times as typed ``datetime`` objects and is
    populated whenever a concrete meeting time is extracted.
    """

    model_config = {"strict": True}

    is_meeting_request: bool = Field(
        ...,
        description="True when the email contains a concrete meeting/scheduling request.",
    )
    start_datetime: str | None = Field(
        default=None,
        description=(
            "Meeting start time in ISO 8601 with Vietnam timezone offset, "
            "e.g. '2026-05-29T14:00:00+07:00'. Required when is_meeting_request is True."
        ),
    )
    end_datetime: str | None = Field(
        default=None,
        description=(
            "Meeting end time in ISO 8601. Defaults to start + 1 hour when "
            "the email does not specify a duration. Required when is_meeting_request is True."
        ),
    )
    action: SchedulingActionSchema | None = Field(
        default=None,
        description=(
            "Typed calendar action with parsed datetime fields. Populated when "
            "is_meeting_request is True and a concrete meeting time was extracted."
        ),
    )
    event_summary: str | None = Field(
        default=None,
        description=(
            "Short, descriptive event title for Google Calendar, "
            "e.g. 'Meeting with Nguyễn Văn A'. Required when is_meeting_request is True."
        ),
    )
    suggested_reply: str = Field(
        ...,
        description=(
            "Professional confirmation reply in the same language as the original email, "
            "including the agreed time and a Google Meet link placeholder {{meet_link}}. "
            "Empty string when is_meeting_request is False."
        ),
    )

    @field_validator("action", mode="before")
    @classmethod
    def coerce_action(cls, v: Any) -> SchedulingActionSchema | None:
        """Allow dict → SchedulingActionSchema coercion under strict mode."""
        if isinstance(v, dict):
            return SchedulingActionSchema.model_validate(v)
        return v

    @model_validator(mode="after")
    def validate_meeting_fields(self) -> "SchedulingOutput":
        # is_meeting_request=True + action=None is valid: vague request, no concrete time.
        # Only enforce datetime/summary when a concrete action (with times) is present.
        if self.is_meeting_request and self.action is not None:
            missing = [
                field
                for field, val in [
                    ("start_datetime", self.start_datetime),
                    ("end_datetime", self.end_datetime),
                    ("event_summary", self.event_summary),
                ]
                if not val
            ]
            if missing:
                raise ValueError(
                    f"Fields {missing} must be non-null when action is set."
                )
        return self


# ---------------------------------------------------------------------------
# Delegation agent schemas
# ---------------------------------------------------------------------------


class DepartmentAssignment(BaseModel):
    """One department's portion of work extracted from an email."""

    department_name: str = Field(
        ...,
        description=(
            "Name of the department. Use 'Chưa xác định' when no department clearly "
            "matches or when work items touch keywords of two or more departments ambiguously."
        ),
    )
    matched_department_id: str | None = Field(
        default=None,
        description="'id' value from known_departments that best matches; null when department_name is 'Chưa xác định'.",
    )
    work_items: list[str] = Field(
        ...,
        min_length=1,
        description="Work items belonging EXCLUSIVELY to this department.",
    )
    priority: int = Field(default=3, ge=1, le=5, description="Priority 1 (lowest) – 5 (highest).")
    suggested_deadline: str | None = Field(
        default=None,
        description="ISO YYYY-MM-DD date if the email mentions a deadline; null otherwise.",
    )
    confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description=(
            "Confidence 0.0–1.0 in the department assignment. "
            "≥0.7 = clear keyword match; <0.7 = ambiguous or inferred."
        ),
    )
    reason: str | None = Field(
        default=None,
        description="Short Vietnamese explanation of why this department was assigned (or not).",
    )


class DelegationOutput(BaseModel):
    """Structured output of the Delegation Agent."""

    is_delegation: bool = Field(
        ...,
        description=(
            "True when the email assigns concrete work to ONE OR MORE departments/teams. "
            "False only for announcements, newsletters, or purely personal messages."
        ),
    )
    assignments: list[DepartmentAssignment] = Field(
        default_factory=list,
        description="One entry per department (or 'Chưa xác định'). Empty when is_delegation is False.",
    )
