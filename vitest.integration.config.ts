import { defineConfig } from "vitest/config";

// The staging integration lane (nightly only). Runs the BUILT server as a
// subprocess against deployed staging with a freshly minted key. Kept out of
// the default `npm test` PR gate; invoked via `npm run test:integration`.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // A minted key is shared across cases; run the file's cases in order in one
    // worker so setup/teardown mint exactly one key.
    fileParallelism: false,
  },
});
