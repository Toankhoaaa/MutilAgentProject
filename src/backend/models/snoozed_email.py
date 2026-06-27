from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.sqltypes import Uuid

from backend.models.base import Base


class SnoozedEmail(Base):
    __tablename__ = "snoozed_emails"
    __table_args__ = (Index("idx_snoozed_emails_snooze_until", "snooze_until"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # nullable for rows created before this column was added
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True, index=True)
    gmail_message_id: Mapped[str] = mapped_column(String(255), nullable=False)
    thread_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sender: Mapped[str | None] = mapped_column(String(255), nullable=True)
    snooze_until: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # PENDING → NOTIFIED or CANCELLED
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="PENDING")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
