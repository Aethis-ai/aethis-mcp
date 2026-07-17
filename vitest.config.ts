import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // The staging integration lane needs a minted key + network and runs only
    // via `vitest.integration.config.ts`, never in the PR gate. The drift suite
    // (tests/drift.test.ts) stays in the default run: it is network-tolerant on
    // PRs and only hard-fails on real drift.
    exclude: [...configDefaults.exclude, "tests/integration/**"],
  },
});
