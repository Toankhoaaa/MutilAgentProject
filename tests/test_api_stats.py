"""Tests for dashboard statistics REST API endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.mark.usefixtures("seed_data")
def test_get_overview_stats_success(client: TestClient) -> None:
    """GET /api/v1/stats/overview returns 200 and expected KPI fields."""
    # Arrange — seed_data provides 1 processed email, 1 urgent classification,
    # 1 draft, and 1 agent run with llm_total_time_ms = 120_000

    # Act
    response = client.get("/api/v1/stats/overview")

    # Assert
    assert response.status_code == 200
    body = response.json()
    assert set(body.keys()) == {
        "total_processed",
        "urgent_count",
        "drafts_created",
        "time_saved_minutes",
    }
    assert body["total_processed"] == 1
    assert body["urgent_count"] == 1
    assert body["drafts_created"] == 1


@pytest.mark.usefixtures("seed_data")
def test_get_overview_stats_time_saved_calculation(client: TestClient) -> None:
    """
    time_saved_minutes = round((drafts_created × 5) − (sum(llm_total_time_ms) / 60000), 2).

    With 1 draft and 120_000 ms LLM time: (1 × 5) − (120_000 / 60_000) = 3.0 minutes.
    """
    # Arrange — seeded agent_run.llm_total_time_ms = 120_000, drafts_created = 1

    # Act
    response = client.get("/api/v1/stats/overview")

    # Assert
    assert response.status_code == 200
    body = response.json()
    expected_time_saved = round((1 * 5) - (120_000 / 60_000), 2)
    assert body["time_saved_minutes"] == expected_time_saved
    assert body["time_saved_minutes"] == 3.0
