import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(".github/workflows/release.yml"), "utf8");
const verifyPublicationJob = workflow.slice(
  workflow.indexOf("\n  verify-publication:"),
  workflow.indexOf("\n  verify-fresh-install:"),
);

describe("release workflow", () => {
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
