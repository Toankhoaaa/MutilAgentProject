"""Tests for email REST API endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.api.dependencies import get_classifier_agent, get_response_agent
from backend.main import app
from backend.models.user import User


@pytest.mark.usefixtures("seed_data")
def test_get_emails_success(client: TestClient) -> None:
    """GET /api/v1/emails returns 200 and a valid pagination envelope."""
    # Arrange — seed_data fixture loads 2 emails into the in-memory DB

    # Act
    response = client.get("/api/v1/emails", params={"limit": 10, "offset": 0})

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {"items", "total", "limit", "offset"}
    assert body["total"] == 2
    assert body["limit"] == 10
    assert body["offset"] == 0
    assert len(body["items"]) == 2

    first = body["items"][0]
    assert "id" in first
    assert "gmail_message_id" in first
    assert "subject" in first
    assert "is_processed" in first


@pytest.mark.usefixtures("seed_data")
def test_get_emails_pagination(client: TestClient) -> None:
    """Pagination limit/offset are reflected in the response."""
    # Arrange — 2 seeded emails

    # Act
    response = client.get("/api/v1/emails", params={"limit": 1, "offset": 1})

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert body["limit"] == 1
    assert body["offset"] == 1
    assert len(body["items"]) == 1


@patch("app.api.routers.emails.google_credentials_from_token_json")
@patch(
    "app.api.routers.emails.EmailOrchestrator.process_new_emails",
    new_callable=AsyncMock,
)
def test_process_emails_calls_orchestrator(
    mock_process: AsyncMock,
    mock_credentials_from_json: MagicMock,
    client: TestClient,
    auth_headers: dict[str, str],
    seed_data: dict[str, object],
    db_session: Session,
) -> None:
    """POST /api/v1/emails/process succeeds without calling external Gmail/Gemini APIs."""
    # Arrange
    user: User = seed_data["user"]  # type: ignore[assignment]
    user.google_oauth_token = '{"access_token":"test-token"}'
    db_session.commit()
    mock_creds = MagicMock()
    mock_creds.to_json.return_value = user.google_oauth_token
    mock_credentials_from_json.return_value = mock_creds

    mock_process.return_value = {
        "fetched": 2,
        "processed": 2,
        "skipped_duplicate": 0,
        "failed": 0,
        "drafts_created": 1,
        "run_id": "run-test-001",
        "llm_calls_count": 2,
        "llm_total_time_ms": 1500,
        "total_time_ms": 3000,
        "errors": [],
    }

    app.dependency_overrides[get_classifier_agent] = lambda: MagicMock()
    app.dependency_overrides[get_response_agent] = lambda: MagicMock()

    # Act
    response = client.post("/api/v1/emails/process", headers=auth_headers)

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert body["fetched"] == 2
    assert body["processed"] == 2
    assert body["drafts_created"] == 1
    assert body["run_id"] == "run-test-001"
    mock_process.assert_called_once_with(limit=5)
    mock_credentials_from_json.assert_called_once()


def test_process_emails_requires_auth(client: TestClient) -> None:
    """POST /api/v1/emails/process returns 401 without authentication."""
    response = client.post("/api/v1/emails/process")
    assert response.status_code == 401


def test_update_draft_success(
    client: TestClient,
    seed_data: dict[str, object],
    auth_headers: dict[str, str],
) -> None:
    """PUT /api/v1/emails/{id}/draft updates draft content for the authenticated owner."""
    # Arrange
    email = seed_data["email_with_draft"]
    email_id = str(email.id)  # type: ignore[union-attr]
    updated_content = "Updated draft content by QA test."

    # Act
    response = client.put(
        f"/api/v1/emails/{email_id}/draft",
        json={"draft_content": updated_content},
        headers=auth_headers,
    )

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert body["draft_content"] == updated_content
    assert body["is_modified"] is True
    assert body["email_id"] == email_id


def test_update_draft_requires_auth(
    client: TestClient,
    seed_data: dict[str, object],
) -> None:
    """PUT /api/v1/emails/{id}/draft returns 401 without a Bearer token."""
    # Arrange
    email = seed_data["email_with_draft"]
    email_id = str(email.id)  # type: ignore[union-attr]

    # Act
    response = client.put(
        f"/api/v1/emails/{email_id}/draft",
        json={"draft_content": "Should fail without auth."},
    )

    # Assert
    assert response.status_code == 401
