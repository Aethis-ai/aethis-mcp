/**
 * aethis_set_bundle_contract: argument validation, request shape, the stored
 * digest readback, and the message an older Aethis API gets.
 */
import { describe, it, expect, vi } from "vitest";
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AethisAPIError, AethisClient, BundleContractUnsupportedError } from "../src/client.js";
import { createToolHandlers, registerTools } from "../src/index.js";

const INVARIANT = {
  id: "renewal_after_joined",
  expr: {
    type: "op",
    operator: ">=",
    args: [
      { type: "field_ref", key: "member.renewal_date" },
      { type: "field_ref", key: "member.joined_date" },
    ],
  },
  error_fields: ["member.renewal_date"],
  message: "The renewal date must not be before the date the member joined.",
};

const DIGEST = "sha256:" + "a".repeat(64);

function text(result: { content: Array<{ text?: string }> }): string {
  return result.content[0]?.text ?? "";
}

function mockClient(overrides: Record<string, unknown> = {}): AethisClient {
  return {
    hasApiKey: true,
    setBundleContract: vi.fn().mockResolvedValue({ project_id: "p_1", bundle_contract_digest: DIGEST }),
    ...overrides,
  } as unknown as AethisClient;
}

async function callThroughSdk(client: AethisClient, args: Record<string, unknown>) {
  const server = new McpServer({ name: "t", version: "0" });
  registerTools(server, createToolHandlers(client));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new McpClient({ name: "c", version: "0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return mcp.callTool({ name: "aethis_set_bundle_contract", arguments: args }) as Promise<{
    isError?: boolean;
    content: Array<{ text?: string }>;
  }>;
}

describe("aethis_set_bundle_contract handler", () => {
  it("sends schema_version 1 with the invariants and reports the stored digest", async () => {
    const client = mockClient();
    const result = await createToolHandlers(client).aethis_set_bundle_contract({
      project_id: "p_1",
      input_invariants: [INVARIANT],
    });
    expect(result.isError).toBeUndefined();
    expect(client.setBundleContract).toHaveBeenCalledWith("p_1", { schema_version: 1, input_invariants: [INVARIANT] });
    const t = text(result);
    expect(t).toContain("1 input invariant");
    expect(t).toContain(DIGEST);
    expect(t).toContain("Next step:");
    expect(t).toContain("aethis_generate_and_test");
  });

  it.each([
    ["omitted", undefined],
    ["an empty array", []],
  ])("clears the stored contract when input_invariants is %s", async (_label, value) => {
    const client = mockClient({ setBundleContract: vi.fn().mockResolvedValue({ project_id: "p_1", bundle_contract_digest: null }) });
    const result = await createToolHandlers(client).aethis_set_bundle_contract({
      project_id: "p_1",
      ...(value === undefined ? {} : { input_invariants: value }),
    });
    expect(client.setBundleContract).toHaveBeenCalledWith("p_1", { schema_version: 1 });
    expect(text(result)).toContain("cleared");
  });

  it("requires an API key", async () => {
    const client = mockClient({ hasApiKey: false });
    const result = await createToolHandlers(client).aethis_set_bundle_contract({ project_id: "p_1", input_invariants: [INVARIANT] });
    expect(result.isError).toBe(true);
    expect(client.setBundleContract).not.toHaveBeenCalled();
  });

  it("refuses a missing project_id", async () => {
    const client = mockClient();
    const result = await createToolHandlers(client).aethis_set_bundle_contract({ project_id: "", input_invariants: [INVARIANT] });
    expect(result.isError).toBe(true);
    expect(client.setBundleContract).not.toHaveBeenCalled();
  });

  it("surfaces the engine's own message when it refuses the contract", async () => {
    const client = mockClient({
      setBundleContract: vi.fn().mockRejectedValue(new AethisAPIError(422, "input invariant x: expression must be exactly one comparison")),
    });
    const result = await createToolHandlers(client).aethis_set_bundle_contract({ project_id: "p_1", input_invariants: [INVARIANT] });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("HTTP 422");
    expect(text(result)).toContain("exactly one comparison");
  });

  it("says plainly when this Aethis API does not support bundle contracts yet", async () => {
    const client = mockClient({ setBundleContract: vi.fn().mockRejectedValue(new BundleContractUnsupportedError()) });
    const result = await createToolHandlers(client).aethis_set_bundle_contract({ project_id: "p_1", input_invariants: [INVARIANT] });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("does not support bundle contracts yet");
    expect(text(result)).not.toContain("HTTP 404");
  });
});

describe("aethis_set_bundle_contract input schema (MCP boundary)", () => {
  const bad: Array<[string, unknown]> = [
    ["a non-array", { id: "x" }],
    ["more than 32 invariants", Array.from({ length: 33 }, (_, i) => ({ ...INVARIANT, id: `inv_${i}` }))],
    ["a missing id", [{ ...INVARIANT, id: undefined }]],
    ["an id with a space", [{ ...INVARIANT, id: "bad id" }]],
    ["a missing message", [{ ...INVARIANT, message: undefined }]],
    ["an empty message", [{ ...INVARIANT, message: "" }]],
    ["a message over 512 bytes", [{ ...INVARIANT, message: "x".repeat(513) }]],
    ["empty error_fields", [{ ...INVARIANT, error_fields: [] }]],
    ["more than 16 error_fields", [{ ...INVARIANT, error_fields: Array.from({ length: 17 }, (_, i) => `f${i}`) }]],
    ["an unknown invariant key", [{ ...INVARIANT, severity: "high" }]],
    ["an operator outside the comparison set", [{ ...INVARIANT, expr: { ...INVARIANT.expr, operator: "and" } }]],
    ["a comparison with three operands", [{ ...INVARIANT, expr: { ...INVARIANT.expr, args: [...INVARIANT.expr.args, INVARIANT.expr.args[0]] } }]],
    ["a nested expression operand", [{ ...INVARIANT, expr: { ...INVARIANT.expr, args: [INVARIANT.expr, INVARIANT.expr.args[1]] } }]],
    ["duplicate ids", [INVARIANT, INVARIANT]],
    ["an error field the expression does not read", [{ ...INVARIANT, error_fields: ["member.other"] }]],
  ];

  it.each(bad)("refuses %s before any request", async (_label, invariants) => {
    const client = mockClient();
    const result = await callThroughSdk(client, { project_id: "p_1", input_invariants: invariants });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Input validation error");
    expect(client.setBundleContract).not.toHaveBeenCalled();
  });

  it("accepts a valid comparison against a constant and leaves deeper checks to the engine", async () => {
    const client = mockClient();
    const invariant = {
      id: "age_floor",
      expr: { type: "op", operator: "<", args: [{ type: "field_ref", key: "member.age" }, { type: "const", sort: "Int", value: 5 }] },
      error_fields: ["member.age"],
      message: "Too young.",
    };
    const result = await callThroughSdk(client, { project_id: "p_1", input_invariants: [invariant] });
    expect(result.isError).toBeFalsy();
    expect(client.setBundleContract).toHaveBeenCalledWith("p_1", { schema_version: 1, input_invariants: [invariant] });
  });

  it("rejects unknown top-level arguments", async () => {
    const client = mockClient();
    const result = await callThroughSdk(client, { project_id: "p_1", contract: {} });
    expect(result.isError).toBe(true);
    expect(client.setBundleContract).not.toHaveBeenCalled();
  });
});

describe("AethisClient.setBundleContract", () => {
  function res(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(),
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  function client(fetchFn: ReturnType<typeof vi.fn>): AethisClient {
    return new AethisClient("ak_test", "https://api.aethis.ai", { fetchFn: fetchFn as unknown as typeof fetch, retryDelayMs: 0 });
  }

  it("PUTs the contract to the project's bundle-contract route", async () => {
    const fetchFn = vi.fn().mockResolvedValue(res({ project_id: "p_1", bundle_contract_digest: DIGEST }));
    const body = { schema_version: 1 as const, input_invariants: [INVARIANT] };
    await expect(client(fetchFn).setBundleContract("p_1", body)).resolves.toMatchObject({ bundle_contract_digest: DIGEST });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://api.aethis.ai/api/v1/public/projects/p_1/bundle-contract");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it.each([404, 405])("reports an API that lacks the route (HTTP %s) as unsupported", async (status) => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(res({ detail: "Not Found" }, status))
      .mockResolvedValueOnce(res({ paths: { "/api/v1/public/projects/{project_id}/tests": { post: {} } } }));
    await expect(client(fetchFn).setBundleContract("p_1", { schema_version: 1 })).rejects.toBeInstanceOf(BundleContractUnsupportedError);
    expect(fetchFn.mock.calls[1][0]).toBe("https://api.aethis.ai/openapi.json");
  });

  it("keeps the engine's 404 when the route is advertised (the project is what is missing)", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(res({ detail: "Project not found" }, 404))
      .mockResolvedValueOnce(res({ paths: { "/api/v1/public/projects/{project_id}/bundle-contract": { put: {} } } }));
    await expect(client(fetchFn).setBundleContract("p_9", { schema_version: 1 })).rejects.toMatchObject({
      statusCode: 404,
      detail: "Project not found",
    });
  });

  it("keeps the engine's 404 when the API description cannot be read", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(res({ detail: "Project not found" }, 404))
      .mockResolvedValueOnce(res({ detail: "boom" }, 500));
    await expect(client(fetchFn).setBundleContract("p_9", { schema_version: 1 })).rejects.toMatchObject({ statusCode: 404 });
  });

  it("does not probe for other failures", async () => {
    const fetchFn = vi.fn().mockResolvedValue(res({ detail: "invalid" }, 422));
    await expect(client(fetchFn).setBundleContract("p_1", { schema_version: 1 })).rejects.toMatchObject({ statusCode: 422 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
