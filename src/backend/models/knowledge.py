from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from backend.models.base import Base


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"
    __table_args__ = (Index("idx_knowledge_documents_upload_date", "upload_date"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    filename: Mapped[str] = mapped_column(String(255))
    # "sender@example.com — Subject line" when uploaded from extension
    source_email: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Prefix used for all ChromaDB chunk IDs: "{safe_stem}_{uuid}"
    chroma_collection_id: Mapped[str | None] = mapped_column(String(300), nullable=True)
    chunk_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # "processing" | "ready" | "failed"
    status: Mapped[str] = mapped_column(String(50), default="processing")
    upload_date: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
    )
