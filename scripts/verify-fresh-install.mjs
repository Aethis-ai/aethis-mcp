#!/usr/bin/env node
/**
 * Fresh-install verification (aethis-mcp#66 step 7).
 *
 * Drives a freshly-installed aethis-mcp server over the real MCP protocol,
 * enumerates its tools, and compares them against the checked-in generated
 * tool-inventory.json (the same oracle docs P5 consumes). A mismatch — a tool
 * the published package exposes that the inventory doesn't list, or vice versa —
 * fails the release.
 *
 * Usage:
 *   node scripts/verify-fresh-install.mjs <server-entry-js> [inventory-json]
 *
 * <server-entry-js> is the installed server's Node entrypoint (e.g.
 * "$TMP/node_modules/aethis-mcp/dist/index.js"). The MCP SDK is resolved from
 * THIS repo's node_modules. Non-interactive; bounded (30s connect timeout).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverEntry = process.argv[2];
const inventoryPath = process.argv[3] ?? fileURLToPath(new URL("../tool-inventory.json", import.meta.url));

if (!serverEntry) {
  console.error("usage: verify-fresh-install.mjs <server-entry-js> [inventory-json]");
  process.exit(2);
}

const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const expected = new Set(inventory.tools.map((t) => t.name));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  // Minimal env; no key needed for tools/list. Do not leak the parent env.
  env: {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    AETHIS_BASE_URL: "https://api.aethis.ai",
  },
});
const client = new Client({ name: "aethis-mcp-fresh-install-check", version: "0" }, { capabilities: {} });

const timeout = setTimeout(() => {
  console.error("::error::timed out connecting to the installed MCP server");
  process.exit(1);
}, 30_000);

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const got = new Set(tools.map((t) => t.name));

  const missing = [...expected].filter((n) => !got.has(n));
  const extra = [...got].filter((n) => !expected.has(n));

  clearTimeout(timeout);
  await client.close();

  if (missing.length || extra.length) {
    if (missing.length) console.error(`::error::installed server is MISSING tools: ${missing.join(", ")}`);
    if (extra.length) console.error(`::error::installed server has UNEXPECTED tools: ${extra.join(", ")}`);
    process.exit(1);
  }

  console.log(`Fresh install exposes exactly the ${got.size} inventory tools.`);
  process.exit(0);
} catch (err) {
  clearTimeout(timeout);
  console.error(`::error::fresh-install verification failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
