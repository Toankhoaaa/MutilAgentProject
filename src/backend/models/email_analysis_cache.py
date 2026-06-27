from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.sqltypes import Uuid

from backend.models.base import Base


class EmailAnalysisCache(Base):
    """Persistent cache for POST /emails/analyze results, keyed by (user_id, gmail_message_id).

    Email content never changes, so no TTL. Cache is invalidated by manual deletion only.
    """

    __tablename__ = "email_analysis_cache"
    __table_args__ = (
        Index("idx_email_analysis_cache_user_msg", "user_id", "gmail_message_id", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False)
    gmail_message_id: Mapped[str] = mapped_column(String(255), nullable=False)
    response_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
