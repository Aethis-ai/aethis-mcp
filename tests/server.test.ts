/**
 * Tests for the MCP server tool layer.
 *
 * We test the tool handler functions directly (exported from index.ts),
 * verifying input validation, client orchestration, error formatting,
 * and output structure — without starting a real MCP transport.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AethisClient } from "../src/client.js";

// We'll import these from index.ts — they're the tool handler functions
import {
  createToolHandlers,
  formatGenerateAndTestResult,
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
    createProject: vi.fn().mockResolvedValue({ project_id: "proj_abc" }),
    uploadSourceText: vi.fn().mockResolvedValue({ uploaded: 1 }),
    addTests: vi.fn().mockResolvedValue({ added: 1 }),
    addGuidance: vi.fn().mockResolvedValue({ hint_id: "h_1" }),
    generateAndTest: vi.fn().mockResolvedValue({
      iteration: 1, bundle_id: "b_1",
      summary: "", test_results: { total: 1, passed: 1, failed: 0, errors: 0 },
      improvements: [], regressions: [], remaining_failures: [],
    }),
    runTests: vi.fn().mockResolvedValue({
      total: 1, passed: 1, failed: 0, errors: 0, results: [],
    }),
    publish: vi.fn().mockResolvedValue({ bundle_id: "b_1", version: "v1", deprecated_bundles: [] }),
  };
  return { ...defaults, ...overrides } as unknown as AethisClient;
}

// Helper to get text content from tool result
function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? "";
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

describe("createToolHandlers", () => {
  it("returns all 12 tool handlers", () => {
    const handlers = createToolHandlers(mockClient());
    const names = Object.keys(handlers);
    expect(names).toHaveLength(12);
    expect(names).toContain("aethis_schema");
    expect(names).toContain("aethis_decide");
    expect(names).toContain("aethis_next_question");
    expect(names).toContain("aethis_explain");
    expect(names).toContain("aethis_list_projects");
    expect(names).toContain("aethis_project_status");
    expect(names).toContain("aethis_generate");
    expect(names).toContain("aethis_create_ruleset");
    expect(names).toContain("aethis_add_guidance");
    expect(names).toContain("aethis_generate_and_test");
    expect(names).toContain("aethis_refine");
    expect(names).toContain("aethis_publish");
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
        iteration: 1, bundle_id: "b_1", summary: "All pass",
        test_results: { total: 2, passed: 2, failed: 0, errors: 0 },
        improvements: [], regressions: [], remaining_failures: [],
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_generate_and_test({ project_id: "p_1" });
    const t = text(result);
    expect(t).toContain("2/2 passing");
    expect(t).toContain("aethis_publish");
  });

  it("shows failures with diagnosis", async () => {
    const client = mockClient({
      generateAndTest: vi.fn().mockResolvedValue({
        iteration: 1, bundle_id: "b_1", summary: "",
        test_results: { total: 2, passed: 1, failed: 1, errors: 0 },
        improvements: [], regressions: [],
        remaining_failures: [{ test: "dolphin_test", diagnosis: "species_check allows dolphins" }],
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_generate_and_test({ project_id: "p_1" });
    const t = text(result);
    expect(t).toContain("STILL FAILING");
    expect(t).toContain("dolphin_test");
    expect(t).toContain("species_check");
  });

  it("highlights regressions", async () => {
    const client = mockClient({
      generateAndTest: vi.fn().mockResolvedValue({
        iteration: 3, bundle_id: "b_1", summary: "",
        test_results: { total: 2, passed: 1, failed: 1, errors: 0 },
        improvements: [],
        regressions: [{ test: "towel_test", was: "PASS", now: "FAIL", diagnosis: "Removed" }],
        remaining_failures: [],
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_generate_and_test({ project_id: "p_1" });
    const t = text(result);
    expect(t).toContain("REGRESSION");
    expect(t).toContain("towel_test");
    expect(t).toContain("was PASS, now FAIL");
  });

  it("shows improvements", async () => {
    const client = mockClient({
      generateAndTest: vi.fn().mockResolvedValue({
        iteration: 2, bundle_id: "b_1", summary: "",
        test_results: { total: 2, passed: 2, failed: 0, errors: 0 },
        improvements: [{ test: "dolphin_test", was: "FAIL", now: "PASS" }],
        regressions: [], remaining_failures: [],
      }),
    });
    const h = createToolHandlers(client);
    const result = await h.aethis_generate_and_test({ project_id: "p_1" });
    const t = text(result);
    expect(t).toContain("IMPROVED");
    expect(t).toContain("was FAIL, now PASS");
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
// formatGenerateAndTestResult (pure function)
// ---------------------------------------------------------------------------

describe("formatGenerateAndTestResult", () => {
  it("formats all-passing result", () => {
    const t = formatGenerateAndTestResult({
      iteration: 1, bundle_id: "test:abc", summary: "All pass",
      test_results: { total: 2, passed: 2, failed: 0, errors: 0 },
      improvements: [], regressions: [], remaining_failures: [],
    });
    expect(t).toContain("2/2 passing");
    expect(t).toContain("aethis_publish");
    expect(t).not.toContain("REGRESSION");
  });

  it("formats empty result", () => {
    const t = formatGenerateAndTestResult({
      iteration: 1, bundle_id: "b1", summary: "",
      test_results: { total: 0, passed: 0, failed: 0, errors: 0 },
      improvements: [], regressions: [], remaining_failures: [],
    });
    expect(t).toContain("Iteration 1");
    expect(t).toContain("0/0 passing");
  });

  it("includes bundle_id", () => {
    const t = formatGenerateAndTestResult({
      iteration: 1, bundle_id: "test:20260405-abc", summary: "",
      test_results: { total: 0, passed: 0, failed: 0, errors: 0 },
      improvements: [], regressions: [], remaining_failures: [],
    });
    expect(t).toContain("test:20260405-abc");
  });
});
