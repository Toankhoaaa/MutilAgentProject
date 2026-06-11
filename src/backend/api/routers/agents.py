"""FastAPI router for agent status and stateless agent testing."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.dependencies import get_classifier_agent, get_db, get_response_agent
from backend.models.agent_run import AgentRun
from backend.schemas.agent_schemas import EmailCategory, EmailClassificationOutput, EmailResponseOutput
from backend.schemas.api_schemas import (
    AgentRunResponse,
    AgentStatusResponse,
    ClassifyTestRequest,
    DraftTestRequest,
)
from backend.services.agents import EmailClassifierAgent, EmailResponseAgent
from backend.services.agents.response_agent import ResponseAgentSkippedError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["Agents"])


@router.get(
    "/status",
    response_model=AgentStatusResponse,
    summary="Agent system status",
    description=(
        "Returns high-level orchestrator status and metrics from the most recent "
        "``agent_runs`` batch record."
    ),
)
def get_agent_status(db: Session = Depends(get_db)) -> AgentStatusResponse:
    """
    Report whether the system is idle, running a batch, or in a degraded state.

    Uses the latest ``agent_runs`` row ordered by ``started_at``.
    """
    latest = db.scalars(
        select(AgentRun).order_by(AgentRun.started_at.desc().nulls_last()).limit(1)
    ).first()

    if latest is None:
        return AgentStatusResponse(
            system_status="idle",
            latest_run=None,
            message="No batch runs recorded yet.",
        )

    run_response = AgentRunResponse.model_validate(latest)
    status_upper = (latest.status or "").upper()

    if status_upper == "RUNNING":
        system_status = "running"
        message = "A batch email processing run is in progress."
    elif status_upper == "FAILED":
        system_status = "degraded"
        message = latest.error_message or "The last batch run failed."
    elif status_upper == "COMPLETED":
        system_status = "idle"
        message = "Last batch run completed successfully."
    else:
        system_status = "idle"
        message = f"Last run status: {latest.status}"

    return AgentStatusResponse(
        system_status=system_status,
        latest_run=run_response,
        message=message,
    )


@router.post(
    "/classify",
    response_model=EmailClassificationOutput,
    summary="Test classifier agent",
    description=(
        "Runs the Classifier Agent on arbitrary email text and returns structured JSON. "
        "Does not persist to the database or create Gmail drafts."
    ),
)
async def test_classify(
    payload: ClassifyTestRequest,
    classifier: EmailClassifierAgent = Depends(get_classifier_agent),
) -> EmailClassificationOutput:
    """
    Stateless classification endpoint for prompt and model experimentation.

    Invokes ``EmailClassifierAgent.classify`` directly.
    """
    try:
        return await classifier.classify(
            subject=payload.subject,
            body=payload.body,
            sender=payload.sender,
        )
    except Exception as exc:
        logger.exception("Classifier test failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post(
    "/draft",
    response_model=EmailResponseOutput,
    summary="Test response agent",
    description=(
        "Runs the Response Agent with provided email context and classification. "
        "Does not persist drafts or call Gmail."
    ),
)
async def test_draft(
    payload: DraftTestRequest,
    response_agent: EmailResponseAgent = Depends(get_response_agent),
) -> EmailResponseOutput:
    """
    Stateless draft generation for urgent / need_reply categories only.

    Builds an ``EmailClassificationOutput`` from the request and calls ``compose_reply``.
    """
    try:
        category = EmailCategory(payload.category)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid category '{payload.category}'.",
        ) from exc

    classification = EmailClassificationOutput(
        category=category,
        priority_score=payload.priority_score,
        summary=payload.summary,
        deadline=payload.deadline,
        confidence=payload.confidence,
    )

    try:
        return await response_agent.compose_reply(
            email_subject=payload.email_subject,
            email_body=payload.email_body,
            classification=classification,
            tone=payload.tone,
        )
    except ResponseAgentSkippedError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Response agent test failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
