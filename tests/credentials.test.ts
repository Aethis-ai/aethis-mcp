import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node:child_process — execFile is callback-style
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

// Mock node:fs/promises
const mockReadFile = vi.fn();
vi.mock("node:fs/promises", () => ({
  readFile: mockReadFile,
}));

// Import after mocks are in place
const { resolveApiKey } = await import("../src/credentials.js");

describe("resolveApiKey", () => {
  const originalEnv = { ...process.env };
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.AETHIS_API_KEY;
    delete process.env.XDG_CONFIG_HOME;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("returns env var when AETHIS_API_KEY is set", async () => {
    process.env.AETHIS_API_KEY = "ak_from_env";
    const key = await resolveApiKey();
    expect(key).toBe("ak_from_env");
    expect(mockExecFile).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("ignores whitespace-only env var and falls to file", async () => {
    process.env.AETHIS_API_KEY = "   ";
    Object.defineProperty(process, "platform", { value: "linux" });
    mockReadFile.mockResolvedValueOnce("api_key: ak_from_file\n");
    const key = await resolveApiKey();
    expect(key).toBe("ak_from_file");
  });

  it("reads from keychain on macOS", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string) => void) => {
        cb(null, "ak_from_keychain\n");
      },
    );
    const key = await resolveApiKey();
    expect(key).toBe("ak_from_keychain");
    expect(mockExecFile).toHaveBeenCalledWith(
      "security",
      ["find-generic-password", "-s", "aethis-cli", "-a", "api_key", "-w"],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
  });

  it("falls through to credentials file on keychain failure", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
        cb(new Error("not found"));
      },
    );
    mockReadFile.mockResolvedValueOnce("api_key: ak_from_file\n");
    const key = await resolveApiKey();
    expect(key).toBe("ak_from_file");
  });

  it("parses credentials file with whitespace and comments", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockReadFile.mockResolvedValueOnce("# credentials\napi_key:   ak_live_test123  \n");
    const key = await resolveApiKey();
    expect(key).toBe("ak_live_test123");
  });

  it("skips keychain on non-macOS", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockReadFile.mockResolvedValueOnce("api_key: ak_linux\n");
    const key = await resolveApiKey();
    expect(key).toBe("ak_linux");
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("throws with helpful message when no key found", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    await expect(resolveApiKey()).rejects.toThrow(/aethis login/i);
  });

  it("uses XDG_CONFIG_HOME when set", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.XDG_CONFIG_HOME = "/custom/config";
    mockReadFile.mockResolvedValueOnce("api_key: ak_xdg\n");
    const key = await resolveApiKey();
    expect(key).toBe("ak_xdg");
    expect(mockReadFile).toHaveBeenCalledWith(
      "/custom/config/aethis/credentials",
      "utf-8",
    );
  });
});
