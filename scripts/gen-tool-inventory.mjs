#!/usr/bin/env node
/**
 * Regenerate tool-inventory.json — the canonical, generated list of the MCP tool
 * surface (aethis-mcp#66 step 7 + docs P5). Derived from the built server via
 * buildToolInventory(); never hand-edited.
 *
 * Requires a prior `npm run build` (imports dist/index.js). Non-interactive.
 *
 * Usage:
 *   node scripts/gen-tool-inventory.mjs           # write tool-inventory.json
 *   node scripts/gen-tool-inventory.mjs --check   # exit 1 if it would change
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distEntry = join(root, "dist", "index.js");
const outPath = join(root, "tool-inventory.json");

if (!existsSync(distEntry)) {
  console.error(`Built server not found at ${distEntry} — run 'npm run build' first.`);
  process.exit(2);
}

const { buildToolInventory } = await import(distEntry);
const inventory = buildToolInventory();
const serialized = JSON.stringify(inventory, null, 2) + "\n";

const check = process.argv.includes("--check");
const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";

if (check) {
  if (current !== serialized) {
    console.error("tool-inventory.json is stale — regenerate: node scripts/gen-tool-inventory.mjs");
    process.exit(1);
  }
  console.log(`tool-inventory.json up to date (${inventory.tool_count} tools).`);
  process.exit(0);
}

writeFileSync(outPath, serialized);
console.log(`Wrote tool-inventory.json (${inventory.tool_count} tools).`);
