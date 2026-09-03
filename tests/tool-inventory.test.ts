/**
 * tool-inventory.json drift guard (aethis-mcp#66 step 7 + docs P5).
 *
 * tool-inventory.json is a GENERATED artefact (scripts/gen-tool-inventory.mjs)
 * consumed by docs P5 and the release fresh-install verification job. This test
 * recomputes it from source and fails if the checked-in file is stale — so a
 * tool add/remove/rename can never silently diverge from the published surface.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

import { buildToolInventory } from "../src/index.js";

describe("tool-inventory.json drift", () => {
  it("matches the generated inventory (regenerate: node scripts/gen-tool-inventory.mjs)", () => {
    const expected = JSON.stringify(buildToolInventory(), null, 2) + "\n";
    const actual = readFileSync(new URL("../tool-inventory.json", import.meta.url), "utf8");
    expect(actual).toBe(expected);
  });

  it("lists exactly the registered tools with annotations", () => {
    const inv = buildToolInventory();
    expect(inv.tool_count).toBe(inv.tools.length);
    expect(inv.tool_count).toBe(34);
    for (const t of inv.tools) {
      expect(t.name).toMatch(/^aethis_/);
      expect(typeof t.title).toBe("string");
      expect(t.annotations.openWorldHint).toBe(true);
    }
  });
});
