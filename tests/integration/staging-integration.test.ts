/**
 * Staging integration lane.
 *
 * Runs the BUILT MCP server as a subprocess with a freshly minted staging key
 * and drives it over the real MCP protocol (`@modelcontextprotocol/sdk` client
 * over stdio): `tools/list` (== 27), a read-only core loop, and `aethis_decide`
 * against a public showcase ruleset. A negative path proves an invalid key
 * yields a STRUCTURED error result and the server stays alive.
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

  it("lists exactly 27 tools over the MCP protocol", async () => {
    const { client, close } = await connectServer(minted!.fullKey);
    try {
      const { tools } = await client.listTools();
      expect(tools.length).toBe(27);
      const names = new Set(tools.map((t) => t.name));
      expect(names.has("aethis_decide")).toBe(true);
      expect(names.has("aethis_discover_rulesets")).toBe(true);
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
      expect(tools.length).toBe(27);
    } finally {
      await close();
    }
  }, 60_000);
});
