/**
 * Tests for the MCP server tool layer.
 *
 * We test the tool handler functions directly (exported from index.ts),
 * verifying input validation, client orchestration, error formatting,
 * and output structure — without starting a real MCP transport.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AethisClient } from "../src/client.js";

import {
  createToolHandlers,
  formatTestResults,
  AUTHOR_PROMPT,
  decidePromptText,
  registerTools,
  type ToolHandlers,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

function mockClient(overrides: Partial<Record<keyof AethisClient, unknown>> = {}): AethisClient {
  const defaults: Record<string, unknown> = {
    decide: vi.fn().mockResolvedValue({ outcome: "eligible" }),
    decideRulebook: vi.fn().mockResolvedValue({ outcome: "eligible", rulebook_id: "rb_test" }),
    getSchema: vi.fn().mockResolvedValue({ ruleset_id: "b_123", fields: [] }),
    explain: vi.fn().mockResolvedValue({ rules: [] }),
    listProjects: vi.fn().mockResolvedValue([]),
    listRulesets: vi.fn().mockResolvedValue([]),
    discoverRulesets: vi.fn().mockResolvedValue([]),
    listRulebooks: vi.fn().mockResolvedValue([]),
    getRulebookSchema: vi.fn().mockResolvedValue({ rulebook_id: "rb_test", outcome_logic: null, rulesets: [], fields: [] }),
    archiveProject: vi.fn().mockResolvedValue({ message: "Archived" }),
    archiveRuleset: vi.fn().mockResolvedValue({ message: "Archived" }),
    createProject: vi.fn().mockResolvedValue({ project_id: "proj_abc" }),
    uploadSourceText: vi.fn().mockResolvedValue({ uploaded: 1 }),
    addTests: vi.fn().mockResolvedValue({ added: 1 }),
    addGuidance: vi.fn().mockResolvedValue({ hint_id: "h_1" }),
    addDomainGuidance: vi.fn().mockResolvedValue({ hint_id: "h_d1" }),
    listDomainGuidance: vi.fn().mockResolvedValue([]),
    discoverFields: vi.fn().mockResolvedValue({
      project_id: "p_1", iteration: 1, fields: [
        { key: "applicant.age", field_type: "integer", description: "Age", question: "How old?", enum_values: null, weight: 1 },
      ],
      completeness_score: 0.75, missing_pathways: ["spouse pathway"], critical_gaps: [],
      recommendation: "continue", is_complete: false,
    }),
    generateAndTest: vi.fn().mockResolvedValue({
      ruleset_id: "b_1",
      total: 1, passed: 1, failed: 0, errors: 0,
      results: [{ name: "c1", expected: "eligible", actual: "eligible", passed: true }],
    }),
    runTests: vi.fn().mockResolvedValue({
      total: 1, passed: 1, failed: 0, errors: 0, results: [],
    }),
    publish: vi.fn().mockResolvedValue({ ruleset_id: "b_1", version: "v1", deprecated_rulesets: [] }),
    hasApiKey: true,
    setApiKey: vi.fn(),
    retryDelayMs: 0,
    pollIntervalMs: 0,
    pollTimeoutMs: 1000,
  };
  return { ...defaults, ...overrides } as unknown as AethisClient;
}

/** Helper to get text content from tool result */
function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? "";
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

describe("createToolHandlers", () => {
  it("returns all 28 tool handlers", () => {
    const handlers = createToolHandlers(mockClient());
    const names = Object.keys(handlers);
    expect(names).toHaveLength(28);
    // Decision
    expect(names).toContain("aethis_schema");
    expect(names).toContain("aethis_decide");
    expect(names).toContain("aethis_next_question");
    expect(names).toContain("aethis_explain");
    expect(names).toContain("aethis_explain_failure");
    // Ruleset / project listing
    expect(names).toContain("aethis_list_projects");
    expect(names).toContain("aethis_list_rulesets");
    expect(names).toContain("aethis_discover_rulesets");
    expect(names).toContain("aethis_list_rulebooks");
    expect(names).toContain("aethis_rulebook_schema");
    expect(names).toContain("aethis_archive_project");
    expect(names).toContain("aethis_archive_ruleset");
    // Authoring lifecycle
    expect(names).toContain("aethis_create_ruleset");
    expect(names).toContain("aethis_add_guidance");
    expect(names).toContain("aethis_list_guidance");
    expect(names).toContain("aethis_generate_and_test");
    expect(names).toContain("aethis_refine");
    expect(names).toContain("aethis_publish");
    // Field discovery (Phase 2)
    expect(names).toContain("aethis_discover_fields");
    expect(names).toContain("aethis_refine_fields");
    expect(names).toContain("aethis_validate_fields");
    expect(names).toContain("aethis_set_field_spec");
    // Domain guidance
    expect(names).toContain("aethis_add_domain_guidance");
    expect(names).toContain("aethis_list_domain_guidance");
    // Section discovery (Phase 1)
    expect(names).toContain("aethis_discover_sections");
    expect(names).toContain("aethis_refine_sections");
    expect(names).toContain("aethis_validate_sections");
    // Internal (handler exists; not registered as an MCP tool — see A3 test below)
    expect(names).toContain("aethis_source");
  });
});

// ---------------------------------------------------------------------------
// Decision tools
// ---------------------------------------------------------------------------

describe("aethis_schema", () => {
  it("returns schema JSON", async () => {
    const client = mockClient({
      getSchema: vi.fn().mockResolvedValue({ ruleset_id: "b_123", fields: [{ name: "age" }] }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_schema({ ruleset_id: "b_123" });
    const data = JSON.parse(text(result));
    expect(data.ruleset_id).toBe("b_123");
    expect(data.fields).toHaveLength(1);
  });

  it("rejects empty ruleset_id", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_schema({ ruleset_id: "" });
    expect(text(result)).toMatch(/must not be empty/i);
  });

  it("includes error detail on API failure", async () => {
    const { AethisAPIError } = await import("../src/client.js");
    const client = mockClient({
      getSchema: vi.fn().mockRejectedValue(new AethisAPIError(404, "Ruleset not found")),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_schema({ ruleset_id: "bad" });
    expect(text(result)).toContain("404");
    expect(text(result)).toContain("Ruleset not found");
  });
});

describe("aethis_decide", () => {
  it("returns outcome JSON", async () => {
    const client = mockClient({
      decide: vi.fn().mockResolvedValue({ outcome: "eligible", reasoning: "All met" }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_decide({ ruleset_id: "b_123", field_values: { age: 30 } });
    const data = JSON.parse(text(result));
    expect(data.outcome).toBe("eligible");
  });

  it("rejects empty ruleset_id (whitespace doesn't count as provided)", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_decide({ ruleset_id: "  ", field_values: {} });
    expect(text(result)).toMatch(/exactly one of ruleset_id or rulebook_id/i);
  });

  it("passes include_trace and include_explanation to client", async () => {
    const decideFn = vi.fn().mockResolvedValue({ decision: "eligible" });
    const client = mockClient({ decide: decideFn });
    const h = createToolHandlers(client);
    await h.aethis_decide({
      ruleset_id: "b_123",
      field_values: { age: 30 },
      include_trace: true,
      include_explanation: true,
    });
    expect(decideFn).toHaveBeenCalledWith("b_123", { age: 30 }, {
      includeTrace: true,
      includeExplanation: true,
    });
  });

  // -- Rulebook surface (Aethis-ai/aethis-core#150 closure) --

  it("dispatches rulebook_id to client.decideRulebook", async () => {
    const decideFn = vi.fn().mockResolvedValue({ decision: "eligible", outcome: "eligible" });
    const decideRulebookFn = vi.fn().mockResolvedValue({
      decision: "eligible", rulebook_id: "rb_kzZ_td0tbKW_OLRB",
    });
    const client = mockClient({ decide: decideFn, decideRulebook: decideRulebookFn });
    const h = createToolHandlers(client);
    const result = await h.aethis_decide({
      rulebook_id: "aethis/uk-fsm",
      field_values: { "child.age": 10 },
    });
    expect(decideRulebookFn).toHaveBeenCalledWith("aethis/uk-fsm", { "child.age": 10 }, {
      includeTrace: undefined,
      includeExplanation: undefined,
    });
    expect(decideFn).not.toHaveBeenCalled();
    const data = JSON.parse(text(result));
    expect(data.rulebook_id).toBe("rb_kzZ_td0tbKW_OLRB");
  });

  it("rejects providing both ruleset_id and rulebook_id", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_decide({
      ruleset_id: "aethis/uk-fsm/child-eligibility",
      rulebook_id: "aethis/uk-fsm",
      field_values: {},
    });
    expect(text(result)).toMatch(/exactly one of ruleset_id or rulebook_id/i);
  });

  it("rejects neither id provided", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_decide({ field_values: {} });
    expect(text(result)).toMatch(/exactly one of ruleset_id or rulebook_id/i);
  });

  it("passes options through on rulebook path", async () => {
    const decideRulebookFn = vi.fn().mockResolvedValue({ decision: "eligible" });
    const client = mockClient({ decideRulebook: decideRulebookFn });
    const h = createToolHandlers(client);
    await h.aethis_decide({
      rulebook_id: "rb_x",
      field_values: { a: 1 },
      include_trace: true,
      include_explanation: true,
    });
    expect(decideRulebookFn).toHaveBeenCalledWith("rb_x", { a: 1 }, {
      includeTrace: true,
      includeExplanation: true,
    });
  });
});

describe("aethis_next_question", () => {
  it("shows next question when undetermined", async () => {
    const client = mockClient({
      decide: vi.fn().mockResolvedValue({
        decision: "undetermined",
        fields_evaluated: 5, fields_provided: 1,
        missing_fields: ["age", "cert"],
        next_question: { field_id: "cert", question: "Is cert valid?", weight: 1 },
        optimal_path: [
          { field_id: "cert", question: "Is cert valid?", weight: 1 },
          { field_id: "age", question: "What is age?", weight: 2 },
        ],
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_next_question({ ruleset_id: "b_1", field_values: {} });
    const t = text(result);
    expect(t).toContain("undetermined");
    expect(t).toContain("cert");
    expect(t).toContain("Is cert valid?");
    expect(t).toContain("2 questions");
  });

  it("returns done when eligible", async () => {
    const client = mockClient({
      decide: vi.fn().mockResolvedValue({ decision: "eligible" }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_next_question({ ruleset_id: "b_1", field_values: {} });
    expect(text(result)).toContain("eligible");
    expect(text(result)).toContain("No more questions");
  });

  it("returns done when not_eligible", async () => {
    const client = mockClient({
      decide: vi.fn().mockResolvedValue({ decision: "not_eligible" }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_next_question({ ruleset_id: "b_1", field_values: {} });
    expect(text(result)).toContain("not eligible");
  });
});

describe("aethis_explain", () => {
  it("returns rules JSON", async () => {
    const client = mockClient({
      explain: vi.fn().mockResolvedValue({ rules: [{ name: "r1", description: "desc" }] }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_explain({ ruleset_id: "b_123" });
    const data = JSON.parse(text(result));
    expect(data.rules).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Discovery tools
// ---------------------------------------------------------------------------

describe("aethis_list_projects", () => {
  it("returns projects JSON", async () => {
    const client = mockClient({
      listProjects: vi.fn().mockResolvedValue([{ project_id: "p_1", name: "test" }]),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_list_projects({});
    const data = JSON.parse(text(result));
    expect(data).toHaveLength(1);
    expect(data[0].project_id).toBe("p_1");
  });
});

describe("aethis_list_rulesets", () => {
  it("returns rulesets JSON", async () => {
    const client = mockClient({
      listRulesets: vi.fn().mockResolvedValue([
        { ruleset_id: "b_1", name: "Knowledge of language and life in the UK", status: "active", version: "v1" },
      ]),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_list_rulesets({ project_id: "p_1" });
    const data = JSON.parse(text(result));
    expect(data).toHaveLength(1);
    expect(data[0].ruleset_id).toBe("b_1");
    // aethis-core v0.18.0 added `name` (human-readable section title) — must
    // pass through to the LLM unchanged.
    expect(data[0].name).toBe("Knowledge of language and life in the UK");
  });

  it("rejects empty project_id", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_list_rulesets({ project_id: "" });
    expect(text(result)).toMatch(/must not be empty/i);
  });
});

describe("aethis_discover_rulesets", () => {
  it("returns rulesets JSON including name", async () => {
    const client = mockClient({
      discoverRulesets: vi.fn().mockResolvedValue([
        {
          ruleset_id: "b_1",
          slug: "uk-naturalisation",
          name: "Naturalisation as a British citizen",
          description: "Eligibility for UK naturalisation",
          field_count: 12,
          rule_count: 8,
        },
      ]),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_discover_rulesets({});
    const data = JSON.parse(text(result));
    expect(data).toHaveLength(1);
    expect(data[0].slug).toBe("uk-naturalisation");
    // aethis-core v0.18.0 added `name` to the public catalogue response.
    expect(data[0].name).toBe("Naturalisation as a British citizen");
  });

  it("passes limit and offset to the client", async () => {
    const discoverRulesets = vi.fn().mockResolvedValue([]);
    const client = mockClient({ discoverRulesets });
    const h = createToolHandlers(client);
    await h.aethis_discover_rulesets({ limit: 5, offset: 10 });
    expect(discoverRulesets).toHaveBeenCalledWith(5, 10);
  });
});

// ---------------------------------------------------------------------------
// Rulebook surface (aethis-mcp#43)
// ---------------------------------------------------------------------------

describe("aethis_list_rulebooks", () => {
  it("returns rulebooks JSON for the current tenant", async () => {
    const listRulebooks = vi.fn().mockResolvedValue([
      {
        rulebook_id: "rb_kzZ_td0tbKW_OLRB",
        slug: "aethis/uk-fsm",
        name: "UK Free School Meals Eligibility",
        domain: "uk_fsm",
        status: "active",
        version: "1",
        outcome_logic: { type: "op", operator: "and", args: [] },
        ruleset_refs: [],
      },
    ]);
    const client = mockClient({ listRulebooks });
    const h = createToolHandlers(client);
    const result = await h.aethis_list_rulebooks({});
    const data = JSON.parse(text(result));
    expect(data).toHaveLength(1);
    expect(data[0].slug).toBe("aethis/uk-fsm");
    // outcome_logic and ruleset_refs are the discriminators that answer
    // "is this one rulebook composing three or three independent rulesets?"
    // — they MUST pass through unchanged.
    expect(data[0].outcome_logic).toEqual({ type: "op", operator: "and", args: [] });
    expect(data[0].ruleset_refs).toEqual([]);
    expect(listRulebooks).toHaveBeenCalledWith();
  });

  it("includes error detail on API failure", async () => {
    const { AethisAPIError } = await import("../src/client.js");
    const client = mockClient({
      listRulebooks: vi.fn().mockRejectedValue(new AethisAPIError(403, "Forbidden")),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_list_rulebooks({});
    expect(text(result)).toContain("403");
    expect(text(result)).toContain("Forbidden");
  });
});

describe("aethis_rulebook_schema", () => {
  it("returns composition + bridged rulesets", async () => {
    const getRulebookSchema = vi.fn().mockResolvedValue({
      rulebook_id: "rb_kzZ_td0tbKW_OLRB",
      slug: "aethis/uk-fsm",
      outcome_logic: {
        type: "op",
        operator: "and",
        args: [
          { type: "field_ref", key: "child_eligibility" },
          { type: "op", operator: "or", args: [
            { type: "field_ref", key: "household_criteria" },
            { type: "field_ref", key: "universal_infant" },
          ] },
        ],
      },
      rulesets: [
        { ruleset_name: "child_eligibility", slug: "aethis/uk-fsm/child-eligibility", ruleset_id: "uk-fsm-child-eligibility:abc" },
        { ruleset_name: "household_criteria", slug: "aethis/uk-fsm/household-criteria", ruleset_id: "uk-fsm-household-criteria:def" },
        { ruleset_name: "universal_infant", slug: "aethis/uk-fsm/universal-infant", ruleset_id: "uk-fsm-universal-infant:ghi" },
      ],
      fields: [],
    });
    const client = mockClient({ getRulebookSchema });
    const h = createToolHandlers(client);
    const result = await h.aethis_rulebook_schema({ rulebook_id: "aethis/uk-fsm" });
    const data = JSON.parse(text(result));
    expect(data.rulebook_id).toBe("rb_kzZ_td0tbKW_OLRB");
    expect(data.rulesets).toHaveLength(3);
    expect(data.outcome_logic.operator).toBe("and");
    // The slug is passed verbatim to the client — the client decides
    // whether to URL-encode based on slug vs opaque id shape.
    expect(getRulebookSchema).toHaveBeenCalledWith("aethis/uk-fsm");
  });

  it("rejects empty rulebook_id", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_rulebook_schema({ rulebook_id: "" });
    expect(text(result)).toMatch(/must not be empty/i);
  });
});

// ---------------------------------------------------------------------------
// Management tools
// ---------------------------------------------------------------------------

describe("aethis_archive_project", () => {
  it("archives and returns result", async () => {
    const client = mockClient({
      archiveProject: vi.fn().mockResolvedValue({ message: "Project archived", project_id: "p_1" }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_archive_project({ project_id: "p_1" });
    expect(text(result)).toContain("archived");
  });

  it("rejects empty project_id", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_archive_project({ project_id: "" });
    expect(text(result)).toMatch(/must not be empty/i);
  });
});

describe("aethis_archive_ruleset", () => {
  it("archives and returns result", async () => {
    const client = mockClient({
      archiveRuleset: vi.fn().mockResolvedValue({ message: "Ruleset archived", ruleset_id: "b_1" }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_archive_ruleset({ ruleset_id: "b_1" });
    expect(text(result)).toContain("archived");
  });

  it("rejects empty ruleset_id", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_archive_ruleset({ ruleset_id: "" });
    expect(text(result)).toMatch(/must not be empty/i);
  });
});

// ---------------------------------------------------------------------------
// Authoring tools
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Intelligent authoring tools
// ---------------------------------------------------------------------------

describe("aethis_create_ruleset", () => {
  it("rejects empty test_cases", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_create_ruleset({
      name: "test", section_id: "s1", source_text: "Law.",
      test_cases: [],
    });
    expect(text(result)).toContain("At least 1 test case");
  });

  it("rejects test case missing keys", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_create_ruleset({
      name: "test", section_id: "s1", source_text: "Law.",
      test_cases: [{ name: "bad" }],
    });
    expect(text(result)).toContain("missing");
  });

  it("rejects invalid expected_outcome", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_create_ruleset({
      name: "test", section_id: "s1", source_text: "Law.",
      test_cases: [{ name: "c", field_values: {}, expected_outcome: "maybe" }],
    });
    expect(text(result)).toContain("invalid");
  });

  it("orchestrates create → upload → add_tests", async () => {
    const client = mockClient();
    const h = createToolHandlers(client);
    const result = await h.aethis_create_ruleset({
      name: "test-rules", section_id: "test_section", source_text: "The law says...",
      test_cases: [
        { name: "c1", field_values: { age: 30 }, expected_outcome: "eligible" },
        { name: "c2", field_values: { age: 10 }, expected_outcome: "not_eligible" },
      ],
    });
    const t = text(result);

    expect((client.createProject as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect((client.uploadSourceText as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect((client.addTests as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect(t).toContain("proj_abc");
    expect(t).toContain("2 test case");
    expect(t).toContain("aethis_generate_and_test");
  });
});

describe("aethis_add_guidance", () => {
  it("adds guidance and suggests next step", async () => {
    const client = mockClient();
    const h = createToolHandlers(client);
    const result = await h.aethis_add_guidance({
      project_id: "proj_abc", guidance_text: "Dolphins excluded",
    });
    expect(text(result)).toContain("Guidance added");
    expect(text(result)).toContain("aethis_generate_and_test");
  });
});

describe("aethis_generate_and_test", () => {
  it("shows pass count and suggests publish when all pass", async () => {
    const client = mockClient({
      generateAndTest: vi.fn().mockResolvedValue({
        ruleset_id: "b_1",
        total: 2, passed: 2, failed: 0, errors: 0,
        results: [
          { name: "c1", expected: "eligible", actual: "eligible", passed: true },
          { name: "c2", expected: "not_eligible", actual: "not_eligible", passed: true },
        ],
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_generate_and_test({ project_id: "p_1", anthropic_key: "ak_test" });
    const t = text(result);
    expect(t).toContain("2/2 passing");
    expect(t).toContain("aethis_publish");
  });

  it("shows failures with expected vs actual", async () => {
    const client = mockClient({
      generateAndTest: vi.fn().mockResolvedValue({
        ruleset_id: "b_1",
        total: 2, passed: 1, failed: 1, errors: 0,
        results: [
          { name: "good", expected: "eligible", actual: "eligible", passed: true },
          { name: "dolphin_test", expected: "not_eligible", actual: "eligible", passed: false },
        ],
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_generate_and_test({ project_id: "p_1", anthropic_key: "ak_test" });
    const t = text(result);
    expect(t).toContain("STILL FAILING");
    expect(t).toContain("dolphin_test");
    expect(t).toContain("expected not_eligible, got eligible");
  });

  it("detects regressions on second iteration", async () => {
    const genTest = vi.fn();
    const client = mockClient({ generateAndTest: genTest });
    const h = createToolHandlers(client);

    // First iteration: c1 passes, c2 fails
    genTest.mockResolvedValueOnce({
      ruleset_id: "b_1", total: 2, passed: 1, failed: 1, errors: 0,
      results: [
        { name: "c1", expected: "eligible", actual: "eligible", passed: true },
        { name: "c2", expected: "not_eligible", actual: "eligible", passed: false },
      ],
    });
    await h.aethis_generate_and_test({ project_id: "p_1", anthropic_key: "ak_test" });

    // Second iteration: c2 now passes but c1 regresses
    genTest.mockResolvedValueOnce({
      ruleset_id: "b_2", total: 2, passed: 1, failed: 1, errors: 0,
      results: [
        { name: "c1", expected: "eligible", actual: "not_eligible", passed: false },
        { name: "c2", expected: "not_eligible", actual: "not_eligible", passed: true },
      ],
    });
    const result = await h.aethis_generate_and_test({ project_id: "p_1", anthropic_key: "ak_test" });
    const t = text(result);
    expect(t).toContain("Iteration 2");
    expect(t).toContain("REGRESSION");
    expect(t).toContain("c1");
    expect(t).toContain("was PASS, now FAIL");
    expect(t).toContain("IMPROVED");
    expect(t).toContain("c2");
    expect(t).toContain("was FAIL, now PASS");
  });

  it("output includes ruleset_id and iteration number", async () => {
    const client = mockClient({
      generateAndTest: vi.fn().mockResolvedValue({
        ruleset_id: "space:20260405-abc",
        total: 1, passed: 1, failed: 0, errors: 0,
        results: [{ name: "c1", expected: "eligible", actual: "eligible", passed: true }],
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_generate_and_test({ project_id: "p_1", anthropic_key: "ak_test" });
    const t = text(result);
    expect(t).toContain("Iteration 1");
    expect(t).toContain("space:20260405-abc");
    expect(t).toContain("1/1 passing");
  });

  it("first iteration has no regressions section", async () => {
    const client = mockClient({
      generateAndTest: vi.fn().mockResolvedValue({
        ruleset_id: "b_1", total: 1, passed: 0, failed: 1, errors: 0,
        results: [{ name: "c1", expected: "eligible", actual: "not_eligible", passed: false }],
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_generate_and_test({ project_id: "p_new", anthropic_key: "ak_test" });
    const t = text(result);
    expect(t).toContain("Iteration 1");
    expect(t).not.toContain("REGRESSION");
    expect(t).not.toContain("IMPROVED");
    expect(t).toContain("STILL FAILING");
  });
});

describe("aethis_refine", () => {
  it("with feedback: adds guidance then generates", async () => {
    const client = mockClient();
    const h = createToolHandlers(client);
    const result = await h.aethis_refine({
      project_id: "p_1", feedback: "Dolphins excluded per Section 3(a).", anthropic_key: "ak_test",
    });
    expect((client.addGuidance as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("p_1", "Dolphins excluded per Section 3(a).");
    expect((client.generateAndTest as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect(text(result)).toContain("Guidance added");
  });

  it("without feedback: generates directly", async () => {
    const client = mockClient();
    const h = createToolHandlers(client);
    await h.aethis_refine({ project_id: "p_1", feedback: "", anthropic_key: "ak_test" });
    expect((client.addGuidance as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((client.generateAndTest as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it("whitespace-only feedback skips guidance", async () => {
    const client = mockClient();
    const h = createToolHandlers(client);
    await h.aethis_refine({ project_id: "p_1", feedback: "   ", anthropic_key: "ak_test" });
    expect((client.addGuidance as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe("aethis_publish", () => {
  it("refuses when tests fail", async () => {
    const client = mockClient({
      runTests: vi.fn().mockResolvedValue({
        total: 2, passed: 1, failed: 1, errors: 0,
        results: [
          { name: "good", expected: "eligible", actual: "eligible", passed: true },
          { name: "dolphin_test", expected: "not_eligible", actual: "eligible", passed: false },
        ],
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_publish({ project_id: "p_1" });
    const t = text(result);
    expect(t).toContain("Cannot publish");
    expect(t).toContain("dolphin_test");
    expect((client.publish as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("publishes when all tests pass", async () => {
    const client = mockClient({
      runTests: vi.fn().mockResolvedValue({ total: 2, passed: 2, failed: 0, errors: 0, results: [] }),
      publish: vi.fn().mockResolvedValue({ ruleset_id: "b_1", version: "v2", deprecated_rulesets: ["b_old"] }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_publish({ project_id: "p_1" });
    const t = text(result);
    expect(t).toContain("Published successfully");
    expect(t).toContain("v2");
    expect(t).toContain("b_old");
    expect((client.publish as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it("force publishes despite failures", async () => {
    const client = mockClient({
      runTests: vi.fn().mockResolvedValue({ total: 2, passed: 1, failed: 1, errors: 0, results: [] }),
      publish: vi.fn().mockResolvedValue({ ruleset_id: "b_1", version: "v2", deprecated_rulesets: [] }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_publish({ project_id: "p_1", force: true });
    expect(text(result)).toContain("Published successfully");
    expect((client.publish as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it("forwards name to client.publish and echoes it in output", async () => {
    const publishMock = vi.fn().mockResolvedValue({ ruleset_id: "b_1", version: "v3", deprecated_rulesets: [] });
    const client = mockClient({
      runTests: vi.fn().mockResolvedValue({ total: 1, passed: 1, failed: 0, errors: 0, results: [] }),
      publish: publishMock,
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_publish({ project_id: "p_1", name: "Knowledge of Language and Life" });
    const t = text(result);
    expect(t).toContain("Published successfully");
    expect(t).toContain("Knowledge of Language and Life");
    expect(publishMock).toHaveBeenCalledWith("p_1", undefined, "Knowledge of Language and Life");
  });

  it("omits name from client.publish when not provided", async () => {
    const publishMock = vi.fn().mockResolvedValue({ ruleset_id: "b_1", version: "v3", deprecated_rulesets: [] });
    const client = mockClient({
      runTests: vi.fn().mockResolvedValue({ total: 1, passed: 1, failed: 0, errors: 0, results: [] }),
      publish: publishMock,
    });
    const h = createToolHandlers(client);
    await h.aethis_publish({ project_id: "p_1" });
    expect(publishMock).toHaveBeenCalledWith("p_1", undefined, undefined);
  });
});

// ---------------------------------------------------------------------------
// formatTestResults (pure function)
// ---------------------------------------------------------------------------

describe("formatTestResults", () => {
  it("formats all-passing result", () => {
    const t = formatTestResults(
      {
        ruleset_id: "test:abc", total: 2, passed: 2, failed: 0, errors: 0,
        results: [
          { name: "c1", expected: "eligible", actual: "eligible", passed: true },
          { name: "c2", expected: "not_eligible", actual: "not_eligible", passed: true },
        ],
      },
      null,
      1,
    );
    expect(t).toContain("2/2 passing");
    expect(t).toContain("aethis_publish");
    expect(t).not.toContain("REGRESSION");
  });

  it("formats empty result", () => {
    const t = formatTestResults(
      { ruleset_id: "b1", total: 0, passed: 0, failed: 0, errors: 0, results: [] },
      null,
      1,
    );
    expect(t).toContain("Iteration 1");
    expect(t).toContain("0/0 passing");
  });

  it("includes ruleset_id", () => {
    const t = formatTestResults(
      { ruleset_id: "test:20260405-abc", total: 0, passed: 0, failed: 0, errors: 0, results: [] },
      null,
      1,
    );
    expect(t).toContain("test:20260405-abc");
  });

  it("shows improvements and regressions when previous results exist", () => {
    const prev = {
      ruleset_id: "b_old", total: 2, passed: 1, failed: 1, errors: 0,
      results: [
        { name: "c1", expected: "eligible", actual: "eligible", passed: true },
        { name: "c2", expected: "not_eligible", actual: "eligible", passed: false },
      ],
    };
    const curr = {
      ruleset_id: "b_new", total: 2, passed: 1, failed: 1, errors: 0,
      results: [
        { name: "c1", expected: "eligible", actual: "not_eligible", passed: false },
        { name: "c2", expected: "not_eligible", actual: "not_eligible", passed: true },
      ],
    };
    const t = formatTestResults(curr, prev, 2);
    expect(t).toContain("IMPROVED");
    expect(t).toContain("c2");
    expect(t).toContain("REGRESSION");
    expect(t).toContain("c1");
  });
});

// ---------------------------------------------------------------------------
// Field discovery tools
// ---------------------------------------------------------------------------

describe("aethis_discover_fields", () => {
  it("returns field list and completeness score", async () => {
    const client = mockClient();
    const h = createToolHandlers(client);
    const result = await h.aethis_discover_fields({ project_id: "p_1", anthropic_key: "ak_test" });
    const t = text(result);
    expect(t).toContain("Field Discovery");
    expect(t).toContain("applicant.age");
    expect(t).toContain("75%");
    expect(t).toContain("spouse pathway");
  });

  it("suggests refine when recommendation is continue", async () => {
    const client = mockClient();
    const h = createToolHandlers(client);
    const result = await h.aethis_discover_fields({ project_id: "p_1", anthropic_key: "ak_test" });
    const t = text(result);
    expect(t).toContain("aethis_refine_fields");
  });

  it("suggests test cases when recommendation is stop", async () => {
    const client = mockClient({
      discoverFields: vi.fn().mockResolvedValue({
        project_id: "p_1", iteration: 2, fields: [
          { key: "applicant.age", field_type: "integer", description: "Age" },
        ],
        completeness_score: 0.92, missing_pathways: [], critical_gaps: [],
        recommendation: "stop", is_complete: true,
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_discover_fields({ project_id: "p_1", anthropic_key: "ak_test" });
    const t = text(result);
    expect(t).toContain("test cases");
    expect(t).toContain("aethis_generate_and_test");
  });
});

describe("aethis_refine_fields", () => {
  it("adds guidance and re-discovers", async () => {
    const client = mockClient();
    const h = createToolHandlers(client);
    const result = await h.aethis_refine_fields({
      project_id: "p_1",
      feedback: "Section 7 implies a criminal record check",
      anthropic_key: "ak_test",
    });
    const t = text(result);
    expect(t).toContain("Guidance added");
    expect(t).toContain("criminal record");
    expect((client.addGuidance as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("p_1", "Section 7 implies a criminal record check", "field_extraction");
    expect((client.discoverFields as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// MCP Prompts
// ---------------------------------------------------------------------------

describe("AUTHOR_PROMPT", () => {
  it("contains the TDD workflow steps", () => {
    expect(AUTHOR_PROMPT).toContain("Step 1");
    expect(AUTHOR_PROMPT).toContain("Step 2");
    expect(AUTHOR_PROMPT).toContain("Step 3");
    expect(AUTHOR_PROMPT).toContain("Step 4");
    expect(AUTHOR_PROMPT).toContain("Step 5");
    expect(AUTHOR_PROMPT).toContain("Step 6");
  });

  it("references key tools in correct order", () => {
    const createIdx = AUTHOR_PROMPT.indexOf("aethis_create_ruleset");
    const discoverIdx = AUTHOR_PROMPT.indexOf("aethis_discover_fields");
    const genIdx = AUTHOR_PROMPT.indexOf("aethis_generate_and_test");
    // Match "aethis_refine" for rule refinement (Step 5), not "aethis_refine_fields"
    const refineMatch = AUTHOR_PROMPT.match(/aethis_refine(?!_fields)/);
    const refineIdx = refineMatch ? refineMatch.index! : -1;
    const publishIdx = AUTHOR_PROMPT.indexOf("aethis_publish");
    expect(createIdx).toBeGreaterThan(-1);
    expect(discoverIdx).toBeGreaterThan(createIdx);
    expect(genIdx).toBeGreaterThan(discoverIdx);
    expect(refineIdx).toBeGreaterThan(genIdx);
    expect(publishIdx).toBeGreaterThan(refineIdx);
  });

  it("includes good and bad guidance examples", () => {
    expect(AUTHOR_PROMPT).toContain("Good:");
    expect(AUTHOR_PROMPT).toContain("Bad:");
  });

  // A2: field discovery must precede the full test-writing step so test cases
  // use confirmed field names, not invented ones.
  it("A2: field discovery comes before writing full test cases", () => {
    const discoverIdx = AUTHOR_PROMPT.indexOf("aethis_discover_fields");
    // The full test-writing step instructs to use "discovered field names"
    const fullTestIdx = AUTHOR_PROMPT.indexOf("discovered field names");
    expect(discoverIdx).toBeGreaterThan(-1);
    expect(fullTestIdx).toBeGreaterThan(discoverIdx);
  });

  it("A2: includes domain guidance seeding step before generation", () => {
    const domainGuidanceIdx = AUTHOR_PROMPT.indexOf("aethis_add_domain_guidance");
    const genIdx = AUTHOR_PROMPT.indexOf("aethis_generate_and_test");
    expect(domainGuidanceIdx).toBeGreaterThan(-1);
    expect(genIdx).toBeGreaterThan(domainGuidanceIdx);
  });

  it("A2: instructs using undetermined for discretionary restrictions", () => {
    expect(AUTHOR_PROMPT).toContain("undetermined");
    expect(AUTHOR_PROMPT).toContain("advisory");
  });
});

// A3: aethis_source must not be registered as a public tool.
// The handler still exists in createToolHandlers for internal use,
// but the server.tool() registration was removed so users don't see it.
describe("A3 aethis_source tool visibility", () => {
  it("aethis_source handler still exists (internal use)", () => {
    const handlers = createToolHandlers(mockClient());
    // Handler exists in the object but is not registered as a public tool
    expect(typeof handlers.aethis_source).toBe("function");
  });

  it("tool handler count matches expected public tools (aethis_source excluded from server.tool)", () => {
    // createToolHandlers returns 28 handlers including aethis_source (internal).
    // registerTools is expected to publish 27 of them — aethis_source is the
    // single handler that exists but is not registered as an MCP tool.
    const handlers = createToolHandlers(mockClient());
    expect(Object.keys(handlers)).toHaveLength(28);
  });

  it("registerTools publishes 27 tools and does NOT register aethis_source", () => {
    // We intercept the McpServer-like object's .tool() calls to see exactly
    // which names are registered. Even if the count drifts in future, the
    // intent is: aethis_source is handler-only, never a public tool.
    const registered: string[] = [];
    const fakeServer = {
      tool: (name: string, ..._args: unknown[]) => {
        registered.push(name);
      },
      prompt: () => {},
    } as unknown as Parameters<typeof registerTools>[0];

    registerTools(fakeServer, createToolHandlers(mockClient()));

    expect(registered).toHaveLength(27);
    expect(registered).not.toContain("aethis_source");
    // Rulebook surface is registered (auth-gated handlers, but the registration
    // surfaces the tool to MCP clients regardless of key state).
    expect(registered).toContain("aethis_list_rulebooks");
    expect(registered).toContain("aethis_rulebook_schema");
  });
});

describe("decidePromptText", () => {
  it("without ruleset_id suggests discovery", () => {
    const text = decidePromptText();
    expect(text).toContain("aethis_discover_rulesets");
    expect(text).toContain("aethis_list_projects");
    expect(text).toContain("aethis_list_rulesets");
  });

  it("with ruleset_id skips discovery", () => {
    const text = decidePromptText("b_abc123");
    expect(text).toContain("b_abc123");
    expect(text).toContain("aethis_schema");
    expect(text).not.toContain("Start by helping the user find");
  });

  it("covers both quick decision and conversational patterns", () => {
    const text = decidePromptText();
    expect(text).toContain("Quick Decision");
    expect(text).toContain("Conversational Eligibility");
    expect(text).toContain("aethis_next_question");
    expect(text).toContain("aethis_decide");
  });

  it("documents all three outcome types", () => {
    const text = decidePromptText();
    expect(text).toContain("eligible");
    expect(text).toContain("not_eligible");
    expect(text).toContain("undetermined");
  });
});
