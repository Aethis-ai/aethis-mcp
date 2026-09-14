import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfiguredClient, createToolHandlers } from "../src/index.js";

// These exercise the server's startup factory, actual auth guard, and HTTP
// client with a real CLI-format credentials file. Only fetch is mocked.
describe("selected credentials at the MCP handler HTTP boundary", () => {
  const originalEnv = { ...process.env };
  let root: string;
  let path: string;
  let fetchFn: ReturnType<typeof vi.fn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    delete process.env.AETHIS_API_KEY;
    delete process.env.AETHIS_BASE_URL;
    root = await mkdtemp(join(tmpdir(), "mcp-profile-boundary-"));
    process.env.XDG_CONFIG_HOME = root;
    process.env.AETHIS_PROFILE = "selected";
    path = join(root, "aethis", "credentials");
    await mkdir(join(root, "aethis"));
    fetchFn = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  async function store(key = "ak_selected", url = "https://selected.example", active = "other"): Promise<void> {
    await writeFile(path, `active_profile: ${active}\nprofiles:\n  selected:\n    api_key: '${key}'\n    base_url: ${url}\n  other:\n    api_key: ak_other\n    base_url: https://other.example\n`);
    await chmod(path, 0o600);
  }

  function expectRequest(key: string, url = "https://selected.example"): void {
    expect(fetchFn).toHaveBeenCalledWith(`${url}/api/v1/public/projects/`, expect.objectContaining({
      headers: expect.objectContaining({ "X-API-Key": key }),
    }));
    expect(JSON.stringify(stderr.mock.calls)).not.toMatch(/ak_selected|ak_other|ak_new|ak_override/);
  }

  it("uses the explicitly installed name rather than a later active_profile change", async () => {
    await store();
    const client = await createConfiguredClient({ fetchFn });
    const result = await createToolHandlers(client).aethis_list_projects({});
    expect(result.isError).not.toBe(true);
    expectRequest("ak_selected");
  });

  it("uses the CLI active profile without an explicit name", async () => {
    delete process.env.AETHIS_PROFILE;
    await store("ak_selected", "https://selected.example", "selected");
    const client = await createConfiguredClient({ fetchFn });
    await createToolHandlers(client).aethis_list_projects({});
    expectRequest("ak_selected");
  });

  it("preserves deliberate environment overrides at the HTTP boundary", async () => {
    await store();
    process.env.AETHIS_API_KEY = "ak_override";
    process.env.AETHIS_BASE_URL = "https://override.example";
    const client = await createConfiguredClient({ fetchFn });
    await createToolHandlers(client).aethis_list_projects({});
    expectRequest("ak_override", "https://override.example");
  });

  it("accepts late login when the selected endpoint remains unchanged", async () => {
    await store("");
    const client = await createConfiguredClient({ fetchFn });
    expect(client.hasApiKey).toBe(false);
    await store("ak_new");
    const result = await createToolHandlers(client).aethis_list_projects({});
    expect(result.isError).not.toBe(true);
    expectRequest("ak_new");
  });

  it("refuses late login to a changed endpoint before any request", async () => {
    await store("");
    const client = await createConfiguredClient({ fetchFn });
    await store("ak_new", "https://new.example");
    const result = await createToolHandlers(client).aethis_list_projects({});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/Restart your MCP host/);
    expect(client.hasApiKey).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/ak_new|ak_other/);
  });

  it("refuses a late implicit active-profile endpoint change", async () => {
    delete process.env.AETHIS_PROFILE;
    await store("", "https://selected.example", "selected");
    const client = await createConfiguredClient({ fetchFn });
    await store("ak_new", "https://selected.example", "other");
    const result = await createToolHandlers(client).aethis_list_projects({});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/Restart your MCP host/);
    expect(client.hasApiKey).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses a removed named profile after anonymous startup", async () => {
    await store("");
    const client = await createConfiguredClient({ fetchFn });
    await writeFile(path, "profiles: {other: {api_key: ak_other}}\n");
    const result = await createToolHandlers(client).aethis_list_projects({});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/selected.*missing/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("keeps an authenticated startup snapshot paired until host restart", async () => {
    await store();
    const client = await createConfiguredClient({ fetchFn });
    await store("ak_new", "https://new.example");
    await createToolHandlers(client).aethis_list_projects({});
    expectRequest("ak_selected");
  });

  it("fails startup visibly for invalid selected config", async () => {
    await store();
    await writeFile(path, "profiles: {selected: {api_key: [ak_selected}}\n");
    await expect(createConfiguredClient({ fetchFn })).rejects.toThrow(/Invalid Aethis credentials YAML/);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it.each(["ftp://example.test", "not-a-url", "https://ak_selected@example.test", "https://example.test?key=ak_selected", "https://example.test#ak_selected"])("refuses invalid selected endpoint without exposing it: %s", async (endpoint) => {
    await store("ak_selected", endpoint);
    try { await createConfiguredClient({ fetchFn }); throw new Error("Expected refusal"); } catch (error) {
      expect((error as Error).message).toMatch(/Invalid Aethis base URL/);
      expect((error as Error).message).not.toMatch(/ak_selected/);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("anonymous selection ignores stored and environment keys", async () => {
    await store();
    process.env.AETHIS_PROFILE = "anonymous";
    process.env.AETHIS_API_KEY = "ak_override";
    const client = await createConfiguredClient({ fetchFn });
    const result = await createToolHandlers(client).aethis_discover_rulesets({});
    expect(result.isError).not.toBe(true);
    expect(fetchFn).toHaveBeenCalled();
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty("X-API-Key");
    const authResult = await createToolHandlers(client).aethis_list_projects({});
    expect(authResult.isError).toBe(true);
    expect(JSON.stringify(authResult)).toMatch(/anonymous profile is selected.*reinstall/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
