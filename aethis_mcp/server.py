"""MCP server exposing Aethis developer API tools."""

from __future__ import annotations

import atexit
import json
from typing import Annotated

from fastmcp import FastMCP

from aethis_mcp.client import AethisAPIError, AethisClient

mcp = FastMCP(
    "Aethis",
    instructions=(
        "Aethis is an AI platform for regulated eligibility checks. "
        "Use `aethis_schema` to discover what input fields a rule bundle requires, "
        "then `aethis_decide` to evaluate eligibility, and `aethis_explain` for "
        "human-readable rule descriptions. "
        "Use `aethis_list_projects` to discover available projects and bundles. "
        "To author new rules: `aethis_create_ruleset` (with test cases first — TDD), "
        "then `aethis_generate_and_test` to iterate, and `aethis_publish` when passing."
    ),
)

_shared_client: AethisClient | None = None


def _client() -> AethisClient:
    global _shared_client
    if _shared_client is None:
        _shared_client = AethisClient()
        atexit.register(_shared_client.close)
    return _shared_client


def _fmt(data: dict | list) -> str:
    """Format API response as indented JSON for LLM readability."""
    return json.dumps(data, indent=2, default=str)


# ---------------------------------------------------------------------------
# Decision tools
# ---------------------------------------------------------------------------


@mcp.tool()
def aethis_schema(
    bundle_id: Annotated[str, "The ID of the published rule bundle"],
) -> str:
    """Get the input fields required for an eligibility check.

    Returns field names, types (bool/enum/int/str), descriptions, and
    allowed values. Use this before calling aethis_decide to know what
    field_values to provide.
    """
    try:
        result = _client().get_schema(bundle_id)
        return _fmt(result)
    except AethisAPIError as e:
        return f"Error: API request failed (HTTP {e.status_code})"


@mcp.tool()
def aethis_decide(
    bundle_id: Annotated[str, "The ID of the published rule bundle"],
    field_values: Annotated[dict, "Input field values (see aethis_schema for required fields)"],
) -> str:
    """Evaluate eligibility against a published rule bundle.

    Provide the bundle_id and a dict of field_values matching the schema.
    Returns the eligibility outcome (eligible/ineligible/undetermined).

    When the outcome is 'undetermined', the response includes:
    - next_question: the optimised best question to ask next
    - optimal_path: the full remaining question path to eligibility
    """
    try:
        result = _client().decide(bundle_id, field_values)
        return _fmt(result)
    except AethisAPIError as e:
        return f"Error: API request failed (HTTP {e.status_code})"


@mcp.tool()
def aethis_next_question(
    bundle_id: Annotated[str, "The ID of the published rule bundle"],
    field_values: Annotated[dict, "Answers collected so far (can be empty dict for first question)"],
) -> str:
    """Get the optimal next question to ask for an eligibility check.

    Determines the single best question to ask next, given the answers
    so far. Also returns the full remaining path (all questions still
    needed, sorted by priority).

    Use this in a conversational loop:
    1. Call with empty field_values to get the first question
    2. Ask the user that question
    3. Add their answer to field_values and call again
    4. Repeat until decision is 'eligible' or 'not_eligible'
    """
    try:
        result = _client().decide(bundle_id, field_values)
        decision = result.get("decision")

        if decision == "eligible":
            return f"Decision: eligible. No more questions needed."
        if decision == "not_eligible":
            return f"Decision: not eligible. No more questions needed."

        # Undetermined — format next question prominently
        nq = result.get("next_question")
        path = result.get("optimal_path", [])
        lines = [f"Decision: undetermined ({result.get('fields_provided', 0)}/{result.get('fields_evaluated', 0)} fields provided)"]
        if nq:
            lines.append(f"\nNext question to ask:")
            lines.append(f"  Field: {nq['field_id']}")
            lines.append(f"  Question: {nq['question']}")
            lines.append(f"  Priority weight: {nq['weight']} (lower = more important)")
        if path:
            lines.append(f"\nFull remaining path ({len(path)} questions):")
            for i, q in enumerate(path, 1):
                lines.append(f"  {i}. {q['question']} ({q['field_id']}, weight={q['weight']})")
        if result.get("missing_fields"):
            lines.append(f"\nAll missing fields: {', '.join(result['missing_fields'])}")
        return "\n".join(lines)
    except AethisAPIError as e:
        return f"Error: API request failed (HTTP {e.status_code})"


@mcp.tool()
def aethis_explain(
    bundle_id: Annotated[str, "The ID of the published rule bundle"],
) -> str:
    """Get human-readable descriptions of the rules in a bundle.

    Returns natural-language explanations of what the rule bundle checks,
    including criteria groups, requirements, and exception paths.
    """
    try:
        result = _client().explain(bundle_id)
        return _fmt(result)
    except AethisAPIError as e:
        return f"Error: API request failed (HTTP {e.status_code})"


# ---------------------------------------------------------------------------
# Discovery tools
# ---------------------------------------------------------------------------


@mcp.tool()
def aethis_list_projects() -> str:
    """List all projects in the current tenant.

    Returns project IDs, names, domains, and latest bundle information.
    Use this to discover available bundles for aethis_schema / aethis_decide.
    """
    try:
        result = _client().list_projects()
        return _fmt(result)
    except AethisAPIError as e:
        return f"Error: API request failed (HTTP {e.status_code})"


@mcp.tool()
def aethis_project_status(
    project_id: Annotated[str, "The project ID"],
) -> str:
    """Check the status of a project and its latest generation job.

    Returns project state, latest bundle ID, and generation job progress
    (queued/running/success/failed).
    """
    try:
        result = _client().get_status(project_id)
        return _fmt(result)
    except AethisAPIError as e:
        return f"Error: API request failed (HTTP {e.status_code})"


# ---------------------------------------------------------------------------
# Authoring tool
# ---------------------------------------------------------------------------


@mcp.tool()
def aethis_generate(
    project_id: Annotated[str, "The project ID to generate rules for"],
) -> str:
    """Trigger rule generation for a project.

    Queues an async generation job that uses the project's uploaded sources,
    guidance hints, and test cases to synthesize a rule bundle.
    Poll with aethis_project_status to check progress.
    """
    try:
        result = _client().generate(project_id)
        return _fmt(result)
    except AethisAPIError as e:
        return f"Error: API request failed (HTTP {e.status_code})"


# ---------------------------------------------------------------------------
# Intelligent authoring tools
# ---------------------------------------------------------------------------

_REQUIRED_TC_KEYS = {"name", "field_values", "expected_outcome"}
_VALID_OUTCOMES = {"eligible", "not_eligible", "undetermined"}


@mcp.tool()
def aethis_create_ruleset(
    name: Annotated[str, "Human-readable name for the ruleset"],
    section_id: Annotated[str, "Unique section identifier (e.g., 'flight_readiness')"],
    source_text: Annotated[str, "The source legislation, policy, or specification text"],
    test_cases: Annotated[list[dict], "Test cases: [{name, field_values, expected_outcome}]. At least 1 required."],
    domain: Annotated[str, "Domain hint (e.g., 'uk_immigration')"] = "",
) -> str:
    """Create a new ruleset project with source text and test cases (TDD).

    Test cases are required — you can't author rules without specifying what
    correct behaviour looks like. Each test case needs:
    - name: descriptive name
    - field_values: dict of input fields
    - expected_outcome: "eligible", "not_eligible", or "undetermined"

    After creation, call aethis_generate_and_test to generate rules and verify.
    """
    # Validate test cases
    if not test_cases:
        return "Error: At least 1 test case is required. Rules authoring is test-driven — define expected outcomes first."

    for i, tc in enumerate(test_cases):
        missing = _REQUIRED_TC_KEYS - set(tc.keys())
        if missing:
            return f"Error: Test case {i + 1} is missing keys: {', '.join(sorted(missing))}. Required: name, field_values, expected_outcome."
        if tc.get("expected_outcome") not in _VALID_OUTCOMES:
            return f"Error: Test case {i + 1} has invalid expected_outcome '{tc.get('expected_outcome')}'. Must be: eligible, not_eligible, or undetermined."

    try:
        client = _client()

        # Create project
        project = client.create_project(name, section_id, domain)
        project_id = project.get("project_id")

        # Upload source text
        filename = f"{section_id}.md"
        client.upload_source_text(project_id, filename, source_text)

        # Add test cases
        client.add_tests(project_id, test_cases)

        lines = [
            f"Ruleset project created successfully.",
            f"  Project ID: {project_id}",
            f"  Section: {section_id}",
            f"  Source: {len(source_text)} characters uploaded as {filename}",
            f"  Tests: {len(test_cases)} test case(s) added",
            f"",
            f"Next step: Call aethis_generate_and_test(project_id=\"{project_id}\") to generate rules and run tests.",
        ]
        return "\n".join(lines)

    except AethisAPIError as e:
        return f"Error: {e.detail} (HTTP {e.status_code})"


@mcp.tool()
def aethis_add_guidance(
    project_id: Annotated[str, "The project ID"],
    guidance_text: Annotated[str, "Domain knowledge or correction not present in the source text"],
) -> str:
    """Add subject-matter-expert guidance to a project.

    Use this for real-world knowledge that isn't in the source legislation:
    - Domain interpretations: "The Home Office interprets 'ordinarily resident' as 270+ days/year"
    - Missing context: "Dolphins are excluded per an unpublished policy amendment"
    - LLM steering: "Treat 'may' as discretionary and 'shall' as mandatory"

    After adding guidance, call aethis_generate_and_test to regenerate with this context.
    """
    try:
        _client().add_guidance(project_id, guidance_text)
        return (
            f"Guidance added to project {project_id}.\n"
            f"Call aethis_generate_and_test(project_id=\"{project_id}\") to regenerate with this guidance applied."
        )
    except AethisAPIError as e:
        return f"Error: {e.detail} (HTTP {e.status_code})"


@mcp.tool()
def aethis_generate_and_test(
    project_id: Annotated[str, "The project ID"],
) -> str:
    """Generate rules from source text and run all test cases.

    This is the core authoring loop tool. It:
    1. Generates a new rule bundle from source text + guidance + previous failure context
    2. Runs all test cases with rich diagnostics
    3. Compares with previous iteration (regression detection)
    4. Returns interpreted results with suggested next steps

    Takes 60-120 seconds (rule generation is computationally intensive).
    """
    try:
        result = _client().generate_and_test(project_id)
        return _format_generate_and_test_result(result)
    except AethisAPIError as e:
        return f"Error: {e.detail} (HTTP {e.status_code})"


def _format_generate_and_test_result(result: dict) -> str:
    """Format generate-and-test response as human-readable text."""
    iteration = result.get("iteration", "?")
    bundle_id = result.get("bundle_id", "unknown")
    summary = result.get("summary", "")
    test_results = result.get("test_results", {})
    improvements = result.get("improvements", [])
    regressions = result.get("regressions", [])
    remaining = result.get("remaining_failures", [])

    total = test_results.get("total", 0)
    passed = test_results.get("passed", 0)

    lines = [f"=== Iteration {iteration}: {passed}/{total} passing ===", ""]

    if summary:
        lines.append(summary)
        lines.append("")

    if improvements:
        lines.append("IMPROVED:")
        for imp in improvements:
            lines.append(f"  + {imp['test']} — was {imp['was']}, now {imp['now']}")
        lines.append("")

    if regressions:
        lines.append("!! REGRESSIONS (fix broke something that was working):")
        for reg in regressions:
            lines.append(f"  ! {reg['test']} — was {reg['was']}, now {reg['now']}")
            if reg.get("diagnosis"):
                lines.append(f"    Diagnosis: {reg['diagnosis']}")
        lines.append("")

    if remaining:
        lines.append("STILL FAILING:")
        for fail in remaining:
            lines.append(f"  x {fail['test']}")
            if fail.get("diagnosis"):
                lines.append(f"    Diagnosis: {fail['diagnosis']}")
        lines.append("")

    # Suggest next steps
    if passed == total:
        lines.append(f"All tests passing! Call aethis_publish(project_id=\"{result.get('project_id', project_id)}\") to publish.")
    elif regressions:
        lines.append(
            "Regressions detected. The previous guidance may have been too broad. "
            "Consider narrowing it or adding more specific guidance, then call "
            "aethis_generate_and_test again."
        )
    elif remaining:
        lines.append(
            "To fix remaining failures:\n"
            "  - If the diagnosis points to a source text issue, call aethis_generate_and_test again\n"
            "    (failure context is included automatically).\n"
            "  - If it requires domain knowledge not in the source, call aethis_add_guidance\n"
            "    with the missing information, then aethis_generate_and_test."
        )

    lines.append(f"\nBundle: {bundle_id}")
    return "\n".join(lines)


@mcp.tool()
def aethis_refine(
    project_id: Annotated[str, "The project ID"],
    feedback: Annotated[str, "Optional correction or domain knowledge to add before regenerating"] = "",
) -> str:
    """Refine rules with optional feedback, then regenerate and test.

    If feedback is provided, it's stored as guidance before regenerating.
    This is a shortcut for: add_guidance + generate_and_test.

    If no feedback, just regenerates (previous failure context is
    automatically included).
    """
    try:
        client = _client()
        if feedback.strip():
            client.add_guidance(project_id, feedback)

        result = client.generate_and_test(project_id)
        prefix = ""
        if feedback.strip():
            prefix = f"Guidance added: \"{feedback[:100]}{'...' if len(feedback) > 100 else ''}\"\n\n"
        return prefix + _format_generate_and_test_result(result)
    except AethisAPIError as e:
        return f"Error: {e.detail} (HTTP {e.status_code})"


@mcp.tool()
def aethis_publish(
    project_id: Annotated[str, "The project ID"],
    force: Annotated[bool, "Publish even if tests are not all passing"] = False,
) -> str:
    """Publish the latest rule bundle, making it active for /decide calls.

    Runs tests first to verify. Refuses to publish if tests fail unless
    force=True. Publishing auto-deprecates any previous active bundle
    for the same section.
    """
    try:
        client = _client()

        # Run tests first to check
        test_result = client.run_tests(project_id)
        total = test_result.get("total", 0)
        passed = test_result.get("passed", 0)
        failed = test_result.get("failed", 0)
        errors = test_result.get("errors", 0)

        if (failed > 0 or errors > 0) and not force:
            lines = [
                f"Cannot publish: {passed}/{total} tests passing ({failed} failed, {errors} errors).",
                "",
                "Failing tests:",
            ]
            for r in test_result.get("results", []):
                if not r.get("passed"):
                    lines.append(f"  x {r.get('name')}: expected {r.get('expected')}, got {r.get('actual', 'error')}")
            lines.append("")
            lines.append("Fix failures with aethis_generate_and_test or aethis_refine,")
            lines.append("or call aethis_publish with force=True to override.")
            return "\n".join(lines)

        # Publish
        result = client.publish(project_id)
        bundle_id = result.get("bundle_id", "unknown")
        version = result.get("version", "unknown")
        deprecated = result.get("deprecated_bundles", [])

        lines = [
            f"Published successfully!",
            f"  Bundle: {bundle_id}",
            f"  Version: {version}",
            f"  Tests: {passed}/{total} passing",
        ]
        if deprecated:
            lines.append(f"  Deprecated: {', '.join(deprecated)}")
        return "\n".join(lines)

    except AethisAPIError as e:
        return f"Error: {e.detail} (HTTP {e.status_code})"


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
