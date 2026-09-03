import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(".github/workflows/release.yml"), "utf8");

describe("release workflow", () => {
  it("publishes the downloaded tarball through an explicit local path", () => {
    expect(workflow).toContain(
      'run: npm publish "./release-artefacts/${{ needs.build-artefact.outputs.tarball }}" --access public',
    );
    expect(workflow).not.toContain(
      'run: npm publish "release-artefacts/${{ needs.build-artefact.outputs.tarball }}" --access public',
    );
  });
});
