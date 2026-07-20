import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isNewer,
  shouldSkipUpdateCheck,
  formatUpdateNudge,
  fetchLatestNpmVersion,
  checkForUpdate,
} from "../src/version-check.js";

// ---------------------------------------------------------------------------
// Helpers (mirrors tests/client.test.ts's minimal mock Response)
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// isNewer — the deterministic oracle
// ---------------------------------------------------------------------------

describe("isNewer", () => {
  it("is true when latest has a higher patch version", () => {
    expect(isNewer("0.14.0", "0.13.0")).toBe(true);
  });

  it("is true when latest has a higher minor or major version", () => {
    expect(isNewer("0.14.0", "0.13.9")).toBe(true);
    expect(isNewer("1.0.0", "0.99.99")).toBe(true);
  });

  it("is false when versions are equal", () => {
    expect(isNewer("0.13.0", "0.13.0")).toBe(false);
  });

  it("is false when latest is older than current", () => {
    expect(isNewer("0.12.0", "0.13.0")).toBe(false);
  });

  it("is false on empty inputs", () => {
    expect(isNewer("", "0.13.0")).toBe(false);
    expect(isNewer("0.14.0", "")).toBe(false);
  });

  it("does not crash on malformed version strings", () => {
    expect(isNewer("not-a-version", "0.13.0")).toBe(false);
    expect(isNewer("0.14.0", "not-a-version")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// shouldSkipUpdateCheck
// ---------------------------------------------------------------------------

describe("shouldSkipUpdateCheck", () => {
  it("skips when AETHIS_DISABLE_UPDATE_CHECK is set", () => {
    expect(shouldSkipUpdateCheck({ AETHIS_DISABLE_UPDATE_CHECK: "1" })).toBe(true);
  });

  it("skips in CI", () => {
    expect(shouldSkipUpdateCheck({ CI: "true" })).toBe(true);
  });

  it("does not skip with a clean env", () => {
    expect(shouldSkipUpdateCheck({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatUpdateNudge
// ---------------------------------------------------------------------------

describe("formatUpdateNudge", () => {
  it("is a single line and includes the Releases page as the changelog pointer", () => {
    const msg = formatUpdateNudge("0.13.0", "0.14.0");
    expect(msg.includes("\n")).toBe(false);
    expect(msg).toContain("0.13.0");
    expect(msg).toContain("0.14.0");
    expect(msg).toContain("https://github.com/Aethis-ai/aethis-mcp/releases");
  });
});

// ---------------------------------------------------------------------------
// fetchLatestNpmVersion — fail-silent contract
// ---------------------------------------------------------------------------

describe("fetchLatestNpmVersion", () => {
  it("returns the version string on a 200 response", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ version: "0.14.0" }));
    await expect(fetchLatestNpmVersion(mockFetch as unknown as typeof fetch)).resolves.toBe(
      "0.14.0",
    );
  });

  it("returns null on a non-200 response, never throws", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    await expect(
      fetchLatestNpmVersion(mockFetch as unknown as typeof fetch),
    ).resolves.toBeNull();
  });

  it("returns null when fetch itself rejects (network error/timeout), never throws", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(
      fetchLatestNpmVersion(mockFetch as unknown as typeof fetch),
    ).resolves.toBeNull();
  });

  it("returns null on a malformed body (missing/non-string version)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ version: 123 }));
    await expect(
      fetchLatestNpmVersion(mockFetch as unknown as typeof fetch),
    ).resolves.toBeNull();
  });

  it("returns null when the response body isn't valid JSON", async () => {
    const badJson = {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response;
    const mockFetch = vi.fn().mockResolvedValue(badJson);
    await expect(
      fetchLatestNpmVersion(mockFetch as unknown as typeof fetch),
    ).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate — the end-to-end fail-silent + opt-out contract
// ---------------------------------------------------------------------------

describe("checkForUpdate", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.AETHIS_DISABLE_UPDATE_CHECK;
    delete process.env.CI;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns a nudge string when a newer version is on npm", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ version: "0.14.0" }));
    const nudge = await checkForUpdate("0.13.0", {}, mockFetch as unknown as typeof fetch);
    expect(nudge).toContain("0.13.0");
    expect(nudge).toContain("0.14.0");
  });

  it("returns null when already on the latest version", async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ version: "0.13.0" }));
    const nudge = await checkForUpdate("0.13.0", {}, mockFetch as unknown as typeof fetch);
    expect(nudge).toBeNull();
  });

  it("returns null and never throws when the registry call fails", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(
      checkForUpdate("0.13.0", {}, mockFetch as unknown as typeof fetch),
    ).resolves.toBeNull();
  });

  it("honours AETHIS_DISABLE_UPDATE_CHECK by skipping the network call entirely", async () => {
    const mockFetch = vi.fn();
    const nudge = await checkForUpdate(
      "0.13.0",
      { AETHIS_DISABLE_UPDATE_CHECK: "1" },
      mockFetch as unknown as typeof fetch,
    );
    expect(nudge).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips in CI", async () => {
    const mockFetch = vi.fn();
    const nudge = await checkForUpdate("0.13.0", { CI: "true" }, mockFetch as unknown as typeof fetch);
    expect(nudge).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
