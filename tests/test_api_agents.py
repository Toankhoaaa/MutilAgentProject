"""Tests for agent status REST API endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def test_get_agent_status_no_runs(client: TestClient) -> None:
    """GET /api/v1/agents/status returns idle when no agent_runs exist."""
    # Arrange — empty in-memory database

    # Act
    response = client.get("/api/v1/agents/status")

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert body["system_status"] == "idle"
    assert body["latest_run"] is None
    assert "No batch runs recorded yet." in (body["message"] or "")


@pytest.mark.usefixtures("seed_data")
def test_get_agent_status_with_completed_run(client: TestClient) -> None:
    """GET /api/v1/agents/status returns schema fields from the latest agent run."""
    # Arrange — seed_data includes one COMPLETED agent_run

    # Act
    response = client.get("/api/v1/agents/status")

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert body["system_status"] == "idle"
    assert body["message"] == "Last batch run completed successfully."
    assert body["latest_run"] is not None

    latest_run = body["latest_run"]
    assert latest_run["status"] == "COMPLETED"
    assert latest_run["total_emails_processed"] == 1
    assert latest_run["llm_calls_count"] == 2
    assert latest_run["llm_total_time_ms"] == 120_000
