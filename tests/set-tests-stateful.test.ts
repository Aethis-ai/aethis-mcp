import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";

import { AethisClient } from "../src/client.js";

type TestCase = { name: string; field_values: Record<string, unknown>; expected_outcome: string };

describe("aethis_set_tests replacement contract", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => { await close?.(); close = undefined; });

  it("creates once, discovers fields, then replaces twice without changing project source, fields, or guidance", async () => {
    const project = {
      id: "p_1",
      sources: [{ name: "policy.md", content: "Reviewed source" }],
      fields: [{ key: "applicant.age", field_type: "integer" }],
      guidance: [{ guidance_text: "Keep the statutory boundary" }],
      tests: [{ name: "old", field_values: {}, expected_outcome: "undetermined" }] as TestCase[],
    };
    let creates = 0;
    let writes = 0;
    const server = createServer(async (req, res) => {
      const body = await new Promise<string>((resolve) => {
        let raw = "";
        req.on("data", (chunk) => { raw += chunk; });
        req.on("end", () => resolve(raw));
      });
      const send = (status: number, value: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (req.method === "GET" && req.url === "/openapi.json") {
        send(200, { components: { schemas: { AddTestCaseRequest: { properties: { replace: { type: "boolean" } } } } } });
      } else if (req.method === "POST" && req.url === "/api/v1/public/projects/") {
        creates += 1;
        send(200, { project_id: project.id });
      } else if (req.method === "POST" && req.url === `/api/v1/public/projects/${project.id}/fields/discover`) {
        send(200, { project_id: project.id, fields: project.fields });
      } else if (req.method === "POST" && req.url === `/api/v1/public/projects/${project.id}/tests`) {
        const payload = JSON.parse(body) as { replace?: boolean; test_cases?: TestCase[] };
        expect(payload.replace).toBe(true);
        const replaced = project.tests.length;
        project.tests = payload.test_cases ?? [];
        writes += 1;
        send(200, { added: project.tests.length, replaced });
      } else {
        send(404, { detail: "unknown route" });
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    close = async () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
    const client = new AethisClient("ak_test", `http://127.0.0.1:${address.port}`, { retryDelayMs: 0 });

    await client.createProject("Test project", "test_section");
    await client.discoverFields(project.id);
    const reviewed: TestCase[] = [
      { name: "adult", field_values: { "applicant.age": 30 }, expected_outcome: "eligible" },
      { name: "child", field_values: { "applicant.age": 10 }, expected_outcome: "not_eligible" },
    ];
    await client.replaceTests(project.id, reviewed);
    await client.replaceTests(project.id, reviewed);

    expect(creates).toBe(1);
    expect(writes).toBe(2);
    expect(project.sources).toEqual([{ name: "policy.md", content: "Reviewed source" }]);
    expect(project.fields).toEqual([{ key: "applicant.age", field_type: "integer" }]);
    expect(project.guidance).toEqual([{ guidance_text: "Keep the statutory boundary" }]);
    expect(project.tests).toEqual(reviewed);
  });
});
