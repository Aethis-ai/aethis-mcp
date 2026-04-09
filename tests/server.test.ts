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
  type ToolHandlers,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

function mockClient(overrides: Partial<Record<keyof AethisClient, unknown>> = {}): AethisClient {
  const defaults: Record<string, unknown> = {
    decide: vi.fn().mockResolvedValue({ outcome: "eligible" }),
    getSchema: vi.fn().mockResolvedValue({ bundle_id: "b_123", fields: [] }),
    explain: vi.fn().mockResolvedValue({ rules: [] }),
    listProjects: vi.fn().mockResolvedValue([]),
    getStatus: vi.fn().mockResolvedValue({ project_id: "p_1" }),
    generate: vi.fn().mockResolvedValue({ job_id: "j_1", status: "queued" }),
    listBundles: vi.fn().mockResolvedValue([]),
    archiveProject: vi.fn().mockResolvedValue({ message: "Archived" }),
    archiveBundle: vi.fn().mockResolvedValue({ message: "Archived" }),
    createProject: vi.fn().mockResolvedValue({ project_id: "proj_abc" }),
    uploadSourceText: vi.fn().mockResolvedValue({ uploaded: 1 }),
    addTests: vi.fn().mockResolvedValue({ added: 1 }),
    listTests: vi.fn().mockResolvedValue([]),
    getTest: vi.fn().mockResolvedValue({ tc_id: "tc_1", name: "c1", field_values: {}, expected_outcome: "eligible" }),
    updateTest: vi.fn().mockResolvedValue({ tc_id: "tc_1", name: "updated", field_values: {}, expected_outcome: "eligible" }),
    deleteTest: vi.fn().mockResolvedValue({ deleted: "tc_1" }),
    addGuidance: vi.fn().mockResolvedValue({ hint_id: "h_1" }),
    generateAndTest: vi.fn().mockResolvedValue({
      bundle_id: "b_1",
      total: 1, passed: 1, failed: 0, errors: 0,
      results: [{ name: "c1", expected: "eligible", actual: "eligible", passed: true }],
    }),
    runTests: vi.fn().mockResolvedValue({
      total: 1, passed: 1, failed: 0, errors: 0, results: [],
    }),
    publish: vi.fn().mockResolvedValue({ bundle_id: "b_1", version: "v1", deprecated_bundles: [] }),
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
  it("returns all 19 tool handlers", () => {
    const handlers = createToolHandlers(mockClient());
    const names = Object.keys(handlers);
    expect(names).toHaveLength(19);
    expect(names).toContain("aethis_schema");
    expect(names).toContain("aethis_decide");
    expect(names).toContain("aethis_next_question");
    expect(names).toContain("aethis_explain");
    expect(names).toContain("aethis_list_projects");
    expect(names).toContain("aethis_project_status");
    expect(names).toContain("aethis_list_bundles");
    expect(names).toContain("aethis_archive_project");
    expect(names).toContain("aethis_archive_bundle");
    expect(names).toContain("aethis_generate");
    expect(names).toContain("aethis_create_bundle");
    expect(names).toContain("aethis_add_guidance");
    expect(names).toContain("aethis_generate_and_test");
    expect(names).toContain("aethis_refine");
    expect(names).toContain("aethis_publish");
    expect(names).toContain("aethis_list_tests");
    expect(names).toContain("aethis_get_test");
    expect(names).toContain("aethis_update_test");
    expect(names).toContain("aethis_delete_test");
  });
});

// ---------------------------------------------------------------------------
// Decision tools
// ---------------------------------------------------------------------------

describe("aethis_schema", () => {
  it("returns schema JSON", async () => {
    const client = mockClient({
      getSchema: vi.fn().mockResolvedValue({ bundle_id: "b_123", fields: [{ name: "age" }] }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_schema({ bundle_id: "b_123" });
    const data = JSON.parse(text(result));
    expect(data.bundle_id).toBe("b_123");
    expect(data.fields).toHaveLength(1);
  });

  it("rejects empty bundle_id", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_schema({ bundle_id: "" });
    expect(text(result)).toMatch(/must not be empty/i);
  });

  it("includes error detail on API failure", async () => {
    const { AethisAPIError } = await import("../src/client.js");
    const client = mockClient({
      getSchema: vi.fn().mockRejectedValue(new AethisAPIError(404, "Bundle not found")),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_schema({ bundle_id: "bad" });
    expect(text(result)).toContain("404");
    expect(text(result)).toContain("Bundle not found");
  });
});

describe("aethis_decide", () => {
  it("returns outcome JSON", async () => {
    const client = mockClient({
      decide: vi.fn().mockResolvedValue({ outcome: "eligible", reasoning: "All met" }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_decide({ bundle_id: "b_123", field_values: { age: 30 } });
    const data = JSON.parse(text(result));
    expect(data.outcome).toBe("eligible");
  });

  it("rejects empty bundle_id", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_decide({ bundle_id: "  ", field_values: {} });
    expect(text(result)).toMatch(/must not be empty/i);
  });

  it("passes include_trace and include_explanation to client", async () => {
    const decideFn = vi.fn().mockResolvedValue({ decision: "eligible" });
    const client = mockClient({ decide: decideFn });
    const h = createToolHandlers(client);
    await h.aethis_decide({
      bundle_id: "b_123",
      field_values: { age: 30 },
      include_trace: true,
      include_explanation: true,
    });
    expect(decideFn).toHaveBeenCalledWith("b_123", { age: 30 }, {
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
    const result = await h.aethis_next_question({ bundle_id: "b_1", field_values: {} });
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
    const result = await h.aethis_next_question({ bundle_id: "b_1", field_values: {} });
    expect(text(result)).toContain("eligible");
    expect(text(result)).toContain("No more questions");
  });

  it("returns done when not_eligible", async () => {
    const client = mockClient({
      decide: vi.fn().mockResolvedValue({ decision: "not_eligible" }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_next_question({ bundle_id: "b_1", field_values: {} });
    expect(text(result)).toContain("not eligible");
  });
});

describe("aethis_explain", () => {
  it("returns rules JSON", async () => {
    const client = mockClient({
      explain: vi.fn().mockResolvedValue({ rules: [{ name: "r1", description: "desc" }] }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_explain({ bundle_id: "b_123" });
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

describe("aethis_project_status", () => {
  it("returns status JSON", async () => {
    const client = mockClient({
      getStatus: vi.fn().mockResolvedValue({ project_id: "p_1", job: { status: "success" } }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_project_status({ project_id: "p_1" });
    const data = JSON.parse(text(result));
    expect(data.job.status).toBe("success");
  });

  it("rejects empty project_id", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_project_status({ project_id: "" });
    expect(text(result)).toMatch(/must not be empty/i);
  });
});

describe("aethis_list_bundles", () => {
  it("returns bundles JSON", async () => {
    const client = mockClient({
      listBundles: vi.fn().mockResolvedValue([
        { bundle_id: "b_1", status: "active", version: "v1" },
      ]),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_list_bundles({ project_id: "p_1" });
    const data = JSON.parse(text(result));
    expect(data).toHaveLength(1);
    expect(data[0].bundle_id).toBe("b_1");
  });

  it("rejects empty project_id", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_list_bundles({ project_id: "" });
    expect(text(result)).toMatch(/must not be empty/i);
  });
});

// ---------------------------------------------------------------------------
// Test case tools
// ---------------------------------------------------------------------------

describe("aethis_list_tests", () => {
  it("returns test cases JSON", async () => {
    const client = mockClient({
      listTests: vi.fn().mockResolvedValue([
        { tc_id: "tc_1", name: "c1", field_values: { age: 30 }, expected_outcome: "eligible" },
      ]),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_list_tests({ project_id: "p_1" });
    const data = JSON.parse(text(result));
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("c1");
    expect(data[0].field_values.age).toBe(30);
  });

  it("rejects empty project_id", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_list_tests({ project_id: "" });
    expect(text(result)).toMatch(/must not be empty/i);
  });
});

describe("aethis_get_test", () => {
  it("returns single test case", async () => {
    const client = mockClient({
      getTest: vi.fn().mockResolvedValue({ tc_id: "tc_1", name: "c1", field_values: {}, expected_outcome: "eligible" }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_get_test({ project_id: "p_1", tc_id: "tc_1" });
    const data = JSON.parse(text(result));
    expect(data.tc_id).toBe("tc_1");
  });

  it("rejects empty tc_id", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_get_test({ project_id: "p_1", tc_id: "" });
    expect(text(result)).toMatch(/must not be empty/i);
  });
});

describe("aethis_update_test", () => {
  it("updates and returns result", async () => {
    const updateFn = vi.fn().mockResolvedValue({ tc_id: "tc_1", name: "renamed", field_values: {}, expected_outcome: "eligible" });
    const client = mockClient({ updateTest: updateFn });
    const h = createToolHandlers(client);
    const result = await h.aethis_update_test({ project_id: "p_1", tc_id: "tc_1", name: "renamed" });
    expect(text(result)).toContain("renamed");
    expect(updateFn).toHaveBeenCalledWith("p_1", "tc_1", { name: "renamed" });
  });

  it("rejects invalid expected_outcome", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_update_test({ project_id: "p_1", tc_id: "tc_1", expected_outcome: "maybe" });
    expect(text(result)).toContain("invalid");
  });

  it("rejects update with no fields", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_update_test({ project_id: "p_1", tc_id: "tc_1" });
    expect(text(result)).toContain("at least one field");
  });
});

describe("aethis_delete_test", () => {
  it("deletes and returns confirmation", async () => {
    const client = mockClient({
      deleteTest: vi.fn().mockResolvedValue({ deleted: "tc_1" }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_delete_test({ project_id: "p_1", tc_id: "tc_1" });
    expect(text(result)).toContain("tc_1");
  });

  it("rejects empty tc_id", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_delete_test({ project_id: "p_1", tc_id: "" });
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

describe("aethis_archive_bundle", () => {
  it("archives and returns result", async () => {
    const client = mockClient({
      archiveBundle: vi.fn().mockResolvedValue({ message: "Bundle archived", bundle_id: "b_1" }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_archive_bundle({ bundle_id: "b_1" });
    expect(text(result)).toContain("archived");
  });

  it("rejects empty bundle_id", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_archive_bundle({ bundle_id: "" });
    expect(text(result)).toMatch(/must not be empty/i);
  });
});

// ---------------------------------------------------------------------------
// Authoring tools
// ---------------------------------------------------------------------------

describe("aethis_generate", () => {
  it("returns job info JSON", async () => {
    const client = mockClient({
      generate: vi.fn().mockResolvedValue({ job_id: "j_1", status: "queued" }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_generate({ project_id: "p_1" });
    const data = JSON.parse(text(result));
    expect(data.status).toBe("queued");
  });
});

// ---------------------------------------------------------------------------
// Intelligent authoring tools
// ---------------------------------------------------------------------------

describe("aethis_create_bundle", () => {
  it("rejects empty test_cases", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_create_bundle({
      name: "test", section_id: "s1", source_text: "Law.",
      test_cases: [],
    });
    expect(text(result)).toContain("At least 1 test case");
  });

  it("rejects test case missing keys", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_create_bundle({
      name: "test", section_id: "s1", source_text: "Law.",
      test_cases: [{ name: "bad" }],
    });
    expect(text(result)).toContain("missing");
  });

  it("rejects invalid expected_outcome", async () => {
    const h = createToolHandlers(mockClient());
    const result = await h.aethis_create_bundle({
      name: "test", section_id: "s1", source_text: "Law.",
      test_cases: [{ name: "c", field_values: {}, expected_outcome: "maybe" }],
    });
    expect(text(result)).toContain("invalid");
  });

  it("orchestrates create → upload → add_tests", async () => {
    const client = mockClient();
    const h = createToolHandlers(client);
    const result = await h.aethis_create_bundle({
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
        bundle_id: "b_1",
        total: 2, passed: 2, failed: 0, errors: 0,
        results: [
          { name: "c1", expected: "eligible", actual: "eligible", passed: true },
          { name: "c2", expected: "not_eligible", actual: "not_eligible", passed: true },
        ],
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_generate_and_test({ project_id: "p_1" });
    const t = text(result);
    expect(t).toContain("2/2 passing");
    expect(t).toContain("aethis_publish");
  });

  it("shows failures with expected vs actual", async () => {
    const client = mockClient({
      generateAndTest: vi.fn().mockResolvedValue({
        bundle_id: "b_1",
        total: 2, passed: 1, failed: 1, errors: 0,
        results: [
          { name: "good", expected: "eligible", actual: "eligible", passed: true },
          { name: "dolphin_test", expected: "not_eligible", actual: "eligible", passed: false },
        ],
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_generate_and_test({ project_id: "p_1" });
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
      bundle_id: "b_1", total: 2, passed: 1, failed: 1, errors: 0,
      results: [
        { name: "c1", expected: "eligible", actual: "eligible", passed: true },
        { name: "c2", expected: "not_eligible", actual: "eligible", passed: false },
      ],
    });
    await h.aethis_generate_and_test({ project_id: "p_1" });

    // Second iteration: c2 now passes but c1 regresses
    genTest.mockResolvedValueOnce({
      bundle_id: "b_2", total: 2, passed: 1, failed: 1, errors: 0,
      results: [
        { name: "c1", expected: "eligible", actual: "not_eligible", passed: false },
        { name: "c2", expected: "not_eligible", actual: "not_eligible", passed: true },
      ],
    });
    const result = await h.aethis_generate_and_test({ project_id: "p_1" });
    const t = text(result);
    expect(t).toContain("Iteration 2");
    expect(t).toContain("REGRESSION");
    expect(t).toContain("c1");
    expect(t).toContain("was PASS, now FAIL");
    expect(t).toContain("IMPROVED");
    expect(t).toContain("c2");
    expect(t).toContain("was FAIL, now PASS");
  });

  it("output includes bundle_id and iteration number", async () => {
    const client = mockClient({
      generateAndTest: vi.fn().mockResolvedValue({
        bundle_id: "space:20260405-abc",
        total: 1, passed: 1, failed: 0, errors: 0,
        results: [{ name: "c1", expected: "eligible", actual: "eligible", passed: true }],
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_generate_and_test({ project_id: "p_1" });
    const t = text(result);
    expect(t).toContain("Iteration 1");
    expect(t).toContain("space:20260405-abc");
    expect(t).toContain("1/1 passing");
  });

  it("first iteration has no regressions section", async () => {
    const client = mockClient({
      generateAndTest: vi.fn().mockResolvedValue({
        bundle_id: "b_1", total: 1, passed: 0, failed: 1, errors: 0,
        results: [{ name: "c1", expected: "eligible", actual: "not_eligible", passed: false }],
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_generate_and_test({ project_id: "p_new" });
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
      project_id: "p_1", feedback: "Dolphins excluded per Section 3(a).",
    });
    expect((client.addGuidance as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("p_1", "Dolphins excluded per Section 3(a).");
    expect((client.generateAndTest as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect(text(result)).toContain("Guidance added");
  });

  it("without feedback: generates directly", async () => {
    const client = mockClient();
    const h = createToolHandlers(client);
    await h.aethis_refine({ project_id: "p_1", feedback: "" });
    expect((client.addGuidance as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((client.generateAndTest as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });

  it("whitespace-only feedback skips guidance", async () => {
    const client = mockClient();
    const h = createToolHandlers(client);
    await h.aethis_refine({ project_id: "p_1", feedback: "   " });
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
      publish: vi.fn().mockResolvedValue({ bundle_id: "b_1", version: "v2", deprecated_bundles: ["b_old"] }),
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
      publish: vi.fn().mockResolvedValue({ bundle_id: "b_1", version: "v2", deprecated_bundles: [] }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_publish({ project_id: "p_1", force: true });
    expect(text(result)).toContain("Published successfully");
    expect((client.publish as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// formatTestResults (pure function)
// ---------------------------------------------------------------------------

describe("formatTestResults", () => {
  it("formats all-passing result", () => {
    const t = formatTestResults(
      {
        bundle_id: "test:abc", total: 2, passed: 2, failed: 0, errors: 0,
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
      { bundle_id: "b1", total: 0, passed: 0, failed: 0, errors: 0, results: [] },
      null,
      1,
    );
    expect(t).toContain("Iteration 1");
    expect(t).toContain("0/0 passing");
  });

  it("includes bundle_id", () => {
    const t = formatTestResults(
      { bundle_id: "test:20260405-abc", total: 0, passed: 0, failed: 0, errors: 0, results: [] },
      null,
      1,
    );
    expect(t).toContain("test:20260405-abc");
  });

  it("shows improvements and regressions when previous results exist", () => {
    const prev = {
      bundle_id: "b_old", total: 2, passed: 1, failed: 1, errors: 0,
      results: [
        { name: "c1", expected: "eligible", actual: "eligible", passed: true },
        { name: "c2", expected: "not_eligible", actual: "eligible", passed: false },
      ],
    };
    const curr = {
      bundle_id: "b_new", total: 2, passed: 1, failed: 1, errors: 0,
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
// MCP Prompts
// ---------------------------------------------------------------------------

describe("AUTHOR_PROMPT", () => {
  it("contains the TDD workflow steps", () => {
    expect(AUTHOR_PROMPT).toContain("Step 1");
    expect(AUTHOR_PROMPT).toContain("Step 2");
    expect(AUTHOR_PROMPT).toContain("Step 3");
    expect(AUTHOR_PROMPT).toContain("Step 4");
    expect(AUTHOR_PROMPT).toContain("Step 5");
  });

  it("references key tools in correct order", () => {
    const createIdx = AUTHOR_PROMPT.indexOf("aethis_create_bundle");
    const genIdx = AUTHOR_PROMPT.indexOf("aethis_generate_and_test");
    const refineIdx = AUTHOR_PROMPT.indexOf("aethis_refine");
    const publishIdx = AUTHOR_PROMPT.indexOf("aethis_publish");
    expect(createIdx).toBeGreaterThan(-1);
    expect(genIdx).toBeGreaterThan(createIdx);
    expect(refineIdx).toBeGreaterThan(genIdx);
    expect(publishIdx).toBeGreaterThan(refineIdx);
  });

  it("includes good and bad guidance examples", () => {
    expect(AUTHOR_PROMPT).toContain("Good:");
    expect(AUTHOR_PROMPT).toContain("Bad:");
  });
});

describe("decidePromptText", () => {
  it("without bundle_id suggests discovery", () => {
    const text = decidePromptText();
    expect(text).toContain("aethis_list_projects");
    expect(text).toContain("aethis_list_bundles");
  });

  it("with bundle_id skips discovery", () => {
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
