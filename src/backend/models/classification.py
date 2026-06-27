from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.sqltypes import Uuid

from backend.models.base import Base


class Classification(Base):
    __tablename__ = "classifications"
    __table_args__ = (
        Index("idx_classifications_category", "category"),
        Index("idx_classifications_gmail_message_id", "gmail_message_id", unique=True),
        Index("idx_classifications_thread_id", "thread_id"),
        Index("idx_classifications_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False, index=False)
    email_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, index=True)
    gmail_message_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    thread_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    priority_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    summary: Mapped[str | None] = mapped_column(String, nullable=True)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
