from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql.sqltypes import Uuid

from app.models.base import Base


class EmailScheduling(Base):
    """One-to-one cache of scheduling extraction results for an email."""

    __tablename__ = "email_schedulings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("emails.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    is_meeting_request: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    start_datetime: Mapped[str | None] = mapped_column(String(50), nullable=True)
    end_datetime: Mapped[str | None] = mapped_column(String(50), nullable=True)
    event_summary: Mapped[str | None] = mapped_column(String(255), nullable=True)
    suggested_reply: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Filled after the user confirms and Google Calendar event is created
    calendar_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    calendar_html_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    meet_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    event_created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    email: Mapped["Email"] = relationship(back_populates="scheduling")  # noqa: F821
