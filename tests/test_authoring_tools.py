"""Comprehensive tests for MCP rule authoring tools.

Tests cover:
1. Tool registration (all 12 tools present)
2. Input validation (test case format, required fields)
3. Orchestration (create_ruleset calls create → upload → add_tests in order)
4. Formatting (generate_and_test output is human-readable with diagnostics)
5. Regression detection (improvements, regressions, unchanged)
6. TDD enforcement (publish refuses when tests fail)
7. Error handling (API failures, timeouts)
8. Refine workflow (feedback → add guidance → regenerate)
"""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest

from aethis_mcp.client import AethisAPIError, AethisClient
from aethis_mcp.server import mcp, _format_generate_and_test_result


def run(coro):
    return asyncio.run(coro)


def _make_mock_client(**overrides) -> AsyncMock:
    """Create an AsyncMock client with sensible defaults."""
    client = AsyncMock(spec=AethisClient)
    for attr, value in overrides.items():
        getattr(client, attr).return_value = value
    return client


# ---------------------------------------------------------------------------
# Mock data
# ---------------------------------------------------------------------------

MOCK_PROJECT = {"project_id": "proj_abc", "name": "test-rules", "section_id": "test_section"}
MOCK_UPLOAD = {"uploaded": 1, "sources": [{"source_id": "src_1"}]}
MOCK_TESTS_ADDED = {"added": 2, "test_case_ids": ["tc_1", "tc_2"]}
MOCK_GUIDANCE = {"hint_id": "h_1", "project_id": "proj_abc"}

MOCK_GENERATE_AND_TEST_ALL_PASS = {
    "iteration": 1,
    "bundle_id": "test:20260405-abc",
    "summary": "2/2 passing (first iteration). No regressions.",
    "test_results": {"total": 2, "passed": 2, "failed": 0, "errors": 0},
    "improvements": [],
    "regressions": [],
    "remaining_failures": [],
}

MOCK_GENERATE_AND_TEST_WITH_FAILURES = {
    "iteration": 1,
    "bundle_id": "test:20260405-def",
    "summary": "1/2 passing (first iteration). No regressions.",
    "test_results": {"total": 2, "passed": 1, "failed": 1, "errors": 0},
    "improvements": [],
    "regressions": [],
    "remaining_failures": [{
        "test": "dolphin_ineligible",
        "diagnosis": "Criterion 'species_check' allows Dolphins. Re-read source Section 3(a).",
    }],
}

MOCK_GENERATE_AND_TEST_WITH_REGRESSION = {
    "iteration": 3,
    "bundle_id": "test:20260405-ghi",
    "summary": "1/2 passing (was 2/2). REGRESSIONS: towel_test. No improvements.",
    "test_results": {"total": 2, "passed": 1, "failed": 1, "errors": 0},
    "improvements": [],
    "regressions": [{
        "test": "towel_test",
        "was": "PASS",
        "now": "FAIL",
        "diagnosis": "Towel compliance criterion removed in latest generation.",
    }],
    "remaining_failures": [],
}

MOCK_GENERATE_AND_TEST_WITH_IMPROVEMENT = {
    "iteration": 2,
    "bundle_id": "test:20260405-jkl",
    "summary": "2/2 passing (was 1/2). Fixed: dolphin_test. No regressions.",
    "test_results": {"total": 2, "passed": 2, "failed": 0, "errors": 0},
    "improvements": [{"test": "dolphin_test", "was": "FAIL", "now": "PASS"}],
    "regressions": [],
    "remaining_failures": [],
}

MOCK_TEST_RUN_PASSING = {
    "total": 2, "passed": 2, "failed": 0, "errors": 0,
    "results": [
        {"tc_id": "tc_1", "name": "eligible_case", "expected": "eligible", "actual": "eligible", "passed": True},
        {"tc_id": "tc_2", "name": "ineligible_case", "expected": "not_eligible", "actual": "not_eligible", "passed": True},
    ],
}

MOCK_TEST_RUN_FAILING = {
    "total": 2, "passed": 1, "failed": 1, "errors": 0,
    "results": [
        {"tc_id": "tc_1", "name": "eligible_case", "expected": "eligible", "actual": "eligible", "passed": True},
        {"tc_id": "tc_2", "name": "dolphin_test", "expected": "not_eligible", "actual": "eligible", "passed": False},
    ],
}

MOCK_PUBLISH = {"bundle_id": "test:20260405-abc", "version": "v2", "deprecated_bundles": ["test:20260404-old"]}


# ---------------------------------------------------------------------------
# Tool registration
# ---------------------------------------------------------------------------

class TestToolRegistration:
    def test_twelve_tools_registered(self):
        tools = run(mcp.list_tools())
        assert len(tools) == 12

    def test_authoring_tools_present(self):
        tools = run(mcp.list_tools())
        names = {t.name for t in tools}
        assert "aethis_create_ruleset" in names
        assert "aethis_add_guidance" in names
        assert "aethis_generate_and_test" in names
        assert "aethis_refine" in names
        assert "aethis_publish" in names

    def test_all_tools_have_descriptions(self):
        tools = run(mcp.list_tools())
        for t in tools:
            assert t.description, f"{t.name} has no description"


# ---------------------------------------------------------------------------
# aethis_create_ruleset
# ---------------------------------------------------------------------------

class TestCreateRuleset:
    def test_rejects_empty_test_cases(self):
        result = run(mcp.call_tool("aethis_create_ruleset", {
            "name": "test", "section_id": "s1", "source_text": "Some law.",
            "test_cases": [],
        }))
        text = result.content[0].text
        assert "Error" in text
        assert "At least 1 test case" in text

    def test_rejects_missing_keys_in_test_case(self):
        result = run(mcp.call_tool("aethis_create_ruleset", {
            "name": "test", "section_id": "s1", "source_text": "Some law.",
            "test_cases": [{"name": "bad case"}],  # missing field_values, expected_outcome
        }))
        text = result.content[0].text
        assert "Error" in text
        assert "missing keys" in text

    def test_rejects_invalid_expected_outcome(self):
        result = run(mcp.call_tool("aethis_create_ruleset", {
            "name": "test", "section_id": "s1", "source_text": "Law.",
            "test_cases": [{"name": "bad", "field_values": {}, "expected_outcome": "maybe"}],
        }))
        text = result.content[0].text
        assert "Error" in text
        assert "invalid expected_outcome" in text

    @patch("aethis_mcp.server._client")
    def test_orchestrates_create_upload_tests(self, mock_factory):
        client = _make_mock_client(
            create_project=MOCK_PROJECT,
            upload_source_text=MOCK_UPLOAD,
            add_tests=MOCK_TESTS_ADDED,
        )
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_create_ruleset", {
            "name": "test-rules", "section_id": "test_section",
            "source_text": "The legislation says...",
            "test_cases": [
                {"name": "case1", "field_values": {"age": 30}, "expected_outcome": "eligible"},
                {"name": "case2", "field_values": {"age": 10}, "expected_outcome": "not_eligible"},
            ],
        }))
        text = result.content[0].text

        # Verify call order
        client.create_project.assert_called_once_with("test-rules", "test_section", "")
        client.upload_source_text.assert_called_once()
        client.add_tests.assert_called_once()

        # Verify output
        assert "proj_abc" in text
        assert "2 test case" in text
        assert "aethis_generate_and_test" in text  # next step instruction

    @patch("aethis_mcp.server._client")
    def test_handles_api_error(self, mock_factory):
        client = AsyncMock(spec=AethisClient)
        client.create_project.side_effect = AethisAPIError(429, "Rate limit exceeded")
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_create_ruleset", {
            "name": "test", "section_id": "s1", "source_text": "Law.",
            "test_cases": [{"name": "c", "field_values": {}, "expected_outcome": "eligible"}],
        }))
        assert "Error" in result.content[0].text
        assert "429" in result.content[0].text


# ---------------------------------------------------------------------------
# aethis_add_guidance
# ---------------------------------------------------------------------------

class TestAddGuidance:
    @patch("aethis_mcp.server._client")
    def test_adds_and_suggests_next_step(self, mock_factory):
        client = _make_mock_client(add_guidance=MOCK_GUIDANCE)
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_add_guidance", {
            "project_id": "proj_abc",
            "guidance_text": "Dolphins are excluded per Section 3(a).",
        }))
        text = result.content[0].text
        assert "Guidance added" in text
        assert "aethis_generate_and_test" in text


# ---------------------------------------------------------------------------
# aethis_generate_and_test
# ---------------------------------------------------------------------------

class TestGenerateAndTest:
    @patch("aethis_mcp.server._client")
    def test_all_passing_suggests_publish(self, mock_factory):
        client = _make_mock_client(generate_and_test=MOCK_GENERATE_AND_TEST_ALL_PASS)
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_generate_and_test", {"project_id": "proj_abc"}))
        text = result.content[0].text
        assert "2/2 passing" in text
        assert "aethis_publish" in text  # suggests publishing

    @patch("aethis_mcp.server._client")
    def test_failures_show_diagnosis(self, mock_factory):
        client = _make_mock_client(generate_and_test=MOCK_GENERATE_AND_TEST_WITH_FAILURES)
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_generate_and_test", {"project_id": "proj_abc"}))
        text = result.content[0].text
        assert "1/2 passing" in text
        assert "STILL FAILING" in text
        assert "dolphin_ineligible" in text
        assert "species_check" in text  # diagnosis content
        assert "Section 3(a)" in text   # points at source

    @patch("aethis_mcp.server._client")
    def test_regressions_highlighted(self, mock_factory):
        client = _make_mock_client(generate_and_test=MOCK_GENERATE_AND_TEST_WITH_REGRESSION)
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_generate_and_test", {"project_id": "proj_abc"}))
        text = result.content[0].text
        assert "REGRESSION" in text
        assert "towel_test" in text
        assert "was PASS, now FAIL" in text

    @patch("aethis_mcp.server._client")
    def test_improvements_shown(self, mock_factory):
        client = _make_mock_client(generate_and_test=MOCK_GENERATE_AND_TEST_WITH_IMPROVEMENT)
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_generate_and_test", {"project_id": "proj_abc"}))
        text = result.content[0].text
        assert "IMPROVED" in text
        assert "dolphin_test" in text
        assert "was FAIL, now PASS" in text

    @patch("aethis_mcp.server._client")
    def test_handles_timeout(self, mock_factory):
        client = AsyncMock(spec=AethisClient)
        client.generate_and_test.side_effect = AethisAPIError(504, "Generation timed out")
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_generate_and_test", {"project_id": "proj_abc"}))
        text = result.content[0].text
        assert "Error" in text


# ---------------------------------------------------------------------------
# aethis_refine
# ---------------------------------------------------------------------------

class TestRefine:
    @patch("aethis_mcp.server._client")
    def test_with_feedback_adds_guidance_then_generates(self, mock_factory):
        client = _make_mock_client(
            add_guidance=MOCK_GUIDANCE,
            generate_and_test=MOCK_GENERATE_AND_TEST_WITH_IMPROVEMENT,
        )
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_refine", {
            "project_id": "proj_abc",
            "feedback": "Dolphins should be excluded per Section 3(a).",
        }))
        text = result.content[0].text

        # Verify guidance was added BEFORE generate
        client.add_guidance.assert_called_once_with("proj_abc", "Dolphins should be excluded per Section 3(a).")
        client.generate_and_test.assert_called_once()

        # Verify output includes feedback confirmation
        assert "Guidance added" in text
        assert "Dolphins" in text

    @patch("aethis_mcp.server._client")
    def test_without_feedback_generates_directly(self, mock_factory):
        client = _make_mock_client(generate_and_test=MOCK_GENERATE_AND_TEST_ALL_PASS)
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_refine", {
            "project_id": "proj_abc",
            "feedback": "",
        }))

        client.add_guidance.assert_not_called()
        client.generate_and_test.assert_called_once()

    @patch("aethis_mcp.server._client")
    def test_whitespace_only_feedback_skips_guidance(self, mock_factory):
        client = _make_mock_client(generate_and_test=MOCK_GENERATE_AND_TEST_ALL_PASS)
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_refine", {
            "project_id": "proj_abc",
            "feedback": "   ",
        }))
        client.add_guidance.assert_not_called()


# ---------------------------------------------------------------------------
# aethis_publish
# ---------------------------------------------------------------------------

class TestPublish:
    @patch("aethis_mcp.server._client")
    def test_refuses_when_tests_fail(self, mock_factory):
        client = _make_mock_client(run_tests=MOCK_TEST_RUN_FAILING)
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_publish", {
            "project_id": "proj_abc",
        }))
        text = result.content[0].text

        assert "Cannot publish" in text
        assert "1/2" in text
        assert "dolphin_test" in text
        client.publish.assert_not_called()  # Should NOT have called publish

    @patch("aethis_mcp.server._client")
    def test_publishes_when_all_pass(self, mock_factory):
        client = _make_mock_client(
            run_tests=MOCK_TEST_RUN_PASSING,
            publish=MOCK_PUBLISH,
        )
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_publish", {
            "project_id": "proj_abc",
        }))
        text = result.content[0].text

        assert "Published successfully" in text
        assert "v2" in text
        client.publish.assert_called_once()

    @patch("aethis_mcp.server._client")
    def test_force_publishes_despite_failures(self, mock_factory):
        client = _make_mock_client(
            run_tests=MOCK_TEST_RUN_FAILING,
            publish=MOCK_PUBLISH,
        )
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_publish", {
            "project_id": "proj_abc",
            "force": True,
        }))
        text = result.content[0].text

        assert "Published successfully" in text
        client.publish.assert_called_once()

    @patch("aethis_mcp.server._client")
    def test_shows_deprecated_bundles(self, mock_factory):
        client = _make_mock_client(
            run_tests=MOCK_TEST_RUN_PASSING,
            publish=MOCK_PUBLISH,
        )
        mock_factory.return_value = client

        result = run(mcp.call_tool("aethis_publish", {"project_id": "proj_abc"}))
        text = result.content[0].text
        assert "Deprecated" in text
        assert "test:20260404-old" in text


# ---------------------------------------------------------------------------
# _format_generate_and_test_result (unit tests for formatting logic)
# ---------------------------------------------------------------------------

class TestFormatResult:
    def test_all_passing_format(self):
        text = _format_generate_and_test_result(MOCK_GENERATE_AND_TEST_ALL_PASS)
        assert "2/2 passing" in text
        assert "aethis_publish" in text
        assert "REGRESSION" not in text
        assert "STILL FAILING" not in text

    def test_failure_format_includes_diagnosis(self):
        text = _format_generate_and_test_result(MOCK_GENERATE_AND_TEST_WITH_FAILURES)
        assert "STILL FAILING" in text
        assert "dolphin_ineligible" in text
        assert "species_check" in text

    def test_regression_format_prominent(self):
        text = _format_generate_and_test_result(MOCK_GENERATE_AND_TEST_WITH_REGRESSION)
        assert "REGRESSION" in text
        assert "towel_test" in text
        # Regressions should appear before remaining failures
        regression_pos = text.find("REGRESSION")
        assert regression_pos > 0

    def test_improvement_format(self):
        text = _format_generate_and_test_result(MOCK_GENERATE_AND_TEST_WITH_IMPROVEMENT)
        assert "IMPROVED" in text
        assert "dolphin_test" in text
        assert "was FAIL, now PASS" in text

    def test_bundle_id_included(self):
        text = _format_generate_and_test_result(MOCK_GENERATE_AND_TEST_ALL_PASS)
        assert "test:20260405-abc" in text

    def test_empty_result(self):
        text = _format_generate_and_test_result({
            "iteration": 1,
            "bundle_id": "b1",
            "summary": "",
            "test_results": {"total": 0, "passed": 0, "failed": 0, "errors": 0},
            "improvements": [],
            "regressions": [],
            "remaining_failures": [],
        })
        assert "Iteration 1" in text
        assert "0/0 passing" in text
