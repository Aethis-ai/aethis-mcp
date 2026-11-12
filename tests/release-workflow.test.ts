import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(".github/workflows/release.yml"), "utf8");
const verifyPublicationJob = workflow.slice(
  workflow.indexOf("\n  verify-publication:"),
  workflow.indexOf("\n  verify-fresh-install:"),
);

const publishRegistryJob = workflow.slice(
  workflow.indexOf("\n  publish-registry:"),
  workflow.indexOf("\n  verify-publication:"),
);

describe("release workflow", () => {
  it("waits for npm to serve the exact version before the Registry publish", () => {
    // The Registry looks the version up on npm and refuses with a 400 while npm
    // is still processing the upload (0.24.0 failed this way 25 s after npm
    // accepted it). The wait must come first and must fail if npm never serves it.
    const wait = publishRegistryJob.indexOf(
      'https://registry.npmjs.org/aethis-mcp/${V}',
    );
    const publish = publishRegistryJob.indexOf("./mcp-publisher publish");
    expect(wait).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(-1);
    expect(wait).toBeLessThan(publish);
    expect(publishRegistryJob).toContain(
      'V="${{ needs.build-artefact.outputs.version }}"',
    );
    expect(publishRegistryJob).toContain(
      "::error::npm never served aethis-mcp@$V",
    );
  });

  it("publishes the downloaded tarball through an explicit local path", () => {
    expect(workflow).toContain(
      'run: npm publish "./release-artefacts/${{ needs.build-artefact.outputs.tarball }}" --access public',
    );
    expect(workflow).not.toContain(
      'run: npm publish "release-artefacts/${{ needs.build-artefact.outputs.tarball }}" --access public',
    );
  });

  it("uses the fixture-tested Registry response parser", () => {
    expect(verifyPublicationJob).toContain("actions/checkout@");
    expect(workflow).toContain(
      'node scripts/find-registry-release.mjs "$NAME" "$V"',
    );
    expect(workflow).not.toContain("(j.servers||[]).find");
  });
});
