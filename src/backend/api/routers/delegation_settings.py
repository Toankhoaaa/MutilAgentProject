"""Router for per-user delegation settings (company header + signature)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.auth_dependencies import get_current_user
from backend.api.dependencies import get_db
from backend.models.delegation_settings import DelegationSettings
from backend.models.user import User
from backend.schemas.api_schemas import DelegationSettingsResponse, DelegationSettingsUpdate

router = APIRouter(tags=["Delegation Settings"])


def _get_or_create(db: Session, user: User) -> DelegationSettings:
    row = db.scalars(
        select(DelegationSettings).where(DelegationSettings.user_id == user.id)
    ).first()
    if row is None:
        row = DelegationSettings(user_id=user.id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.get(
    "/delegation-settings",
    response_model=DelegationSettingsResponse,
    summary="Get delegation settings (company header + signature) for the current user",
)
def get_delegation_settings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DelegationSettingsResponse:
    row = _get_or_create(db, current_user)
    return DelegationSettingsResponse(
        company_header=row.company_header,
        signature=row.signature,
    )


@router.put(
    "/delegation-settings",
    response_model=DelegationSettingsResponse,
    summary="Update delegation settings (upsert) for the current user",
)
def update_delegation_settings(
    payload: DelegationSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DelegationSettingsResponse:
    row = _get_or_create(db, current_user)
    row.company_header = payload.company_header
    row.signature = payload.signature
    db.commit()
    db.refresh(row)
    return DelegationSettingsResponse(
        company_header=row.company_header,
        signature=row.signature,
    )
