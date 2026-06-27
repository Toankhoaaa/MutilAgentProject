"""FastAPI router for system configuration management."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.dependencies import get_db, require_admin
from backend.models.configuration import Configuration
from backend.models.user import User
from backend.schemas.api_schemas import (
    AgentToneUpdateSchema,
    ConfigurationResponse,
    ConfigurationUpdateSchema,
    UserSignatureUpdateSchema,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/config", tags=["Configuration"])

CONFIG_KEY_AGENT_TONE = "agent_tone"
CONFIG_KEY_USER_SIGNATURE = "user_signature"


def _upsert_configuration(
    db: Session,
    key: str,
    value: str,
    description: str,
    data_type: str = "string",
) -> Configuration:
    """Insert or update a configuration row by key."""
    row = db.get(Configuration, key)
    if row is None:
        row = Configuration(
            key=key,
            value=value,
            data_type=data_type,
            description=description,
            is_editable=True,
        )
        db.add(row)
    else:
        if row.is_editable is False:
            raise HTTPException(
                status_code=403,
                detail=f"Configuration key '{key}' is not editable.",
            )
        row.value = value
        row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row


@router.get(
    "/",
    response_model=list[ConfigurationResponse],
    summary="List configurations",
    description="Returns all rows from the ``configurations`` table.",
)
def list_configurations(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> list[ConfigurationResponse]:
    """Fetch the full system configuration catalog."""
    rows = db.scalars(select(Configuration).order_by(Configuration.key)).all()
    return [ConfigurationResponse.model_validate(row) for row in rows]


@router.put(
    "/",
    response_model=ConfigurationResponse,
    summary="Update configuration",
    description=(
        "Updates an existing configuration entry by ``key``. "
        "Use for runtime parameters such as the Gemini model id."
    ),
)
def update_configuration(
    payload: ConfigurationUpdateSchema,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ConfigurationResponse:
    """
    Update ``value`` for the given configuration ``key``.

    Raises 404 when the key does not exist, or 403 when the entry is not editable.
    """
    row = db.get(Configuration, payload.key)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail=f"Configuration key '{payload.key}' not found.",
        )

    if row.is_editable is False:
        raise HTTPException(
            status_code=403,
            detail=f"Configuration key '{payload.key}' is not editable.",
        )

    row.value = payload.value
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)

    logger.info("Configuration updated: %s", payload.key)
    return ConfigurationResponse.model_validate(row)


@router.put(
    "/tone",
    response_model=ConfigurationResponse,
    summary="Set agent tone",
    description='Updates ``agent_tone`` (e.g. professional, friendly, concise).',
)
def update_agent_tone(
    payload: AgentToneUpdateSchema,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ConfigurationResponse:
    """Persist the preferred writing tone for the Response Agent."""
    row = _upsert_configuration(
        db=db,
        key=CONFIG_KEY_AGENT_TONE,
        value=payload.tone,
        description="Preferred writing tone for AI reply drafts.",
    )
    logger.info("Agent tone updated: %s", payload.tone)
    return ConfigurationResponse.model_validate(row)


@router.put(
    "/signature",
    response_model=ConfigurationResponse,
    summary="Set user email signature",
    description="Updates ``user_signature`` appended to the end of AI-generated replies.",
)
def update_user_signature(
    payload: UserSignatureUpdateSchema,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
) -> ConfigurationResponse:
    """Persist the email signature block for draft personalization."""
    row = _upsert_configuration(
        db=db,
        key=CONFIG_KEY_USER_SIGNATURE,
        value=payload.signature,
        description="User signature appended to AI-generated email drafts.",
    )
    logger.info("User signature updated.")
    return ConfigurationResponse.model_validate(row)
