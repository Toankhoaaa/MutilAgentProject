"""FastAPI router for Email Rules Engine."""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.auth_dependencies import get_current_user
from backend.api.dependencies import get_db
from backend.models.email_rule import EmailRule
from backend.models.user import User
from backend.schemas.rule_schemas import EmailRuleCreate, EmailRuleResponse, EmailRuleUpdate
from backend.services.rule_engine import RuleEngine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/rules", tags=["Rules"])

_engine = RuleEngine()


# ── Request bodies ────────────────────────────────────────────────────────────

class _ReorderRequest(BaseModel):
    rule_ids: list[UUID]


class _TestRuleRequest(BaseModel):
    email: dict


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_rule_or_404(rule_id: UUID, user_id: UUID, db: Session) -> EmailRule:
    rule = db.scalars(
        select(EmailRule).where(
            EmailRule.id == rule_id,
            EmailRule.user_id == user_id,
        )
    ).first()
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rule not found.")
    return rule


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[EmailRuleResponse], summary="List rules")
def list_rules(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[EmailRuleResponse]:
    rules = db.scalars(
        select(EmailRule)
        .where(EmailRule.user_id == current_user.id)
        .order_by(EmailRule.priority)
    ).all()
    return [EmailRuleResponse.model_validate(r) for r in rules]


@router.post(
    "",
    response_model=EmailRuleResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create rule",
)
def create_rule(
    payload: EmailRuleCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EmailRuleResponse:
    if payload.priority is None:
        max_priority = db.scalar(
            select(EmailRule.priority)
            .where(EmailRule.user_id == current_user.id)
            .order_by(EmailRule.priority.desc())
            .limit(1)
        )
        priority = 0 if max_priority is None else max_priority + 1
    else:
        priority = payload.priority

    rule = EmailRule(
        user_id=current_user.id,
        name=payload.name,
        field=payload.field,
        operator=payload.operator,
        value=payload.value,
        action=payload.action,
        action_value=payload.action_value,
        priority=priority,
        is_active=payload.is_active,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return EmailRuleResponse.model_validate(rule)


@router.post("/reorder", status_code=status.HTTP_204_NO_CONTENT, summary="Reorder rules")
def reorder_rules(
    payload: _ReorderRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Bulk-assign priority based on position in the provided ID list."""
    rules_by_id = {
        r.id: r
        for r in db.scalars(
            select(EmailRule).where(
                EmailRule.id.in_(payload.rule_ids),
                EmailRule.user_id == current_user.id,
            )
        ).all()
    }
    for priority, rule_id in enumerate(payload.rule_ids):
        rule = rules_by_id.get(rule_id)
        if rule is not None:
            rule.priority = priority
    db.commit()


@router.put("/{rule_id}", response_model=EmailRuleResponse, summary="Update rule")
def update_rule(
    rule_id: UUID,
    payload: EmailRuleUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> EmailRuleResponse:
    rule = _get_rule_or_404(rule_id, current_user.id, db)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(rule, field, value)
    db.commit()
    db.refresh(rule)
    return EmailRuleResponse.model_validate(rule)


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete rule")
def delete_rule(
    rule_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    rule = _get_rule_or_404(rule_id, current_user.id, db)
    db.delete(rule)
    db.commit()


@router.post("/{rule_id}/test", summary="Test rule against email")
def test_rule(
    rule_id: UUID,
    payload: _TestRuleRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    rule = _get_rule_or_404(rule_id, current_user.id, db)
    matched = _engine._matches(payload.email, rule)
    return {"matched": matched}
