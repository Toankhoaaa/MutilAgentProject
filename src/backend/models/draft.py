from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.sqltypes import Uuid

from backend.models.base import Base


class Draft(Base):
    __tablename__ = "drafts"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, index=True)
    draft_content: Mapped[str] = mapped_column(String, nullable=False, default="")
    draft_gmail_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_modified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    is_sent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    processing_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
