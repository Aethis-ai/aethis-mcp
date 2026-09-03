import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const parser = fileURLToPath(new URL("../scripts/find-registry-release.mjs", import.meta.url));
const fixture = readFileSync(
  fileURLToPath(new URL("./fixtures/mcp-registry-search-response.json", import.meta.url)),
  "utf8",
);

function findRelease(name: string, version: string, input = fixture): string {
  return execFileSync("node", [parser, name, version], {
    input,
    encoding: "utf8",
    timeout: 15_000,
  });
}

describe("official MCP Registry response parsing", () => {
  it("finds an exact release inside the entry.server envelope", () => {
    expect(findRelease("io.github.Aethis-ai/aethis-mcp", "0.17.3")).toBe("yes");
  });

  it("does not mistake the outer entry for the server record", () => {
    const topLevelFixture = JSON.stringify({
      servers: [{ name: "io.github.Aethis-ai/aethis-mcp", version: "0.17.3" }],
    });
    expect(findRelease("io.github.Aethis-ai/aethis-mcp", "0.17.3", topLevelFixture)).toBe("");
  });

  it("requires both exact name and exact version", () => {
    expect(findRelease("io.github.aethis-ai/aethis-mcp", "0.17.3")).toBe("");
    expect(findRelease("io.github.Aethis-ai/aethis-mcp", "0.17.4")).toBe("");
  });

  it("treats malformed transient responses as retryable misses", () => {
    expect(findRelease("io.github.Aethis-ai/aethis-mcp", "0.17.3", "upstream unavailable")).toBe("");
  });
});
