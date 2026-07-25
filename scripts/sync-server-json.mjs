#!/usr/bin/env node
/**
 * Keep server.json (the official MCP Registry record) in lock-step with
 * package.json (the version source of truth). aethis-mcp#66 / #45.
 *
 * The Registry publishes the identity in server.json; npm publishes the identity
 * in package.json. If they disagree, a published server points at a package
 * version that may not exist. This script derives the drift-prone fields of
 * server.json from package.json:
 *
 *   server.json name                 <- package.json mcpName
 *   server.json version              <- package.json version
 *   server.json packages[].identifier<- package.json name  (npm packages only)
 *   server.json packages[].version   <- package.json version (npm packages only)
 *
 * The curated registry description / env-var docs are NOT touched.
 *
 * Usage:
 *   node scripts/sync-server-json.mjs --check    # exit 1 on drift (CI)
 *   node scripts/sync-server-json.mjs --write    # fix server.json in place
 *
 * Non-interactive; no network; bounded. Never prompts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const serverPath = join(root, "server.json");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const raw = readFileSync(serverPath, "utf8");
const server = JSON.parse(raw);

if (!pkg.mcpName) {
  console.error("package.json is missing `mcpName` — cannot derive server.json name.");
  process.exit(2);
}

/** Compute the drift-corrected server.json (pure; does not write). */
function corrected(src) {
  const out = structuredClone(src);
  out.name = pkg.mcpName;
  out.version = pkg.version;
  out.packages = (out.packages ?? []).map((p) =>
    p.registryType === "npm"
      ? { ...p, identifier: pkg.name, version: pkg.version }
      : p,
  );
  return out;
}

/** Ordered list of concrete field drifts, for a readable report. */
function drifts(src, want) {
  const problems = [];
  if (src.name !== want.name) problems.push(`name: ${src.name} -> ${want.name}`);
  if (src.version !== want.version) problems.push(`version: ${src.version} -> ${want.version}`);
  const sp = src.packages ?? [];
  const wp = want.packages ?? [];
  for (let i = 0; i < wp.length; i++) {
    if (wp[i].registryType !== "npm") continue;
    if ((sp[i] ?? {}).identifier !== wp[i].identifier) {
      problems.push(`packages[${i}].identifier: ${(sp[i] ?? {}).identifier} -> ${wp[i].identifier}`);
    }
    if ((sp[i] ?? {}).version !== wp[i].version) {
      problems.push(`packages[${i}].version: ${(sp[i] ?? {}).version} -> ${wp[i].version}`);
    }
  }
  return problems;
}

const want = corrected(server);
const problems = drifts(server, want);
const mode = process.argv.includes("--write") ? "write" : "check";

if (mode === "check") {
  if (problems.length) {
    console.error("server.json is out of sync with package.json:");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("\nFix: node scripts/sync-server-json.mjs --write");
    process.exit(1);
  }
  console.log(`server.json in sync with package.json (${pkg.name}@${pkg.version}).`);
  process.exit(0);
}

// write mode
if (!problems.length) {
  console.log("server.json already in sync; nothing to write.");
  process.exit(0);
}
// Preserve trailing newline style of the original file.
const trailing = raw.endsWith("\n") ? "\n" : "";
writeFileSync(serverPath, JSON.stringify(want, null, 2) + trailing);
console.log("server.json updated:");
for (const p of problems) console.log(`  - ${p}`);
