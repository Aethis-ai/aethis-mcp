import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, chmod, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mock-based tests for the env-var / keychain fallback chain
// ---------------------------------------------------------------------------

const { mockExecFile, mockReadFile, mockRealpath, mockStat } = vi.hoisted(
  () => ({
    mockExecFile: vi.fn(),
    mockReadFile: vi.fn(),
    mockRealpath: vi.fn(),
    mockStat: vi.fn(),
  }),
);

vi.mock("node:child_process", () => ({
  execFile: mockExecFile,
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>(
    "node:fs/promises",
  );
  return {
    ...actual,
    readFile: mockReadFile,
    realpath: mockRealpath,
    stat: mockStat,
  };
});

const {
  resolveApiKey,
  resolveLlmKey,
  MissingLlmKeyError,
  UnsafeCredentialsError,
} = await import("../src/credentials.js");

describe("resolveApiKey (fallback chain)", () => {
  const originalEnv = { ...process.env };
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.AETHIS_API_KEY;
    delete process.env.XDG_CONFIG_HOME;
    // Default: pretend the credentials file is absent so tests have to
    // opt in to file resolution.
    mockRealpath.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
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
    mockRealpath.mockResolvedValueOnce(join(homedir(), ".config/aethis/credentials"));
    mockStat.mockResolvedValueOnce({ mode: 0o100600 });
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
    mockRealpath.mockResolvedValueOnce(join(homedir(), ".config/aethis/credentials"));
    mockStat.mockResolvedValueOnce({ mode: 0o100600 });
    mockReadFile.mockResolvedValueOnce("api_key: ak_from_file\n");
    const key = await resolveApiKey();
    expect(key).toBe("ak_from_file");
  });

  it("parses credentials file with whitespace and comments", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockRealpath.mockResolvedValueOnce(join(homedir(), ".config/aethis/credentials"));
    mockStat.mockResolvedValueOnce({ mode: 0o100600 });
    mockReadFile.mockResolvedValueOnce("# credentials\napi_key:   ak_live_test123  \n");
    const key = await resolveApiKey();
    expect(key).toBe("ak_live_test123");
  });

  it("skips keychain on non-macOS", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockRealpath.mockResolvedValueOnce(join(homedir(), ".config/aethis/credentials"));
    mockStat.mockResolvedValueOnce({ mode: 0o100600 });
    mockReadFile.mockResolvedValueOnce("api_key: ak_linux\n");
    const key = await resolveApiKey();
    expect(key).toBe("ak_linux");
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("throws with helpful message when no key found anywhere", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    await expect(resolveApiKey()).rejects.toThrow(/aethis login/i);
  });

  it("uses XDG_CONFIG_HOME when set to an absolute path", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.XDG_CONFIG_HOME = "/custom/config";
    mockRealpath.mockResolvedValueOnce("/custom/config/aethis/credentials");
    mockStat.mockResolvedValueOnce({ mode: 0o100600 });
    mockReadFile.mockResolvedValueOnce("api_key: ak_xdg\n");
    const key = await resolveApiKey();
    expect(key).toBe("ak_xdg");
    expect(mockReadFile).toHaveBeenCalledWith(
      "/custom/config/aethis/credentials",
      "utf-8",
    );
  });
});

// ---------------------------------------------------------------------------
// Real-filesystem tests for the safety checks (#33)
// Wire the mocks straight through to the real fs implementation so the
// realpath / stat code paths exercise actual symlinks and permission bits.
// ---------------------------------------------------------------------------

describe("resolveApiKey safety checks (#33)", () => {
  const originalEnv = { ...process.env };
  const originalPlatform = process.platform;
  let tmpRoot: string;

  beforeEach(async () => {
    vi.resetAllMocks();
    delete process.env.AETHIS_API_KEY;
    const real = await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
    mockReadFile.mockImplementation((path: string, encoding: BufferEncoding) =>
      real.readFile(path, encoding),
    );
    mockRealpath.mockImplementation((path: string) => real.realpath(path));
    mockStat.mockImplementation((path: string) => real.stat(path));
    Object.defineProperty(process, "platform", { value: "linux" }); // skip keychain
    tmpRoot = await mkdtemp(join(tmpdir(), "aethis-mcp-creds-"));
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    Object.defineProperty(process, "platform", { value: originalPlatform });
    await rm(tmpRoot, { recursive: true, force: true });
  });

  async function plantCredentials(mode: number): Promise<string> {
    const aethisDir = join(tmpRoot, "aethis");
    await mkdir(aethisDir, { recursive: true });
    const credsPath = join(aethisDir, "credentials");
    await writeFile(credsPath, "api_key: ak_good\n");
    await chmod(credsPath, mode);
    return credsPath;
  }

  it("loads the key when the file is 0600 (happy path)", async () => {
    process.env.XDG_CONFIG_HOME = tmpRoot;
    await plantCredentials(0o600);
    const key = await resolveApiKey();
    expect(key).toBe("ak_good");
  });

  it("refuses a world-readable file (0644)", async () => {
    process.env.XDG_CONFIG_HOME = tmpRoot;
    await plantCredentials(0o644);
    await expect(resolveApiKey()).rejects.toBeInstanceOf(UnsafeCredentialsError);
    await expect(resolveApiKey()).rejects.toThrow(/too open/);
    await expect(resolveApiKey()).rejects.toThrow(/chmod 600/);
  });

  it("refuses a group-readable file (0640)", async () => {
    process.env.XDG_CONFIG_HOME = tmpRoot;
    await plantCredentials(0o640);
    await expect(resolveApiKey()).rejects.toBeInstanceOf(UnsafeCredentialsError);
    await expect(resolveApiKey()).rejects.toThrow(/0640/);
  });

  it("refuses a symlink that points outside the home/XDG root", async () => {
    const evilRoot = await mkdtemp(join(tmpdir(), "aethis-mcp-evil-"));
    const evilPath = join(evilRoot, "stolen-credentials");
    await writeFile(evilPath, "api_key: ak_evil\n");
    await chmod(evilPath, 0o600);

    const xdgRoot = await mkdtemp(join(tmpdir(), "aethis-mcp-xdg-"));
    process.env.XDG_CONFIG_HOME = xdgRoot;
    const aethisDir = join(xdgRoot, "aethis");
    await mkdir(aethisDir, { recursive: true });
    await symlink(evilPath, join(aethisDir, "credentials"));

    try {
      await expect(resolveApiKey()).rejects.toBeInstanceOf(UnsafeCredentialsError);
      await expect(resolveApiKey()).rejects.toThrow(/outside your home directory/);
    } finally {
      await rm(evilRoot, { recursive: true, force: true });
      await rm(xdgRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// resolveLlmKey (#35) — per-call LLM key resolution
// ---------------------------------------------------------------------------

describe("resolveLlmKey", () => {
  const originalEnv = { ...process.env };
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
    // Ensure no ANTHROPIC_API_KEY leaks from the host environment into
    // assertions that expect the env-var path to be absent.
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.LLM_KEY_VIA_ENV;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("resolves from anthropic_key_env when the named var is set", async () => {
    process.env.LLM_KEY_VIA_ENV = "ak_from_env";
    const key = await resolveLlmKey({ anthropic_key_env: "LLM_KEY_VIA_ENV" });
    expect(key).toBe("ak_from_env");
    // No keychain or raw-key lookup happened.
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("ignores empty env var and falls back to raw anthropic_key", async () => {
    process.env.LLM_KEY_VIA_ENV = "";
    const key = await resolveLlmKey({
      anthropic_key_env: "LLM_KEY_VIA_ENV",
      anthropic_key: "ak_raw_fallback",
    });
    expect(key).toBe("ak_raw_fallback");
  });

  it("resolves from anthropic_key_keychain on macOS", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: null, stdout: string) => void,
      ) => {
        expect(args).toEqual([
          "find-generic-password",
          "-s",
          "aethis-anthropic-key",
          "-a",
          "my-anthropic",
          "-w",
        ]);
        cb(null, "ak_from_keychain\n");
      },
    );
    const key = await resolveLlmKey({ anthropic_key_keychain: "my-anthropic" });
    expect(key).toBe("ak_from_keychain");
  });

  it("supports explicit service:account form for keychain", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _opts: unknown,
        cb: (err: null, stdout: string) => void,
      ) => {
        expect(args).toEqual([
          "find-generic-password",
          "-s",
          "my-service",
          "-a",
          "my-account",
          "-w",
        ]);
        cb(null, "ak_explicit\n");
      },
    );
    const key = await resolveLlmKey({
      anthropic_key_keychain: "my-service:my-account",
    });
    expect(key).toBe("ak_explicit");
  });

  it("falls back to raw anthropic_key when keychain lookup fails", async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
        cb(new Error("not in keychain"));
      },
    );
    const key = await resolveLlmKey({
      anthropic_key_keychain: "missing",
      anthropic_key: "ak_raw_after_keychain_miss",
    });
    expect(key).toBe("ak_raw_after_keychain_miss");
  });

  it("falls back to deprecated openai_key when no other source provides one", async () => {
    const key = await resolveLlmKey({ openai_key: "sk-deprecated" });
    expect(key).toBe("sk-deprecated");
  });

  it("throws MissingLlmKeyError when every source is empty", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    await expect(resolveLlmKey({})).rejects.toBeInstanceOf(MissingLlmKeyError);
    await expect(resolveLlmKey({})).rejects.toThrow(/anthropic_key_env/);
    await expect(resolveLlmKey({})).rejects.toThrow(/anthropic_key_keychain/);
  });

  it("throws when whitespace-only values are passed for every form", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    await expect(
      resolveLlmKey({
        anthropic_key: "   ",
        openai_key: "\t",
        anthropic_key_env: "  ",
        anthropic_key_keychain: " ",
      }),
    ).rejects.toBeInstanceOf(MissingLlmKeyError);
  });
});
