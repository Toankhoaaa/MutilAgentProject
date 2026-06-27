from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.sqltypes import Uuid

from backend.models.base import Base


class DelegationItem(Base):
    __tablename__ = "delegation_items"
    __table_args__ = (Index("idx_delegation_items_delegation_id", "delegation_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    delegation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("delegations.id"), nullable=False, index=False
    )
    department_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    department_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("departments.id"), nullable=True
    )
    recipient_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    work_items: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON-encoded list[str]
    draft_subject: Mapped[str | None] = mapped_column(String(500), nullable=True)
    draft_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    gmail_draft_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cc_emails: Mapped[str | None] = mapped_column(Text, nullable=True)
    bcc_emails: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
