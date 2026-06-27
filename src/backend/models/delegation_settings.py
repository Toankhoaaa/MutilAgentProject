from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql.sqltypes import Uuid

from backend.models.base import Base


class DelegationSettings(Base):
    __tablename__ = "delegation_settings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id"), nullable=False, unique=True
    )
    company_header: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature: Mapped[str | None] = mapped_column(Text, nullable=True)
