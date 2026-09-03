/**
 * server.json <-> package.json parity (aethis-mcp#66 step 2).
 *
 * The official MCP Registry record (server.json) must never drift from the npm
 * version source of truth (package.json). This runs the same `--check` the CI
 * lane runs, so editing package.json's version without regenerating server.json
 * fails the PR gate.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = fileURLToPath(new URL("../scripts/sync-server-json.mjs", import.meta.url));

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"));
}

describe("server.json / package.json parity", () => {
  it("`sync-server-json.mjs --check` passes (no drift)", () => {
    // Throws (non-zero exit) on drift; that is the failure signal.
    const out = execFileSync("node", [script, "--check"], { cwd: root, encoding: "utf8", timeout: 15_000 });
    expect(out).toMatch(/in sync/);
  });

  it("server.json identity is derived from package.json", () => {
    const pkg = readJson("package.json");
    const server = readJson("server.json");
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    const npmPkg = (server.packages as Array<Record<string, unknown>>).find((p) => p.registryType === "npm");
    expect(npmPkg?.identifier).toBe(pkg.name);
    expect(npmPkg?.version).toBe(pkg.version);
  });

  it("keeps the public description within the MCP Registry limit", () => {
    const server = readJson("server.json");
    expect(typeof server.description).toBe("string");
    expect((server.description as string).length).toBeGreaterThan(0);
    expect((server.description as string).length).toBeLessThanOrEqual(100);
  });
});
