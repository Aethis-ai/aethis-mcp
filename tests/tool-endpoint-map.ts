/**
 * The explicit, checked-in map from every MCP tool to the engine operation(s)
 * its handler actually calls, and how each declared input field reaches the
 * engine (JSON body field, path/query parameter, or MCP-only convenience).
 *
 * This map is the ONE thing the drift suite is allowed to assert by hand — and
 * it deliberately carries no schema (no field types, no required flags). Those
 * come live from the deployed OpenAPI document. What lives here is the
 * *correspondence*: which operation a tool drives and which engine field each
 * zod field maps to (including renames like `force -> force_unsafe`).
 *
 * Discipline: every one of the 30 `server.tool()` registrations
 * MUST appear here, and every operation named here MUST exist in the deployed
 * OpenAPI document. A tool missing from this map, an unknown extra tool, or a
 * mapped operation absent from the engine is a FAILURE, never a skip.
 *
 * Field accounting: every declared input field of a tool must be classified in
 * exactly one place — an endpoint's `body`, `pathParams`, or `query`, or the
 * tool's `mcpOnly` list. An unclassified field fails the suite, so a newly
 * added input can never silently escape the drift check.
 */

/** One engine operation a tool's handler calls. */
export interface EndpointRef {
  method: string;
  /** OpenAPI path template, e.g. `/api/v1/public/decide`. */
  path: string;
  /**
   * zod field -> engine JSON body field name. Same name unless renamed
   * (e.g. `{ force: "force_unsafe" }`). Only for operations with a JSON body.
   */
  body?: Record<string, string>;
  /** zod field -> OpenAPI `in: path` parameter name. */
  pathParams?: Record<string, string>;
  /** zod field -> OpenAPI `in: query` parameter name. */
  query?: Record<string, string>;
  /**
   * True when the request body is multipart/form (not a JSON model in the
   * OpenAPI doc). Existence of the operation is still checked; JSON-field
   * alignment is skipped because there is no JSON model to compare against.
   */
  form?: boolean;
  /**
   * Engine JSON body fields the handler synthesizes itself (not from any zod
   * field), so they need not be covered by an input field even when the engine
   * marks them required.
   */
  bodyDefaults?: string[];
}

export interface ToolMapEntry {
  /** Operations the handler calls; the FIRST is the primary drift target. */
  endpoints: EndpointRef[];
  /** Declared input fields with no engine request counterpart. */
  mcpOnly?: string[];
  /** True when the tool orchestrates more than one engine call. */
  composite?: boolean;
  note?: string;
}

const PUB = "/api/v1/public";

/** The Anthropic/OpenAI key inputs — resolved to the `X-Anthropic-Key` header
 * or a credential lookup, never sent as a request-body field. */
const LLM_KEY_FIELDS = [
  "anthropic_key_env",
  "anthropic_key_keychain",
  "anthropic_key",
  "openai_key",
];

export const TOOL_ENDPOINT_MAP: Record<string, ToolMapEntry> = {
  aethis_schema: {
    endpoints: [
      { method: "GET", path: `${PUB}/rulesets/{ruleset_id}/schema`, pathParams: { ruleset_id: "ruleset_id" } },
    ],
  },

  aethis_decide: {
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/decide`,
        body: {
          ruleset_id: "ruleset_id",
          rulebook_id: "rulebook_id",
          field_values: "field_values",
          include_trace: "include_trace",
          include_explanation: "include_explanation",
          include_graph_overlay: "include_graph_overlay",
        },
      },
    ],
  },

  // ruleset_id -> GET /rulesets/{id}/graph; rulebook_id -> GET
  // /rulebooks/{id}/graph. Only one is called per invocation (mutually
  // exclusive, like aethis_decide), but both operations are real and are
  // listed here so the existence check covers whichever path a caller takes.
  aethis_graph: {
    endpoints: [
      {
        method: "GET",
        path: `${PUB}/rulesets/{ruleset_id}/graph`,
        pathParams: { ruleset_id: "ruleset_id" },
      },
      {
        method: "GET",
        path: `${PUB}/rulebooks/{rulebook_id}/graph`,
        pathParams: { rulebook_id: "rulebook_id" },
      },
    ],
  },

  // Drives POST /decide (the handler reads next_question/optimal_path off the
  // decision), sending only ruleset_id + field_values.
  aethis_next_question: {
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/decide`,
        body: { ruleset_id: "ruleset_id", field_values: "field_values" },
      },
    ],
  },

  aethis_explain: {
    endpoints: [
      { method: "GET", path: `${PUB}/rulesets/{ruleset_id}/explain`, pathParams: { ruleset_id: "ruleset_id" } },
    ],
  },

  aethis_explain_failure: {
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/rulesets/{ruleset_id}/explain-failure`,
        pathParams: { ruleset_id: "ruleset_id" },
        body: {
          field_values: "field_values",
          expected_outcome: "expected_outcome",
          test_name: "test_name",
        },
      },
    ],
  },

  aethis_list_projects: {
    endpoints: [{ method: "GET", path: `${PUB}/projects/` }],
  },

  aethis_list_rulesets: {
    endpoints: [
      { method: "GET", path: `${PUB}/projects/{project_id}/rulesets`, pathParams: { project_id: "project_id" } },
    ],
  },

  aethis_discover_rulesets: {
    endpoints: [
      { method: "GET", path: `${PUB}/rulesets`, query: { limit: "limit", offset: "offset" } },
    ],
  },

  aethis_list_rulebooks: {
    endpoints: [{ method: "GET", path: `${PUB}/rulebooks/` }],
  },

  aethis_rulebook_schema: {
    endpoints: [
      { method: "GET", path: `${PUB}/rulebooks/{rulebook_id}/schema`, pathParams: { rulebook_id: "rulebook_id" } },
    ],
  },

  aethis_create_rulebook: {
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/rulebooks/`,
        body: {
          name: "name",
          domain: "domain",
          slug: "slug",
          description: "description",
          robot_hints: "robot_hints",
        },
      },
    ],
  },

  aethis_update_rulebook: {
    endpoints: [
      {
        method: "PATCH",
        path: `${PUB}/rulebooks/{rulebook_id}`,
        pathParams: { rulebook_id: "rulebook_id" },
        body: {
          name: "name",
          description: "description",
          slug: "slug",
          robot_hints: "robot_hints",
        },
      },
    ],
  },

  aethis_archive_project: {
    endpoints: [
      { method: "POST", path: `${PUB}/projects/{project_id}/archive`, pathParams: { project_id: "project_id" } },
    ],
  },

  aethis_archive_ruleset: {
    endpoints: [
      { method: "POST", path: `${PUB}/rulesets/{ruleset_id}/archive`, pathParams: { ruleset_id: "ruleset_id" } },
    ],
  },

  // Composite: creates the project, uploads the source text (multipart), then
  // adds the test cases. project_id is synthesized at runtime between calls.
  aethis_create_ruleset: {
    composite: true,
    note: "Orchestrates project create + source upload + add tests.",
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/projects/`,
        body: { name: "name", section_id: "section_id", domain: "domain" },
      },
      {
        method: "POST",
        path: `${PUB}/projects/{project_id}/sources`,
        form: true,
        body: { source_text: "content" },
      },
      {
        method: "POST",
        path: `${PUB}/projects/{project_id}/tests`,
        body: { test_cases: "test_cases" },
      },
    ],
  },

  aethis_list_guidance: {
    endpoints: [
      { method: "GET", path: `${PUB}/projects/{project_id}/guidance`, pathParams: { project_id: "project_id" } },
    ],
  },

  aethis_add_guidance: {
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/projects/{project_id}/guidance`,
        pathParams: { project_id: "project_id" },
        body: {
          guidance_text: "guidance_text",
          process_type: "process_type",
          adherence: "adherence",
        },
      },
    ],
  },

  aethis_add_domain_guidance: {
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/domains/{domain}/guidance`,
        pathParams: { domain: "domain" },
        body: {
          guidance_text: "guidance_text",
          process_type: "process_type",
          adherence: "adherence",
          notes: "notes",
        },
      },
    ],
  },

  aethis_list_domain_guidance: {
    endpoints: [
      { method: "GET", path: `${PUB}/domains/{domain}/guidance`, pathParams: { domain: "domain" } },
    ],
  },

  aethis_discover_sections: {
    mcpOnly: LLM_KEY_FIELDS,
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/domains/{domain}/sections/discover`,
        pathParams: { domain: "domain" },
        body: { sources: "sources" },
      },
    ],
  },

  // Composite: saves the feedback as a domain guidance hint, then re-discovers.
  aethis_refine_sections: {
    composite: true,
    mcpOnly: LLM_KEY_FIELDS,
    note: "Adds domain guidance (feedback) then re-runs section discovery.",
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/domains/{domain}/sections/discover`,
        pathParams: { domain: "domain" },
        body: { sources: "sources" },
      },
      {
        method: "POST",
        path: `${PUB}/domains/{domain}/guidance`,
        pathParams: { domain: "domain" },
        body: { feedback: "guidance_text" },
      },
    ],
  },

  aethis_validate_sections: {
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/domains/{domain}/sections/validate`,
        pathParams: { domain: "domain" },
        body: {
          expected_sections: "expected_sections",
          discovered_sections: "discovered_sections",
        },
      },
    ],
  },

  aethis_discover_fields: {
    mcpOnly: LLM_KEY_FIELDS,
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/projects/{project_id}/fields/discover`,
        pathParams: { project_id: "project_id" },
      },
    ],
  },

  // Composite: adds a field_extraction guidance hint, then re-discovers.
  aethis_refine_fields: {
    composite: true,
    mcpOnly: LLM_KEY_FIELDS,
    note: "Adds field-extraction guidance (feedback) then re-runs field discovery.",
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/projects/{project_id}/fields/discover`,
        pathParams: { project_id: "project_id" },
      },
      {
        method: "POST",
        path: `${PUB}/projects/{project_id}/guidance`,
        pathParams: { project_id: "project_id" },
        body: { feedback: "guidance_text" },
      },
    ],
  },

  aethis_validate_fields: {
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/projects/{project_id}/fields/validate`,
        pathParams: { project_id: "project_id" },
        body: { expected_fields: "expected_fields" },
      },
    ],
  },

  aethis_set_field_spec: {
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/projects/{project_id}/fields/spec`,
        pathParams: { project_id: "project_id" },
        body: { expected_fields: "expected_fields" },
      },
    ],
  },

  // Triggers POST /generate (mode is handler-supplied) then polls status.
  aethis_generate_and_test: {
    mcpOnly: LLM_KEY_FIELDS,
    note: "Calls POST /generate (mode synthesized) then polls /status.",
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/projects/{project_id}/generate`,
        pathParams: { project_id: "project_id" },
        bodyDefaults: ["mode", "seed_ruleset_id"],
      },
    ],
  },

  // Composite: optionally adds guidance (feedback), then generate(mode=refine).
  aethis_refine: {
    composite: true,
    mcpOnly: LLM_KEY_FIELDS,
    note: "Optionally adds guidance (feedback) then POST /generate (mode=refine).",
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/projects/{project_id}/generate`,
        pathParams: { project_id: "project_id" },
        bodyDefaults: ["mode", "seed_ruleset_id"],
      },
      {
        method: "POST",
        path: `${PUB}/projects/{project_id}/guidance`,
        pathParams: { project_id: "project_id" },
        body: { feedback: "guidance_text" },
      },
    ],
  },

  aethis_publish: {
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/projects/{project_id}/publish`,
        pathParams: { project_id: "project_id" },
        body: { force: "force_unsafe", label: "label", name: "name" },
      },
    ],
  },

  // Authoring Coach (aethis-workspace#514). The LLM-key inputs are resolved to
  // the X-Anthropic-Key header (mcpOnly), never a body field; `coach` is the
  // one JSON body field of ReviewRequest.
  aethis_review_project: {
    mcpOnly: LLM_KEY_FIELDS,
    endpoints: [
      {
        method: "POST",
        path: `${PUB}/projects/{project_id}/review`,
        pathParams: { project_id: "project_id" },
        body: { coach: "coach" },
      },
    ],
  },
};
