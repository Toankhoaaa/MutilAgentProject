from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, Float, ForeignKey, Index, JSON, SmallInteger, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql.sqltypes import Uuid

from backend.models.base import Base


class Classification(Base):
    __tablename__ = "classifications"
    __table_args__ = (
        Index("idx_classifications_email", "email_id"),
        Index("idx_classifications_category", "category"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("emails.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    priority_score: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_response: Mapped[dict[str, object] | list[object] | None] = mapped_column(JSON, nullable=True)
    processing_time_ms: Mapped[int | None] = mapped_column(nullable=True)
    fallback_used: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=func.now(),
    )

    email: Mapped["Email"] = relationship(back_populates="classification")

