from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

_ALLOWED_FIELDS = frozenset({"sender", "subject", "body", "sender_domain"})
_ALLOWED_OPERATORS = frozenset(
    {"contains", "equals", "starts_with", "ends_with", "not_contains", "regex"}
)
_ALLOWED_ACTIONS = frozenset(
    {"force_category", "skip_ai", "trash", "alert", "skip_draft"}
)


class EmailRuleCreate(BaseModel):
    name: str
    field: str
    operator: str
    value: str
    action: str
    action_value: str | None = None
    priority: int | None = None
    is_active: bool = True

    @field_validator("field")
    @classmethod
    def validate_field(cls, v: str) -> str:
        if v not in _ALLOWED_FIELDS:
            raise ValueError(f"field must be one of {sorted(_ALLOWED_FIELDS)}")
        return v

    @field_validator("operator")
    @classmethod
    def validate_operator(cls, v: str) -> str:
        if v not in _ALLOWED_OPERATORS:
            raise ValueError(f"operator must be one of {sorted(_ALLOWED_OPERATORS)}")
        return v

    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str) -> str:
        if v not in _ALLOWED_ACTIONS:
            raise ValueError(f"action must be one of {sorted(_ALLOWED_ACTIONS)}")
        return v


class EmailRuleUpdate(BaseModel):
    name: str | None = None
    field: str | None = None
    operator: str | None = None
    value: str | None = None
    action: str | None = None
    action_value: str | None = None
    priority: int | None = None
    is_active: bool | None = None

    @field_validator("field")
    @classmethod
    def validate_field(cls, v: str | None) -> str | None:
        if v is not None and v not in _ALLOWED_FIELDS:
            raise ValueError(f"field must be one of {sorted(_ALLOWED_FIELDS)}")
        return v

    @field_validator("operator")
    @classmethod
    def validate_operator(cls, v: str | None) -> str | None:
        if v is not None and v not in _ALLOWED_OPERATORS:
            raise ValueError(f"operator must be one of {sorted(_ALLOWED_OPERATORS)}")
        return v

    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str | None) -> str | None:
        if v is not None and v not in _ALLOWED_ACTIONS:
            raise ValueError(f"action must be one of {sorted(_ALLOWED_ACTIONS)}")
        return v


class EmailRuleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    name: str
    field: str
    operator: str
    value: str
    action: str
    action_value: str | None
    priority: int
    is_active: bool
    created_at: datetime
    match_count: int
