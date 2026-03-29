"""Unit tests for aethis-mcp tools (mock HTTP, no real API)."""

from __future__ import annotations

import asyncio
import json
from unittest.mock import MagicMock, patch

import pytest

from aethis_mcp.client import AethisAPIError, AethisClient
from aethis_mcp.server import mcp


# -- Helpers ------------------------------------------------------------------

def run(coro):
    return asyncio.run(coro)


MOCK_SCHEMA = {
    "bundle_id": "b_123",
    "fields": [
        {"field_name": "age", "field_type": "int", "description": "Age in years"},
        {"field_name": "has_degree", "field_type": "bool", "description": "UK degree holder"},
    ],
}

MOCK_DECIDE = {
    "outcome": "eligible",
    "satisfied_criteria": ["age_group"],
    "reasoning": "All criteria met via age exemption route.",
}

MOCK_DECIDE_UNDETERMINED = {
    "decision": "undetermined",
    "bundle_id": "b_123",
    "fields_evaluated": 5,
    "fields_provided": 1,
    "missing_fields": ["has_degree", "has_selt", "age"],
    "next_question": {
        "field_id": "has_degree",
        "question": "Do you hold a UK degree?",
        "weight": 1,
    },
    "optimal_path": [
        {"field_id": "has_degree", "question": "Do you hold a UK degree?", "weight": 1},
        {"field_id": "has_selt", "question": "Do you have a SELT certificate?", "weight": 2},
    ],
}

MOCK_EXPLAIN = {
    "bundle_id": "b_123",
    "rules": [
        {"name": "age_exemption", "description": "Applicants aged 65+ are exempt."},
    ],
}

MOCK_PROJECTS = [
    {"project_id": "p_1", "name": "test-project", "domain": "immigration"},
]

MOCK_STATUS = {
    "project_id": "p_1",
    "latest_bundle_id": "b_123",
    "job": {"status": "success"},
}

MOCK_GENERATE = {
    "job_id": "j_456",
    "status": "queued",
}


# -- Tool registration -------------------------------------------------------

class TestToolRegistration:
    def test_all_seven_tools_registered(self):
        tools = run(mcp.list_tools())
        names = {t.name for t in tools}
        assert names == {
            "aethis_schema",
            "aethis_decide",
            "aethis_next_question",
            "aethis_explain",
            "aethis_list_projects",
            "aethis_project_status",
            "aethis_generate",
        }

    def test_tools_have_descriptions(self):
        tools = run(mcp.list_tools())
        for t in tools:
            assert t.description, f"{t.name} has no description"


# -- Decision tools -----------------------------------------------------------

class TestSchema:
    @patch("aethis_mcp.server._client")
    def test_returns_schema_json(self, mock_factory):
        client = MagicMock(spec=AethisClient)
        client.get_schema.return_value = MOCK_SCHEMA
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_schema", {"bundle_id": "b_123"}))
        text = result.content[0].text
        data = json.loads(text)
        assert data["bundle_id"] == "b_123"
        assert len(data["fields"]) == 2

    @patch("aethis_mcp.server._client")
    def test_handles_api_error(self, mock_factory):
        client = MagicMock(spec=AethisClient)
        client.get_schema.side_effect = AethisAPIError(404, "Bundle not found")
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_schema", {"bundle_id": "bad"}))
        assert "Error" in result.content[0].text
        assert "404" in result.content[0].text


class TestDecide:
    @patch("aethis_mcp.server._client")
    def test_returns_outcome(self, mock_factory):
        client = MagicMock(spec=AethisClient)
        client.decide.return_value = MOCK_DECIDE
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_decide", {
            "bundle_id": "b_123",
            "field_values": {"age": 70},
        }))
        data = json.loads(result.content[0].text)
        assert data["outcome"] == "eligible"

    @patch("aethis_mcp.server._client")
    def test_handles_api_error(self, mock_factory):
        client = MagicMock(spec=AethisClient)
        client.decide.side_effect = AethisAPIError(422, "Missing required field: age")
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_decide", {
            "bundle_id": "b_123",
            "field_values": {},
        }))
        assert "422" in result.content[0].text


class TestNextQuestion:
    @patch("aethis_mcp.server._client")
    def test_undetermined_shows_next_question(self, mock_factory):
        client = MagicMock(spec=AethisClient)
        client.decide.return_value = MOCK_DECIDE_UNDETERMINED
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_next_question", {
            "bundle_id": "b_123",
            "field_values": {"nationality": "Australian"},
        }))
        text = result.content[0].text
        assert "undetermined" in text
        assert "has_degree" in text
        assert "Do you hold a UK degree?" in text
        assert "2 questions" in text

    @patch("aethis_mcp.server._client")
    def test_eligible_returns_done(self, mock_factory):
        client = MagicMock(spec=AethisClient)
        client.decide.return_value = {"decision": "eligible"}
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_next_question", {
            "bundle_id": "b_123",
            "field_values": {"age": 70},
        }))
        text = result.content[0].text
        assert "eligible" in text
        assert "No more questions" in text


class TestExplain:
    @patch("aethis_mcp.server._client")
    def test_returns_rules(self, mock_factory):
        client = MagicMock(spec=AethisClient)
        client.explain.return_value = MOCK_EXPLAIN
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_explain", {"bundle_id": "b_123"}))
        data = json.loads(result.content[0].text)
        assert len(data["rules"]) == 1


# -- Discovery tools ---------------------------------------------------------

class TestListProjects:
    @patch("aethis_mcp.server._client")
    def test_returns_projects(self, mock_factory):
        client = MagicMock(spec=AethisClient)
        client.list_projects.return_value = MOCK_PROJECTS
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_list_projects", {}))
        data = json.loads(result.content[0].text)
        assert len(data) == 1
        assert data[0]["project_id"] == "p_1"


class TestProjectStatus:
    @patch("aethis_mcp.server._client")
    def test_returns_status(self, mock_factory):
        client = MagicMock(spec=AethisClient)
        client.get_status.return_value = MOCK_STATUS
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_project_status", {"project_id": "p_1"}))
        data = json.loads(result.content[0].text)
        assert data["job"]["status"] == "success"


# -- Authoring tool -----------------------------------------------------------

class TestGenerate:
    @patch("aethis_mcp.server._client")
    def test_returns_job_info(self, mock_factory):
        client = MagicMock(spec=AethisClient)
        client.generate.return_value = MOCK_GENERATE
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_generate", {"project_id": "p_1"}))
        data = json.loads(result.content[0].text)
        assert data["status"] == "queued"


# -- Client -------------------------------------------------------------------

class TestClientInit:
    def test_missing_api_key_raises(self, monkeypatch):
        monkeypatch.delenv("AETHIS_API_KEY", raising=False)
        with pytest.raises(AethisAPIError, match="AETHIS_API_KEY"):
            AethisClient()
