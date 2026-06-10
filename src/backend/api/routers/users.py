"""Admin CRUD endpoints for user management."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from backend.api.dependencies import get_db, require_admin
from backend.models.user import User

router = APIRouter(prefix="/admin/users", tags=["Admin · Users"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class UserAdminResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    email: str
    display_name: str | None
    is_active: bool
    is_admin: bool
    subscription_tier: str
    max_requests: int
    request_count: int
    status: str
    tier_expires_at: datetime | None
    created_at: datetime


class UserListResponse(BaseModel):
    items: list[UserAdminResponse]
    total: int
    page: int
    limit: int


class CreateUserRequest(BaseModel):
    email: str
    display_name: str | None = None
    is_admin: bool = False
    subscription_tier: str = "FREE"
    max_requests: int = 100


class UpdateUserRequest(BaseModel):
    subscription_tier: str | None = None
    max_requests: int | None = None
    request_count: int | None = None
    status: str | None = None
    is_admin: bool | None = None
    tier_expires_at: datetime | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_user_or_404(user_id: uuid.UUID, db: Session) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")
    return user


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=UserListResponse, summary="List users (admin)")
def list_users(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, description="Filter by email or display name."),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserListResponse:
    q = select(User)
    if search:
        pattern = f"%{search}%"
        q = q.where(or_(User.email.ilike(pattern), User.display_name.ilike(pattern)))
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.scalars(q.offset((page - 1) * limit).limit(limit)).all()
    return UserListResponse(
        items=[UserAdminResponse.model_validate(u) for u in rows],
        total=total or 0,
        page=page,
        limit=limit,
    )


@router.post(
    "",
    response_model=UserAdminResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create user (admin)",
)
def create_user(
    payload: CreateUserRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserAdminResponse:
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered.",
        )
    user = User(
        email=payload.email,
        display_name=payload.display_name,
        is_admin=payload.is_admin,
        subscription_tier=payload.subscription_tier,
        max_requests=payload.max_requests,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserAdminResponse.model_validate(user)


@router.put(
    "/{user_id}",
    response_model=UserAdminResponse,
    summary="Update user (admin)",
)
def update_user(
    user_id: uuid.UUID,
    payload: UpdateUserRequest,
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> UserAdminResponse:
    user = _get_user_or_404(user_id, db)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(user, field, value)
    user.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return UserAdminResponse.model_validate(user)


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete user (admin)",
)
def delete_user(
    user_id: uuid.UUID,
    hard: bool = Query(False, description="Permanently remove the record. Default: soft-delete (suspend)."),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    user = _get_user_or_404(user_id, db)
    if hard:
        db.delete(user)
    else:
        user.is_active = False
        user.status = "SUSPENDED"
        user.updated_at = datetime.now(timezone.utc)
    db.commit()
