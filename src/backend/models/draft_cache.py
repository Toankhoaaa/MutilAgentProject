from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.sqltypes import Uuid

from backend.models.base import Base


class DraftCache(Base):
    """Persistent cache of a generated draft reply, keyed by (user_id, gmail_message_id).

    Lets /emails/classify detect an already-generated draft and skip re-invoking
    the Response Agent when the same email is opened again.
    """

    __tablename__ = "draft_cache"
    __table_args__ = (
        Index("idx_draft_cache_user_msg", "user_id", "gmail_message_id", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    gmail_message_id: Mapped[str] = mapped_column(String(255), nullable=False)
    draft_subject: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    draft_content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
