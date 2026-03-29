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
        "Aethis is a neuro-symbolic AI platform for regulated eligibility checks. "
        "Use `aethis_schema` to discover what input fields a rule bundle requires, "
        "then `aethis_decide` to evaluate eligibility, and `aethis_explain` for "
        "human-readable rule descriptions. "
        "Use `aethis_list_projects` to discover available projects and bundles."
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
    - next_question: the Z3-optimized best question to ask next
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

    Uses Z3 constraint optimization to determine the single best question
    to ask next, given the answers so far. Also returns the full remaining
    path (all questions still needed, sorted by priority).

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


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
