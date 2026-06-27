from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.sqltypes import Uuid

from backend.models.base import Base


class EmailRule(Base):
    __tablename__ = "email_rules"
    __table_args__ = (Index("idx_email_rules_user_id", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    field: Mapped[str] = mapped_column(String(50), nullable=False)
    operator: Mapped[str] = mapped_column(String(50), nullable=False)
    value: Mapped[str] = mapped_column(String(500), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    action_value: Mapped[str | None] = mapped_column(String(255), nullable=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    match_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
