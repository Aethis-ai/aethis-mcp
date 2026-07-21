/**
 * Staging integration lane.
 *
 * Runs the BUILT MCP server as a subprocess with a freshly minted staging key
 * and drives it over the real MCP protocol (`@modelcontextprotocol/sdk` client
 * over stdio): `tools/list` (== 30), a read-only core loop, `aethis_decide`
 * (with `include_graph_overlay`) and `aethis_graph` against a public showcase
 * ruleset, and an `aethis_create_rulebook` → `aethis_update_rulebook`
 * `robot_hints` round-trip. A negative path proves an invalid key yields a
 * STRUCTURED error result and the server stays alive.
 *
 * Oracle: the deployed staging engine. Nightly-only; staging only, never
 * production. Missing secrets ⇒ this suite fails loud — it does not skip-green.
 */

import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  mintStagingKey,
  revokeKey,
  sweepStrayKeys,
  discoverShowcaseSlug,
  integrationSecretsPresent,
  STAGING_API,
  type MintedKey,
} from "./mint.js";

const SERVER_ENTRY = fileURLToPath(new URL("../../dist/index.js", import.meta.url));

interface ToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

function textOf(result: ToolResult): string {
  return (result.content ?? [])
    .map((c) => c.text ?? "")
    .join("\n");
}

async function connectServer(apiKey: string): Promise<{ client: Client; close: () => Promise<void> }> {
  // Explicit minimal env — do NOT spread process.env, which would leak the
  // Clerk mint secret (and everything else) into the server subprocess. Pass
  // only what the server + Node need: the two AETHIS vars, plus PATH/HOME.
  const env: Record<string, string> = {
    AETHIS_API_KEY: apiKey,
    AETHIS_BASE_URL: STAGING_API,
  };
  if (process.env.PATH) env.PATH = process.env.PATH;
  if (process.env.HOME) env.HOME = process.env.HOME;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env,
  });
  const client = new Client({ name: "aethis-mcp-integration", version: "0" }, { capabilities: {} });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

describe("staging integration lane", () => {
  let minted: MintedKey | null = null;
  let jwt = "";
  let slug = "";

  beforeAll(async () => {
    if (!integrationSecretsPresent()) {
      throw new Error(
        "Integration lane requires CLERK_SECRET_KEY_DEV_TOOLS + CLERK_E2E_DX_USER_ID. " +
          "Absent secrets fail loud, never skip-green.",
      );
    }
    if (!existsSync(SERVER_ENTRY)) {
      throw new Error(`Built server not found at ${SERVER_ENTRY} — run 'npm run build' first.`);
    }
    const result = await mintStagingKey();
    minted = result.key;
    jwt = result.jwt;
    slug = await discoverShowcaseSlug();
  }, 90_000);

  afterAll(async () => {
    if (jwt && minted) {
      await revokeKey(jwt, minted.keyId);
      const swept = await sweepStrayKeys(jwt, minted.keyId);
      if (swept > 0) console.info(`[integration] swept ${swept} stray e2e-dx-mcp-* key(s)`);
    }
  }, 60_000);

  it("lists exactly 32 tools over the MCP protocol", async () => {
    const { client, close } = await connectServer(minted!.fullKey);
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBe(32);
      const names = new Set(tools.map((t) => t.name));
      expect(names.has("aethis_decide")).toBe(true);
      expect(names.has("aethis_discover_rulesets")).toBe(true);
      expect(names.has("aethis_graph")).toBe(true);
      expect(names.has("aethis_create_rulebook")).toBe(true);
      expect(names.has("aethis_update_rulebook")).toBe(true);
    } finally {
      await close();
    }
  }, 60_000);

  it("drives the read-only core loop with a minted key", async () => {
    const { client, close } = await connectServer(minted!.fullKey);
    try {
      // list_projects — a fresh tenant may have none; must not error.
      const projects = (await client.callTool({ name: "aethis_list_projects", arguments: {} })) as ToolResult;
      expect(projects.isError ?? false).toBe(false);

      // discover_rulesets — anonymous public catalogue; must return content.
      const discover = (await client.callTool({
        name: "aethis_discover_rulesets",
        arguments: { limit: 10 },
      })) as ToolResult;
      expect(discover.isError ?? false).toBe(false);
      expect(textOf(discover).length).toBeGreaterThan(0);

      // list_rulesets — tenant-scoped; a fresh tenant returns a structured,
      // non-crashing response even for an unknown project id.
      const rulesets = (await client.callTool({
        name: "aethis_list_rulesets",
        arguments: { project_id: "prj_integration_probe" },
      })) as ToolResult;
      expect(Array.isArray(rulesets.content)).toBe(true);

      // schema — the showcase ruleset's input fields.
      const schema = (await client.callTool({
        name: "aethis_schema",
        arguments: { ruleset_id: slug },
      })) as ToolResult;
      expect(schema.isError ?? false).toBe(false);
      expect(textOf(schema).length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  }, 60_000);

  it("decides against a public showcase ruleset over MCP", async () => {
    const { client, close } = await connectServer(minted!.fullKey);
    try {
      const decide = (await client.callTool({
        name: "aethis_decide",
        arguments: { ruleset_id: slug, field_values: {} },
      })) as ToolResult;
      // Empty field_values against a real ruleset yields a real decision
      // (typically undetermined) — the point is a non-errored engine round-trip.
      expect(decide.isError ?? false).toBe(false);
      const text = textOf(decide).toLowerCase();
      expect(/eligible|undetermined|decision/.test(text)).toBe(true);
    } finally {
      await close();
    }
  }, 60_000);

  it("decides with include_graph_overlay and gets graph_overlay back", async () => {
    const { client, close } = await connectServer(minted!.fullKey);
    try {
      const decide = (await client.callTool({
        name: "aethis_decide",
        arguments: { ruleset_id: slug, field_values: {}, include_graph_overlay: true },
      })) as ToolResult;
      expect(decide.isError ?? false).toBe(false);
      const data = JSON.parse(textOf(decide));
      // Additive response field (aethis-core#212) — present (though its
      // content may be null/empty depending on the ruleset) whenever the
      // flag round-trips through the MCP tool to the engine.
      expect("graph_overlay" in data).toBe(true);
    } finally {
      await close();
    }
  }, 60_000);

  it("fetches the ruleset-map graph for a public showcase ruleset over MCP", async () => {
    const { client, close } = await connectServer(minted!.fullKey);
    try {
      const graph = (await client.callTool({
        name: "aethis_graph",
        arguments: { ruleset_id: slug },
      })) as ToolResult;
      expect(graph.isError ?? false).toBe(false);
      const data = JSON.parse(textOf(graph));
      expect(data.ruleset_id).toBeTruthy();
      expect(Array.isArray(data.graph?.nodes)).toBe(true);
      expect(typeof data.mermaid).toBe("string");
      expect(data.mermaid.length).toBeGreaterThan(0);
    } finally {
      await close();
    }
  }, 60_000);

  it("creates a rulebook with robot_hints, then updates them, over MCP", async () => {
    const { client, close } = await connectServer(minted!.fullKey);
    let rulebookId: string | null = null;
    try {
      const created = (await client.callTool({
        name: "aethis_create_rulebook",
        arguments: {
          name: `mcp-integration-probe-${Date.now()}`,
          domain: "mcp_integration_probe",
          robot_hints: { preamble: "Greet the applicant and explain what you'll cover." },
        },
      })) as ToolResult;
      expect(created.isError ?? false).toBe(false);
      const createdText = textOf(created);
      const rulebookIdMatch = createdText.match(/Rulebook ID:\s*(\S+)/);
      expect(rulebookIdMatch).not.toBeNull();
      rulebookId = rulebookIdMatch![1];

      const updated = (await client.callTool({
        name: "aethis_update_rulebook",
        arguments: {
          rulebook_id: rulebookId,
          robot_hints: { stuck: "If an answer is unclear, ask one focused follow-up question." },
        },
      })) as ToolResult;
      expect(updated.isError ?? false).toBe(false);
      expect(textOf(updated)).toContain("updated");

      // An unknown beat is rejected client-side before the round-trip.
      const rejected = (await client.callTool({
        name: "aethis_update_rulebook",
        arguments: { rulebook_id: rulebookId, robot_hints: { not_a_real_beat: "x" } },
      })) as ToolResult;
      expect(rejected.isError).toBe(true);
      expect(textOf(rejected)).toMatch(/unknown beat/i);
    } finally {
      await close();
      // Archive the probe rulebook so nightly runs don't accumulate test
      // fixtures on the shared e2e-dx tenant. No MCP tool wraps /archive
      // for rulebooks yet (out of scope for this issue), so call the engine
      // directly with the same minted key. Best-effort: never fails the test.
      if (rulebookId) {
        try {
          await fetch(`${STAGING_API}/api/v1/public/rulebooks/${encodeURIComponent(rulebookId)}/archive`, {
            method: "POST",
            headers: { "X-API-Key": minted!.fullKey },
            signal: AbortSignal.timeout(30_000),
          });
        } catch {
          // best-effort cleanup
        }
      }
    }
  }, 60_000);

  it("returns a structured error for an invalid key and stays alive", async () => {
    const { client, close } = await connectServer("aeth_invalid_integration_probe_key");
    try {
      const result = (await client.callTool({
        name: "aethis_list_projects",
        arguments: {},
      })) as ToolResult;
      // A rejected key must surface as a structured MCP error result, not a
      // thrown crash of the subprocess.
      expect(result.isError).toBe(true);
      expect(textOf(result).length).toBeGreaterThan(0);

      // The server is still alive and serves the next request.
      const { tools } = await client.listTools();
      expect(tools.length).toBe(32);
    } finally {
      await close();
    }
  }, 60_000);
});
