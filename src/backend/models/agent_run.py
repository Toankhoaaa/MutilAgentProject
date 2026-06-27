from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.sqltypes import Uuid

from backend.models.base import Base


class AgentRun(Base):
    __tablename__ = "agent_runs"
    __table_args__ = (
        Index("idx_agent_runs_started_at", "started_at"),
        Index("idx_agent_runs_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), nullable=False, index=False)
    run_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    triggered_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    total_emails_processed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    llm_calls_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    llm_total_time_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str | None] = mapped_column(String(50), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

