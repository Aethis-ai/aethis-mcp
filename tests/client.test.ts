import { describe, it, expect, vi, beforeEach } from "vitest";
import { AethisClient, AethisAPIError } from "../src/client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock Response. */
function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function errorResponse(status: number, detail: string, headers: Record<string, string> = {}): Response {
  const body = { detail };
  return {
    ok: false,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Construction / validation
// ---------------------------------------------------------------------------

describe("AethisClient construction", () => {
  it("throws if AETHIS_API_KEY is missing", () => {
    expect(() => new AethisClient("", "https://api.aethis.ai")).toThrow(AethisAPIError);
    expect(() => new AethisClient("", "https://api.aethis.ai")).toThrow(/API key/i);
  });

  it("throws if remote URL uses HTTP", () => {
    expect(() => new AethisClient("ak_test", "http://evil.example.com")).toThrow(AethisAPIError);
    expect(() => new AethisClient("ak_test", "http://evil.example.com")).toThrow(/HTTPS/i);
  });

  it("allows HTTP for localhost", () => {
    expect(() => new AethisClient("ak_test", "http://localhost:8000")).not.toThrow();
    expect(() => new AethisClient("ak_test", "http://127.0.0.1:8000")).not.toThrow();
  });

  it("allows HTTPS for remote hosts", () => {
    expect(() => new AethisClient("ak_test", "https://api.aethis.ai")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Request / response handling
// ---------------------------------------------------------------------------

describe("AethisClient requests", () => {
  let client: AethisClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    client = new AethisClient("ak_test", "https://api.aethis.ai", { fetchFn: fetchSpy, retryDelayMs: 0 });
  });

  it("sends X-API-Key header", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ result: true }));
    await client.listProjects();
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers["X-API-Key"]).toBe("ak_test");
  });

  it("returns parsed JSON on success", async () => {
    const data = { bundle_id: "b_123", fields: [] };
    fetchSpy.mockResolvedValueOnce(jsonResponse(data));
    const result = await client.getSchema("b_123");
    expect(result).toEqual(data);
  });

  it("returns empty object on 204 No Content", async () => {
    const resp = {
      ok: true,
      status: 204,
      headers: new Headers(),
      json: async () => { throw new Error("no body"); },
      text: async () => "",
    } as unknown as Response;
    fetchSpy.mockResolvedValueOnce(resp);
    const result = await client.listProjects();
    expect(result).toEqual({});
  });

  it("throws AethisAPIError on 4xx with detail", async () => {
    fetchSpy.mockResolvedValueOnce(errorResponse(422, "Missing required field: age"));
    await expect(client.decide("b_123", {})).rejects.toThrow(AethisAPIError);
    await fetchSpy.mockResolvedValueOnce(errorResponse(422, "Missing required field: age"));
    try {
      await client.decide("b_123", {});
    } catch (e) {
      expect((e as AethisAPIError).statusCode).toBe(422);
      expect((e as AethisAPIError).detail).toBe("Missing required field: age");
    }
  });

  it("throws AethisAPIError on 5xx", async () => {
    fetchSpy.mockResolvedValueOnce(errorResponse(500, "Internal server error"));
    await expect(client.getSchema("b_123")).rejects.toThrow(AethisAPIError);
  });
});

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

describe("AethisClient retry", () => {
  let client: AethisClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    client = new AethisClient("ak_test", "https://api.aethis.ai", { fetchFn: fetchSpy, retryDelayMs: 0 });
  });

  it("retries on 429 and succeeds", async () => {
    fetchSpy
      .mockResolvedValueOnce(errorResponse(429, "Rate limited", { "Retry-After": "1" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await client.listProjects();
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 and succeeds", async () => {
    fetchSpy
      .mockResolvedValueOnce(errorResponse(503, "Service unavailable"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await client.listProjects();
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("retries on network error and succeeds", async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await client.listProjects();
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("gives up after max retries", async () => {
    fetchSpy.mockResolvedValue(errorResponse(503, "Service unavailable"));

    await expect(client.listProjects()).rejects.toThrow(AethisAPIError);
    expect(fetchSpy.mock.calls.length).toBe(4); // 1 initial + 3 retries
  });

  it("does not retry on 400/404/422", async () => {
    fetchSpy.mockResolvedValueOnce(errorResponse(404, "Not found"));
    await expect(client.getSchema("bad")).rejects.toThrow(AethisAPIError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// API methods send correct requests
// ---------------------------------------------------------------------------

describe("AethisClient API methods", () => {
  let client: AethisClient;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    client = new AethisClient("ak_test", "https://api.aethis.ai", { fetchFn: fetchSpy, retryDelayMs: 0 });
  });

  it("decide() posts to /api/v1/public/decide", async () => {
    await client.decide("b_123", { age: 30 });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.aethis.ai/api/v1/public/decide");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ bundle_id: "b_123", field_values: { age: 30 } });
  });

  it("getSchema() gets /api/v1/public/bundles/:id/schema", async () => {
    await client.getSchema("b_123");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.aethis.ai/api/v1/public/bundles/b_123/schema");
    expect(init.method).toBe("GET");
  });

  it("explain() gets /api/v1/public/bundles/:id/explain", async () => {
    await client.explain("b_123");
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.aethis.ai/api/v1/public/bundles/b_123/explain");
  });

  it("listProjects() gets /api/v1/public/projects/", async () => {
    await client.listProjects();
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.aethis.ai/api/v1/public/projects/");
  });

  it("getStatus() gets /api/v1/public/projects/:id/status", async () => {
    await client.getStatus("p_1");
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.aethis.ai/api/v1/public/projects/p_1/status");
  });

  it("generate() posts to /api/v1/public/projects/:id/generate", async () => {
    await client.generate("p_1");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.aethis.ai/api/v1/public/projects/p_1/generate");
    expect(init.method).toBe("POST");
  });

  it("createProject() posts to /api/v1/public/projects/", async () => {
    await client.createProject("test", "s1", "domain");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.aethis.ai/api/v1/public/projects/");
    expect(JSON.parse(init.body)).toEqual({ name: "test", section_id: "s1", domain: "domain" });
  });

  it("uploadSourceText() posts multipart to /api/v1/public/projects/:id/sources", async () => {
    await client.uploadSourceText("p_1", "rules.md", "The legislation says...");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.aethis.ai/api/v1/public/projects/p_1/sources");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("addGuidance() posts to /api/v1/public/projects/:id/guidance", async () => {
    await client.addGuidance("p_1", "Dolphins excluded");
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ guidance_text: "Dolphins excluded" });
  });

  it("addTests() posts to /api/v1/public/projects/:id/tests", async () => {
    const cases = [{ name: "c1", field_values: {}, expected_outcome: "eligible" }];
    await client.addTests("p_1", cases);
    const [, init] = fetchSpy.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ test_cases: cases });
  });

  it("runTests() posts to /api/v1/public/projects/:id/test-run", async () => {
    await client.runTests("p_1");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.aethis.ai/api/v1/public/projects/p_1/test-run");
    expect(init.method).toBe("POST");
  });

  it("publish() posts to /api/v1/public/projects/:id/publish", async () => {
    await client.publish("p_1");
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.aethis.ai/api/v1/public/projects/p_1/publish");
  });

  it("generateAndTest() posts to /api/v1/public/projects/:id/generate-and-test", async () => {
    await client.generateAndTest("p_1");
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.aethis.ai/api/v1/public/projects/p_1/generate-and-test");
  });
});
