/**
 * Test-case expectation `field_errors`: the exact per-field messages a
 * bundle-contract rule is expected to report. Valid only with outcome
 * `undetermined`; transported unchanged.
 */
import { describe, it, expect, vi } from "vitest";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { AethisClient } from "../src/client.js";
import {
  acceptanceContractDigest,
  createToolHandlers,
  formatTestResults,
  registerTools,
  validateAcceptanceContract,
} from "../src/index.js";

const MESSAGE = "The renewal date must not be before the date the member joined.";
const FIELD_ERRORS = { "member.renewal_date": MESSAGE };

function tc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "renewal before joining",
    field_values: { "member.joined_date": "2024-05-01", "member.renewal_date": "2024-04-01" },
    expected_outcome: "undetermined",
    expectations: { field_errors: FIELD_ERRORS },
    ...over,
  };
}

function mockClient(): AethisClient {
  const sent: { contract?: Parameters<typeof acceptanceContractDigest>[0] } = {};
  return {
    hasApiKey: true,
    createProject: vi.fn().mockResolvedValue({ project_id: "proj_1" }),
    uploadSourceText: vi.fn().mockResolvedValue({}),
    preflightTestReplacement: vi.fn().mockResolvedValue(undefined),
    replaceTests: vi.fn().mockImplementation(async (_id: string, _cases: unknown, contract?: Parameters<typeof acceptanceContractDigest>[0]) => {
      sent.contract = contract;
      return { added: 1, replaced: 0 };
    }),
    addTests: vi.fn().mockResolvedValue({ added: 1 }),
    // Read back exactly what was sent, as the engine would.
    getProject: vi.fn().mockImplementation(async () => {
      const contract = sent.contract!;
      return {
        authoring_acceptance_contract_version: 1,
        expected_review_bindings: null,
        authoring_acceptance_contract_digest: acceptanceContractDigest(contract),
      };
    }),
  } as unknown as AethisClient;
}

async function call(client: AethisClient, name: string, args: Record<string, unknown>) {
  const server = new McpServer({ name: "t", version: "0" });
  registerTools(server, createToolHandlers(client));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new McpClient({ name: "c", version: "0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return mcp.callTool({ name, arguments: args }) as Promise<{ isError?: boolean; content: Array<{ text?: string }> }>;
}

describe("validateAcceptanceContract: field_errors", () => {
  it("accepts field_errors with an undetermined outcome and transports it unchanged", () => {
    const v = validateAcceptanceContract([tc()], 1);
    expect(v.error).toBeUndefined();
    expect(v.contract?.test_cases[0].expectations).toEqual({ field_errors: FIELD_ERRORS });
  });

  it("combines with the existing expectation keys", () => {
    const v = validateAcceptanceContract(
      [tc({ expectations: { field_errors: FIELD_ERRORS, useful_unknown_fields: ["a"] } })],
      1,
    );
    expect(v.contract?.test_cases[0].expectations).toEqual({ field_errors: FIELD_ERRORS, useful_unknown_fields: ["a"] });
  });

  it("includes field_errors in the acceptance digest", () => {
    const withKey = validateAcceptanceContract([tc()], 1).contract!;
    const other = validateAcceptanceContract([tc({ expectations: { field_errors: { "member.renewal_date": "Other." } } })], 1).contract!;
    expect(acceptanceContractDigest(withKey)).not.toBe(acceptanceContractDigest(other));
  });

  it.each([
    ["empty", {}],
    ["null", null],
    ["an array", [MESSAGE]],
    ["a non-string value", { "member.renewal_date": 5 }],
    ["an empty message", { "member.renewal_date": "" }],
    ["an empty key", { "": MESSAGE }],
    ["a blank key", { "   ": MESSAGE }],
    ["a key over 300 code points", { ["k".repeat(301)]: MESSAGE }],
    ["a message over 20000 code points", { "member.renewal_date": "m".repeat(20001) }],
    ["more than 500 entries", Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`f${i}`, "m"]))],
  ])("refuses field_errors that are %s", (_label, value) => {
    const v = validateAcceptanceContract([tc({ expectations: { field_errors: value } })], 1);
    expect(v.error).toContain("field_errors");
  });

  it.each(["eligible", "not_eligible"])("refuses field_errors when the expected outcome is %s", (outcome) => {
    const v = validateAcceptanceContract([tc({ expected_outcome: outcome })], 1);
    expect(v.error).toContain("undetermined");
  });

  it("accepts the bounds exactly", () => {
    const entries = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`f${i}`, "m".repeat(20000)]));
    expect(validateAcceptanceContract([tc({ expectations: { field_errors: entries } })], 1).error).toBeUndefined();
  });

  it("lists field_errors among the supported expectation keys in the refusal", () => {
    const v = validateAcceptanceContract([tc({ expectations: { nonsense: true } })], 1);
    expect(v.error).toContain("field_errors");
  });

  it("serialises byte-identically when the key is not used", () => {
    const cases = [tc({ expected_outcome: "eligible", expectations: { useful_unknown_fields: ["a"] } })];
    const v = validateAcceptanceContract(cases, 1);
    expect(JSON.stringify(v.contract)).toBe(JSON.stringify({
      contract_version: 1,
      test_cases: [{
        name: "renewal before joining",
        field_values: { "member.joined_date": "2024-05-01", "member.renewal_date": "2024-04-01" },
        expected_outcome: "eligible",
        expectations: { useful_unknown_fields: ["a"] },
      }],
    }));
  });
});

describe("field_errors through the MCP boundary", () => {
  it("is accepted by aethis_create_ruleset and sent unchanged", async () => {
    const client = mockClient();
    const result = await call(client, "aethis_create_ruleset", {
      name: "n", section_id: "s", source_text: "Source.", contract_version: 1, test_cases: [tc()],
    });
    expect(result.isError).toBeFalsy();
    const sent = (client.replaceTests as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(sent.test_cases[0].expectations).toEqual({ field_errors: FIELD_ERRORS });
  });

  it("is accepted by aethis_set_tests", async () => {
    const client = mockClient();
    const result = await call(client, "aethis_set_tests", { project_id: "p_1", contract_version: 1, test_cases: [tc()] });
    expect(result.isError).toBeFalsy();
    expect((client.replaceTests as ReturnType<typeof vi.fn>).mock.calls[0][1][0].expectations).toEqual({ field_errors: FIELD_ERRORS });
  });

  it.each([
    ["an empty object", { field_errors: {} }],
    ["a non-string value", { field_errors: { a: 1 } }],
    ["an over-long message", { field_errors: { a: "m".repeat(20001) } }],
    ["a blank key", { field_errors: { " ": "m" } }],
  ])("refuses %s before any request", async (_label, expectations) => {
    const client = mockClient();
    const result = await call(client, "aethis_set_tests", { project_id: "p_1", contract_version: 1, test_cases: [tc({ expectations })] });
    expect(result.isError).toBe(true);
    expect(client.replaceTests).not.toHaveBeenCalled();
  });

  it("refuses field_errors with an eligible outcome before any request", async () => {
    const client = mockClient();
    const result = await call(client, "aethis_set_tests", {
      project_id: "p_1", contract_version: 1, test_cases: [tc({ expected_outcome: "eligible" })],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("undetermined");
    expect(client.replaceTests).not.toHaveBeenCalled();
  });
});

describe("rendering of input-invariant results", () => {
  it("shows the field errors of a failing test case", () => {
    const out = formatTestResults({
      ruleset_id: "r_1", total: 1, passed: 0, failed: 1, errors: 0,
      results: [{ name: "renewal before joining", expected: "undetermined", actual: "eligible", passed: false, field_errors: FIELD_ERRORS }],
    }, null, 1);
    expect(out).toContain("member.renewal_date");
    expect(out).toContain(MESSAGE);
  });

  it("does not add a field-errors line when there are none", () => {
    const out = formatTestResults({
      ruleset_id: "r_1", total: 1, passed: 0, failed: 1, errors: 0,
      results: [{ name: "c", expected: "eligible", actual: "undetermined", passed: false, field_errors: null }],
    }, null, 1);
    expect(out).not.toContain("field_errors");
    expect(out).not.toContain("Field errors");
  });

  it("uses neutral wording that is true for a type error as well as an invariant", async () => {
    for (const fe of [{ age: "Expected a number." }, FIELD_ERRORS]) {
      const client = {
        hasApiKey: false,
        decide: vi.fn().mockResolvedValue({ decision: "undetermined", undetermined_reason: "input_errors", field_errors: fe }),
      } as unknown as AethisClient;
      const t = (await createToolHandlers(client).aethis_next_question({ ruleset_id: "r_1", field_values: {} })).content[0].text;
      expect(t).toContain("some inputs were rejected");
      expect(t).not.toContain("contradict");
    }
    // also when the reason is something else but field_errors is present
    const client = {
      hasApiKey: false,
      decide: vi.fn().mockResolvedValue({ decision: "undetermined", undetermined_reason: "other", field_errors: { a: "b" } }),
    } as unknown as AethisClient;
    const t = (await createToolHandlers(client).aethis_next_question({ ruleset_id: "r_1", field_values: {} })).content[0].text;
    expect(t).not.toContain("contradict");
    expect(t).toContain("some inputs were rejected");
  });

  it("fences field_errors keys in next_question and in failing test results", async () => {
    const key = "ZZ_KEY_INJECT";
    const client = {
      hasApiKey: false,
      decide: vi.fn().mockResolvedValue({ decision: "undetermined", undetermined_reason: "input_errors", field_errors: { [key]: "m" } }),
    } as unknown as AethisClient;
    const nq = (await createToolHandlers(client).aethis_next_question({ ruleset_id: "r_1", field_values: {} })).content[0].text;
    const tr = formatTestResults({
      ruleset_id: "r", total: 1, passed: 0, failed: 1, errors: 0,
      results: [{ name: "c", expected: "undetermined", actual: "eligible", passed: false, field_errors: { [key]: "m" } }],
    }, null, 1);
    for (const out of [nq, tr]) {
      expect(out.replace(/<api_response label="[^"]*">\n[\s\S]*?<\/api_response>/g, "")).not.toContain(key);
      expect(out).toContain(key);
      expect(out).toContain("some inputs were rejected");
    }
  });

  it("aethis_next_question shows why an undetermined decision stopped on input errors", async () => {
    const client = {
      hasApiKey: false,
      decide: vi.fn().mockResolvedValue({
        decision: "undetermined",
        undetermined_reason: "input_errors",
        field_errors: FIELD_ERRORS,
        fields_provided: 2,
        fields_evaluated: 2,
      }),
    } as unknown as AethisClient;
    const result = await createToolHandlers(client).aethis_next_question({ ruleset_id: "r_1", field_values: {} });
    const t = result.content[0].text;
    expect(t).toContain("input_errors");
    expect(t).toContain("member.renewal_date");
    expect(t).toContain(MESSAGE);
  });
});
