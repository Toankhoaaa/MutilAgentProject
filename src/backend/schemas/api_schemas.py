"""REST API Pydantic schemas for the Multi-Agent Email Orchestrator."""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Generic, Literal, TypeVar
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

_ALLOWED_TONES: frozenset[str] = frozenset({"Formal", "Polite", "Professional", "Friendly", "Casual"})


class ClassificationResponse(BaseModel):
    """Serialized classification row linked to an email."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email_id: UUID
    category: str | None = None
    priority_score: int | None = None
    summary: str | None = None
    deadline: date | None = None
    confidence: float | None = None
    created_at: datetime


class DraftResponse(BaseModel):
    """Serialized draft row for an email."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email_id: UUID
    draft_content: str
    draft_gmail_id: str | None = None
    subject: str | None = None
    is_modified: bool | None = None
    is_sent: bool | None = None
    sent_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class AuditLogResponse(BaseModel):
    """Serialized audit log entry."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: UUID | None = None
    email_id: UUID | None = None
    agent_name: str | None = None
    action: str | None = None
    status: str | None = None
    details: dict[str, object] | list[object] | None = None
    ip_address: str | None = None
    created_at: datetime


class EmailResponse(BaseModel):
    """Email row with optional nested classification and draft (for ORM reads)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    gmail_message_id: str
    thread_id: str | None = None
    sender: str | None = None
    recipient: str | None = None
    subject: str | None = None
    body: str | None = None
    body_html: str | None = None
    received_at: datetime | None = None
    is_processed: bool
    processed_at: datetime | None = None
    labels: list[str] | None = None
    created_at: datetime
    updated_at: datetime
    classification: ClassificationResponse | None = None
    draft: DraftResponse | None = None
    scheduling: "SchedulingDataResponse | None" = None


T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """Standard pagination envelope for list endpoints."""

    items: list[T]
    total: int = Field(..., ge=0, description="Total rows matching filters (before pagination).")
    limit: int = Field(..., ge=1, description="Maximum items per page.")
    offset: int = Field(..., ge=0, description="Number of items skipped.")


class DraftUpdateSchema(BaseModel):
    """Payload to update stored draft text before sending."""

    draft_content: str = Field(..., min_length=1, description="Updated plain-text draft body.")


class GmailEmailItem(BaseModel):
    """A single Gmail message returned by the list endpoint (no DB persistence)."""

    gmail_message_id: str
    thread_id: str | None = None
    subject: str | None = None
    sender: str | None = None
    date: str | None = None
    snippet: str | None = None


class GmailListResponse(BaseModel):
    """Paginated Gmail inbox response."""

    emails: list[GmailEmailItem]
    next_page_token: str | None = None


class ProcessedEmailDetail(BaseModel):
    """Per-email result from the AI processing pipeline (no DB persistence)."""

    gmail_message_id: str
    subject: str | None = None
    sender: str | None = None
    category: str
    priority_score: int
    summary: str
    confidence: float
    draft_subject: str | None = None
    has_draft: bool = False
    is_safe: bool = True
    security_risk_level: str | None = None
    security_warnings: list[str] = Field(default_factory=list)


class ProcessEmailsResponse(BaseModel):
    """Result of triggering the email orchestrator batch."""

    fetched: int = 0
    processed: int = 0
    skipped_duplicate: int = 0
    failed: int = 0
    drafts_created: int = 0
    run_id: str | None = None
    llm_calls_count: int = 0
    llm_total_time_ms: int = 0
    total_time_ms: int = 0
    errors: list[dict[str, object]] = Field(default_factory=list)
    processed_emails: list[ProcessedEmailDetail] = Field(default_factory=list)


class DraftSendResponse(BaseModel):
    """Outcome of sending a Gmail draft."""

    message: str = Field(default="Draft sent successfully.")
    gmail_message_id: str | None = Field(
        default=None,
        description="Sent message id from Gmail API.",
    )
    gmail_thread_id: str | None = Field(
        default=None,
        description="Thread id returned after send.",
    )


class AgentRunResponse(BaseModel):
    """Serialized batch run record from ``agent_runs``."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    run_type: str | None = None
    triggered_by: str | None = None
    total_emails_processed: int | None = None
    total_time_ms: int | None = None
    llm_calls_count: int | None = None
    llm_total_time_ms: int | None = None
    status: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None


class AgentStatusResponse(BaseModel):
    """Current orchestrator status derived from the latest ``agent_runs`` row."""

    system_status: str = Field(
        ...,
        description='High-level state: "idle", "running", or "degraded".',
    )
    latest_run: AgentRunResponse | None = None
    message: str | None = None


class ClassifyTestRequest(BaseModel):
    """Payload for stateless classifier agent testing (no DB persistence)."""

    subject: str = Field(..., min_length=1, max_length=500)
    body: str = Field(..., min_length=1)
    sender: str | None = Field(default=None, max_length=255)


class DraftTestRequest(BaseModel):
    """Payload for stateless response agent testing (no DB persistence)."""

    email_subject: str = Field(..., min_length=1, max_length=500)
    email_body: str = Field(..., min_length=1)
    category: str = Field(
        ...,
        description="Classification category: urgent, important, need_reply, newsletter, spam.",
    )
    priority_score: int = Field(..., ge=1, le=5)
    summary: str = Field(..., min_length=1, max_length=500)
    deadline: str | date | None = None
    confidence: float = Field(..., ge=0.0, le=1.0)
    tone: str = Field(
        default="Professional",
        description="Writing tone: Formal, Polite, Professional, Friendly, or Casual.",
    )

    @field_validator("tone")
    @classmethod
    def validate_tone(cls, v: str) -> str:
        if v not in _ALLOWED_TONES:
            raise ValueError(f"tone must be one of {sorted(_ALLOWED_TONES)}")
        return v


class ConfigurationResponse(BaseModel):
    """Serialized configuration key-value row."""

    model_config = ConfigDict(from_attributes=True)

    key: str
    value: str | None = None
    data_type: str | None = None
    description: str | None = None
    is_editable: bool | None = None
    updated_at: datetime


class ConfigurationUpdateSchema(BaseModel):
    """Update a single configuration entry by key."""

    key: str = Field(..., min_length=1, max_length=100)
    value: str = Field(..., description="New configuration value.")


class AgentToneUpdateSchema(BaseModel):
    """Update the response agent writing tone."""

    tone: str = Field(
        ...,
        min_length=1,
        max_length=50,
        description='Tone preset, e.g. "professional", "friendly", "concise".',
    )


class UserSignatureUpdateSchema(BaseModel):
    """Update the email signature appended to AI drafts."""

    signature: str = Field(
        ...,
        min_length=1,
        max_length=1000,
        description="Plain-text signature block appended to reply emails.",
    )


class AnalyzeEmailRequest(BaseModel):
    """Request payload for the stateless email analysis endpoint."""

    gmail_message_id: str | None = Field(default=None, max_length=255)
    subject: str = Field(..., min_length=1, max_length=500)
    body: str = Field(..., min_length=1)
    sender: str | None = Field(default=None, max_length=255)


class EventDetailsResponse(BaseModel):
    """Structured calendar event extracted from the email."""

    event_title: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    attendees: list[str] = Field(default_factory=list)


class AnalyzeEmailResponse(BaseModel):
    """Unified analysis + scheduling result returned by POST /emails/analyze."""

    summary: list[str]
    sentiment: str
    action_items: list[str]
    translation: str | None = None
    detected_language: str
    has_event: bool
    event_details: EventDetailsResponse | None = None
    scheduling_id: str | None = None
    is_safe: bool = True
    risk_level: Literal["low", "medium", "high"] = "low"
    warnings: list[str] = []


class ScheduleEventResponse(BaseModel):
    """A single scheduling row shaped for the frontend ScheduleEvent interface."""

    id: str
    title: str
    startTime: str
    endTime: str
    attendees: list[str]
    status: str
    emailSnippet: str
    alternativeSlots: list[str] = Field(default_factory=list)
    html_link: str | None = None
    meet_link: str | None = None
    is_synced: bool = False


class AuthLoginResponse(BaseModel):
    """Google OAuth authorization URL for the frontend redirect."""

    authorization_url: str
    state: str


class TokenResponse(BaseModel):
    """JWT issued after successful Google OAuth callback."""

    access_token: str
    token_type: str = "bearer"
    expires_in_minutes: int
    user: "UserProfileResponse"


class UserProfileResponse(BaseModel):
    """Public user profile returned by ``/auth/me``."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    display_name: str | None = None
    is_active: bool
    is_admin: bool = False


class EmailAnalysisResponse(BaseModel):
    """AI deep-analysis result for a single email (cached in DB)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email_id: UUID
    detected_language: str
    summary: list[str]
    translation: str | None = None
    action_items: list[str]
    sentiment: str
    created_at: datetime
    updated_at: datetime


class SchedulingDataResponse(BaseModel):
    """AI-extracted scheduling data for an email (cached in DB)."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email_id: UUID
    is_meeting_request: bool
    start_datetime: str | None = None
    end_datetime: str | None = None
    event_summary: str | None = None
    suggested_reply: str | None = None
    calendar_event_id: str | None = None
    calendar_html_link: str | None = None
    meet_link: str | None = None
    event_created_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class CreateEventResponse(BaseModel):
    """Result of creating a Google Calendar event from an email."""

    message: str
    event_id: str | None = None
    html_link: str | None = None
    meet_link: str | None = None
    is_available: bool = True


class EmailActionResponse(BaseModel):
    """Result of a Gmail label mutation on a stored email."""

    message: str
    email_id: UUID
    gmail_message_id: str
    labels: list[str] | None = None


class ProcessEmailRequest(BaseModel):
    """Raw email text submitted for stateless classification and draft generation."""

    gmail_message_id: str | None = Field(default=None, max_length=255, description="Gmail message ID for cache lookup.")
    text: str = Field(..., min_length=1, description="Email body text.")
    subject: str = Field(default="", description="Email subject line.")
    sender: str = Field(default="", description="Sender email address.")
    task_id: str | None = Field(default=None, description="Client-generated UUID for cooperative cancellation.")
    tone: str = Field(
        default="Professional",
        description="Writing tone for the AI reply: Formal, Polite, Professional, Friendly, or Casual.",
    )
    generate_draft: bool = Field(
        default=False,
        description="When True, bypass classification cache and always run the Response Agent.",
    )

    @field_validator("tone")
    @classmethod
    def validate_tone(cls, v: str) -> str:
        if v not in _ALLOWED_TONES:
            raise ValueError(f"tone must be one of {sorted(_ALLOWED_TONES)}")
        return v


class ProcessEmailResult(BaseModel):
    """Classification and optional draft returned synchronously without DB persistence."""

    category: str
    priority_score: int
    summary: str
    confidence: float
    draft_content: str | None = None
    draft_subject: str | None = None
    is_safe: bool = True
    security_risk_level: str | None = None
    security_warnings: list[str] = Field(default_factory=list)


class QuickClassifyItem(BaseModel):
    """A single message to classify in a lightweight batch request."""

    thread_id: str
    subject: str
    snippet: str = ""
    sender: str | None = None


class QuickClassifyResult(BaseModel):
    """Lightweight classification result for a single message."""

    thread_id: str
    category: str
    priority_score: int
    confidence: float


# ---------------------------------------------------------------------------
# Task management schemas
# ---------------------------------------------------------------------------


class TaskStatus(str, Enum):
    suggested = "suggested"
    todo = "todo"
    in_progress = "in_progress"
    done = "done"
    dismissed = "dismissed"


class TaskSource(str, Enum):
    manual = "manual"
    ai_email = "ai_email"
    delegation = "delegation"


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    priority: int = Field(default=3, ge=1, le=5)
    deadline: date | None = None
    remind_at: datetime | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    priority: int | None = Field(default=None, ge=1, le=5)
    deadline: date | None = None
    status: TaskStatus | None = None
    remind_at: datetime | None = None


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str
    description: str | None = None
    status: str
    priority: int
    deadline: date | None = None
    remind_at: datetime | None = None
    source: str
    source_email_id: str | None = None
    source_thread_id: str | None = None
    department: str | None = None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None = None


# ---------------------------------------------------------------------------
# Department management schemas
# ---------------------------------------------------------------------------


class DepartmentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=1, max_length=255)
    keywords: str | None = Field(default=None, max_length=1000)

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        if "@" not in v:
            raise ValueError("Invalid email address.")
        return v.strip().lower()


class DepartmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    email: str | None = Field(default=None, min_length=1, max_length=255)
    keywords: str | None = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str | None) -> str | None:
        if v is not None and "@" not in v:
            raise ValueError("Invalid email address.")
        return v.strip().lower() if v else v


class DepartmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    name: str
    email: str
    keywords: str | None = None
    created_at: datetime


# ---------------------------------------------------------------------------
# Delegation schemas
# ---------------------------------------------------------------------------


class DelegationItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    delegation_id: UUID
    department_name: str | None = None
    department_id: UUID | None = None
    recipient_email: str | None = None
    work_items: list[str] = Field(default_factory=list)
    draft_subject: str | None = None
    draft_body: str | None = None
    gmail_draft_id: str | None = None
    cc_emails: str | None = None
    bcc_emails: str | None = None
    confidence: float | None = None
    reason: str | None = None
    status: str
    sent_at: datetime | None = None
    already_sent_warning: bool = False


class DelegationResponse(BaseModel):
    id: UUID
    user_id: UUID
    source_email_id: str
    source_thread_id: str | None = None
    original_subject: str | None = None
    status: str
    created_at: datetime
    items: list[DelegationItemResponse] = Field(default_factory=list)


class DelegateEmailResponse(BaseModel):
    is_delegation: bool
    message: str | None = None
    delegation: DelegationResponse | None = None


class DelegationItemUpdate(BaseModel):
    recipient_email: str | None = None
    draft_subject: str | None = None
    draft_body: str | None = None
    cc_emails: str | None = None
    bcc_emails: str | None = None
    department_id: UUID | None = None


# ---------------------------------------------------------------------------
# Delegation settings schemas
# ---------------------------------------------------------------------------


class DelegationSettingsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    company_header: str | None = None
    signature: str | None = None


class DelegationSettingsUpdate(BaseModel):
    company_header: str | None = None
    signature: str | None = None
