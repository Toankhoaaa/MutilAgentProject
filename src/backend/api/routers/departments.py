"""FastAPI router for per-user department management."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.api.auth_dependencies import get_current_user
from backend.api.dependencies import get_db
from backend.models.department import Department
from backend.models.user import User
from backend.schemas.api_schemas import DepartmentCreate, DepartmentResponse, DepartmentUpdate

router = APIRouter(prefix="/departments", tags=["Departments"])


def _get_owned(db: Session, dept_id: uuid.UUID, current_user: User) -> Department:
    row = db.get(Department, dept_id)
    if row is None or row.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Department not found.")
    return row


@router.get("", response_model=list[DepartmentResponse], summary="List departments for the current user")
def list_departments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Department]:
    return list(db.scalars(select(Department).where(Department.user_id == current_user.id)).all())


@router.post(
    "",
    response_model=DepartmentResponse,
    status_code=201,
    summary="Create a department",
)
def create_department(
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Department:
    row = Department(
        user_id=current_user.id,
        name=payload.name,
        email=payload.email,
        keywords=payload.keywords,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Department '{payload.name}' already exists.")
    db.refresh(row)
    return row


@router.patch("/{dept_id}", response_model=DepartmentResponse, summary="Update a department")
def update_department(
    dept_id: uuid.UUID,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Department:
    row = _get_owned(db, dept_id, current_user)
    if payload.name is not None:
        row.name = payload.name
    if payload.email is not None:
        row.email = payload.email
    if "keywords" in payload.model_fields_set:
        row.keywords = payload.keywords
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Department '{payload.name}' already exists.")
    db.refresh(row)
    return row


@router.delete("/{dept_id}", status_code=204, summary="Delete a department")
def delete_department(
    dept_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    row = _get_owned(db, dept_id, current_user)
    db.delete(row)
    db.commit()
