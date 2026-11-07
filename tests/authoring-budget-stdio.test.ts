/** Real stdio JSON-RPC -> registered tools -> local HTTP; no provider calls. */
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { parse } from "yaml";
import { AethisClient, normalizeMaxCostUsd } from "../src/client.js";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface Request { method: string; path: string; body: unknown }
const resources: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of resources.splice(0).reverse()) await close(); });

async function fixture(options: { advertised?: boolean; unreadable?: boolean; fail?: boolean; admissionFailure?: "connection" | "503" } = {}) {
  const requests: Request[] = [];
  let contractReadback: unknown = {};
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    const body = raw ? JSON.parse(raw) : undefined;
    const path = req.url!;
    requests.push({ method: req.method!, path, body });
    if (req.method === "POST" && (path.endsWith("/generate") || path.endsWith("/fields/discover")) && options.admissionFailure) {
      if (options.admissionFailure === "connection") res.destroy();
      else { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ detail: "simulated unavailable response after admission" })); }
      return;
    }
    res.setHeader("content-type", "application/json");
    let result: unknown = {};
    if (path === "/openapi.json") {
      if (options.unreadable) { res.statusCode = 404; result = { detail: "unavailable" }; }
      else {
        const properties = options.advertised === false ? {} : { max_cost_usd: { type: "string" } };
        result = { components: { schemas: {
          GenerationModeRequest: { properties }, FieldDiscoveryRequest: { properties },
          ExpectedFieldSpec: { properties: options.advertised === false ? {} : { label: {}, question: {}, weight: {} } },
          AddTestCaseRequest: { properties: { replace: { type: "boolean" }, contract_version: {}, expected_review_bindings: {} } },
        } } };
      }
    } else if (path.endsWith("/fields/discover")) {
      result = { fields: [], operation_id: "discovery-1", spend_budget: { limit_usd: "1.250000000" } };
      if (options.fail) {
        res.statusCode = 402;
        result = { detail: { message: "discovery_spend_budget_exhausted", operation_id: "discovery-1", spend_budget: { limit_usd: "1.250000000", stop_reason: "reservation_would_exceed_limit" } } };
      }
    }
    else if (path.endsWith("/generate")) result = { job_id: "job-1" };
    else if (path.endsWith("/status")) result = {
      latest_ruleset_id: "rules-1", job: { job_id: "job-1", status: options.fail ? "failed" : "success",
        error_message: options.fail ? "generation_spend_budget_exhausted" : null,
        spend_budget: { limit_usd: "17.250000000", reserved_usd: "16", physical_sends: 2, stop_reason: options.fail ? "reservation_would_exceed_limit" : null } },
    };
    else if (path.endsWith("/test-run")) result = { total: 1, passed: 1, failed: 0, errors: 0, results: [] };
    else if (path.endsWith("/fields/spec")) result = { stored: true };
    else if (path.endsWith("/guidance")) result = { hint_id: "hint-1" };
    else if (path.endsWith("/tests")) {
      const wire = body as { test_cases: Array<{ name: string; field_values: unknown; expected_outcome: string; expectations?: unknown }>; expected_review_bindings?: unknown };
      const canonical = canonicalize({ version: 1, expected_review_bindings: wire.expected_review_bindings ?? null,
        test_cases: wire.test_cases.map((tc) => ({ name: tc.name, inputs: tc.field_values, expect: { outcome: tc.expected_outcome, ...(tc.expectations ?? {}) } })) });
      contractReadback = { authoring_acceptance_contract_version: 1, expected_review_bindings: wire.expected_review_bindings ?? null,
        authoring_acceptance_contract_digest: `sha256:${createHash("sha256").update(canonical!).digest("hex")}` };
      result = { added: wire.test_cases.length, replaced: 0 };
    }
    else if (path === "/api/v1/public/projects/p" && req.method === "GET") result = contractReadback;
    else { res.statusCode = 404; result = { detail: `Unexpected local request ${path}` }; }
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  resources.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  const client = new Client({ name: "offline-authoring-contract", version: "1" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", fileURLToPath(new URL("../src/index.ts", import.meta.url))],
    env: { PATH: process.env.PATH!, AETHIS_API_KEY: "offline-test-key", AETHIS_BASE_URL: `http://127.0.0.1:${address.port}`, AETHIS_DISABLE_UPDATE_CHECK: "1", AETHIS_ANTHROPIC_KEY_ENV: "OFFLINE_PROVIDER_KEY", OFFLINE_PROVIDER_KEY: "sk-ant-offline-synthetic-not-a-real-credential" },
    stderr: "pipe",
  }));
  resources.push(() => client.close());
  return { client, requests };
}

describe("native authoring budget through MCP stdio", () => {
  it.each(["19", "19.00", "0.000000001", "1000000", "1000000.000000000"])("preserves valid exact text %s", (value) => {
    expect(normalizeMaxCostUsd(value)).toBe(value);
  });

  it.each(["aethis_generate_and_test", "aethis_refine", "aethis_discover_fields"])("forwards exact decimal text for %s", async (name) => {
    const { client, requests } = await fixture();
    const result = await client.callTool({ name, arguments: { project_id: "p", max_cost_usd: "17.250000000" } });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const post = requests.find((r) => r.method === "POST");
    expect(post?.body).toEqual(name === "aethis_refine" ? { mode: "refine", max_cost_usd: "17.250000000" } : { max_cost_usd: "17.250000000" });
    expect(requests[0].path).toBe("/openapi.json");
    expect(requests.some((r) => r.path.includes("publish"))).toBe(false);
  });

  it.each([false, true])("refuses unsupported/unreadable capability before refine feedback writes (unreadable=%s)", async (unreadable) => {
    const { client, requests } = await fixture({ advertised: false, unreadable });
    const result = await client.callTool({ name: "aethis_refine", arguments: { project_id: "p", feedback: "Reviewed correction", max_cost_usd: "17.25" } });
    expect(result.isError).toBe(true);
    expect(requests.every((r) => r.method === "GET")).toBe(true);
  });

  it.each([true, false])("gates field-refinement feedback before discovery (advertised=%s)", async (advertised) => {
    const { client, requests } = await fixture({ advertised });
    const result = await client.callTool({ name: "aethis_refine_fields", arguments: { project_id: "p", feedback: "Reviewed correction", max_cost_usd: "1.250000000" } });
    expect(result.isError === true).toBe(!advertised);
    if (advertised) {
      expect(requests[0].path).toBe("/openapi.json");
      expect(requests.find((r) => r.path.endsWith("/fields/discover"))?.body).toEqual({ max_cost_usd: "1.250000000" });
    } else expect(requests.every((r) => r.method === "GET")).toBe(true);
  });

  it("rechecks the target capability immediately before a generation POST", async () => {
    let calls = 0;
    const client = new AethisClient("offline-test-key", "http://127.0.0.1", { fetchFn: async () => {
      calls++;
      return new Response(JSON.stringify({ components: { schemas: { GenerationModeRequest: { properties: calls === 1 ? { max_cost_usd: {} } : {} } } } }));
    } });
    await client.preflightGenerationControls(undefined, false, "1");
    await expect(client.generate("p", undefined, undefined, undefined, undefined, "1")).rejects.toThrow("No generation was started");
    expect(calls).toBe(2);
  });

  it.each(["generate", "discoverFields"] as const)("never repeats capped %s after a connection loss or retryable response", async (operation) => {
    for (const failure of ["connection", "503"] as const) {
      let posts = 0;
      const client = new AethisClient("offline-test-key", "http://127.0.0.1", { retryDelayMs: 0, fetchFn: async (_url, init) => {
        if (init?.method === "GET") return new Response(JSON.stringify({ components: { schemas: {
          GenerationModeRequest: { properties: { max_cost_usd: {} } }, FieldDiscoveryRequest: { properties: { max_cost_usd: {} } },
        } } }));
        posts++;
        if (failure === "connection") throw new Error("simulated lost response after admission");
        return new Response(JSON.stringify({ detail: "simulated unavailable response" }), { status: 503 });
      } });
      const call = operation === "generate"
        ? client.generate("p", undefined, undefined, undefined, undefined, "1")
        : client.discoverFields("p", undefined, "1");
      await expect(call).rejects.toThrow();
      expect(posts).toBe(1);
    }
  });

  it.each(["aethis_generate_and_test", "aethis_refine", "aethis_discover_fields", "aethis_refine_fields"])("sends paid admission exactly once through stdio for %s", async (name) => {
    for (const admissionFailure of ["connection", "503"] as const) {
      for (const cap of [undefined, "1.250000000"]) {
        const { client, requests } = await fixture({ admissionFailure });
        const result = await client.callTool({ name, arguments: { project_id: "p", ...(name === "aethis_refine_fields" ? { feedback: "Reviewed correction" } : {}), ...(cap === undefined ? {} : { max_cost_usd: cap }) } });
        expect(result.isError).toBe(true);
        expect(requests.filter((r) => r.method === "POST" && (r.path.endsWith("/generate") || r.path.endsWith("/fields/discover")))).toHaveLength(1);
      }
    }
  });

  it.each(["0", "0.00", "-1", "+1", "1e1", "NaN", "Infinity", " 19", "19 ", ".5", "01", "1.", "1.0000000001", "1000000.000000001", "9".repeat(65), "١٩", 19, true, null])("rejects invalid budget %s before HTTP", async (budget) => {
    const { client, requests } = await fixture();
    const result = await client.callTool({ name: "aethis_refine", arguments: { project_id: "p", feedback: "Reviewed correction", max_cost_usd: budget } });
    expect(result.isError).toBe(true);
    expect(requests).toEqual([]);
  });

  it.each(["aethis_generate_and_test", "aethis_refine", "aethis_discover_fields"])("keeps omission wire behavior for %s", async (name) => {
    const { client, requests } = await fixture({ advertised: false });
    const result = await client.callTool({ name, arguments: { project_id: "p" } });
    expect(result.isError).not.toBe(true);
    expect(requests.some((r) => r.path === "/openapi.json")).toBe(false);
    expect(requests.find((r) => r.method === "POST")?.body).toEqual(name === "aethis_refine" ? { mode: "refine" } : name === "aethis_discover_fields" ? {} : undefined);
  });

  it("reports native budget exhaustion without starting tests or another generation", async () => {
    const { client, requests } = await fixture({ fail: true });
    const result = await client.callTool({ name: "aethis_generate_and_test", arguments: { project_id: "p", max_cost_usd: "17.250000000" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("generation_spend_budget_exhausted");
    expect(JSON.stringify(result)).toContain("reservation_would_exceed_limit");
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("retains native discovery exhaustion receipts without another request", async () => {
    const { client, requests } = await fixture({ fail: true });
    const result = await client.callTool({ name: "aethis_discover_fields", arguments: { project_id: "p", max_cost_usd: "1.250000000" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("discovery-1");
    expect(JSON.stringify(result)).toContain("reservation_would_exceed_limit");
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("round-trips a complete field pin set and authoritative acceptance suite over stdio", async () => {
    // Optional external fixtures let operators replay reviewed source-derived
    // inputs without copying their domain material into this public package.
    const directory = process.env.AUTHORING_TRANSPORT_FIXTURE_DIR;
    const rawFields: Array<Record<string, unknown>> = directory
      ? parse(readFileSync(join(directory, "fields/fields.yaml"), "utf8")).fields
      : Array.from({ length: 88 }, (_, i) => ({ key: `field_${i}`, type: i < 12 ? "Real" : "Bool", label: `Field ${i}`, weight: 1, elicitation_owner: "caseworker" }));
    const expectedFields = rawFields.map((field) => ({
      key: field.key, sort: field.type ?? field.sort,
      ...Object.fromEntries(["enum_values", "items", "computed", "elicitation_owner", "label", "question", "weight"].filter((key) => Object.hasOwn(field, key)).map((key) => [key, field[key]])),
      ...(field.elicitation_owner !== undefined && field.elicitation_owner !== "applicant" && !Object.hasOwn(field, "question") ? { question: null } : {}),
    }));
    const contract = directory ? JSON.parse(readFileSync(join(directory, "acceptance-contract.json"), "utf8")) : {
      contract_version: 1,
      test_cases: Array.from({ length: 140 }, (_, i) => ({ name: `case_${i}`, field_values: { field_0: i / 10 }, expected_outcome: "undetermined" })),
    };
    const { client, requests } = await fixture();
    const fieldsResult = await client.callTool({ name: "aethis_set_field_spec", arguments: { project_id: "p", expected_fields: expectedFields } });
    expect(fieldsResult.isError, JSON.stringify(fieldsResult)).not.toBe(true);
    const testsResult = await client.callTool({ name: "aethis_set_tests", arguments: { project_id: "p", ...contract } });
    expect(testsResult.isError, JSON.stringify(testsResult)).not.toBe(true);
    expect(requests.find((r) => r.path.endsWith("/fields/spec"))?.body).toEqual({ expected_fields: expectedFields });
    expect(requests.find((r) => r.path.endsWith("/tests"))?.body).toEqual({ ...contract, replace: true });
    expect(expectedFields).toHaveLength(88);
    expect(expectedFields.filter((field) => String(field.sort).toLowerCase() === "real")).toHaveLength(12);
    expect(contract.test_cases).toHaveLength(140);
    console.info(JSON.stringify({ transport: "stdio-jsonrpc-to-local-http", fields: expectedFields.length, real_fields: 12, test_cases: contract.test_cases.length,
      fields_wire_sha256: createHash("sha256").update(JSON.stringify(expectedFields)).digest("hex"),
      contract_wire_sha256: createHash("sha256").update(JSON.stringify(contract)).digest("hex"), provider_calls: 0 }));
  });

  it("refuses unsupported metadata pins before field-spec writes", async () => {
    const { client, requests } = await fixture({ advertised: false });
    const result = await client.callTool({ name: "aethis_set_field_spec", arguments: { project_id: "p", expected_fields: [{ key: "field", sort: "Real", label: "Field", question: null, weight: 2 }] } });
    expect(result.isError).toBe(true);
    expect(requests.every((r) => r.method === "GET")).toBe(true);
  });
});
