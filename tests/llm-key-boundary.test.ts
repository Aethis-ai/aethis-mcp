import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Model-provider credentials only leave this process when the USER configured
// them for Aethis, only as an Anthropic key, and never come back out in a tool
// result. A tool argument chosen by the host model is not user configuration.

const { resolveLlmKey, MissingLlmKeyError, LlmKeyNotPermittedError } =
  await import("../src/credentials.js");
const { AethisClient, AethisAPIError } = await import("../src/client.js");
const { createToolHandlers } = await import("../src/index.js");

// Key-shaped fixtures, not real credentials.
const ANTHROPIC_KEY =
  "sk-ant-api03-" + "A1b2C3d4E5f6G7h8I9j0".repeat(4) + "-zYxWvU";
const OPENAI_KEY = "sk-proj-" + "Q9w8E7r6T5y4U3i2O1p0".repeat(3);
const MASKED_ECHO = "sk-ant-a" + "*".repeat(40) + "zYxW";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function resultText(r: { content: Array<{ text: string }> }): string {
  return r.content.map((c) => c.text).join("\n");
}

describe("provider keys are never read from the environment by default", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.AETHIS_ANTHROPIC_KEY_ENV;
    process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY;
    process.env.OPENAI_API_KEY = OPENAI_KEY;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("refuses an env var named only by the tool call", async () => {
    await expect(
      resolveLlmKey({ anthropic_key_env: "ANTHROPIC_API_KEY" }),
    ).rejects.toBeInstanceOf(LlmKeyNotPermittedError);
  });

  it("does not pick up ANTHROPIC_API_KEY when nothing is configured", async () => {
    await expect(resolveLlmKey({})).rejects.toBeInstanceOf(MissingLlmKeyError);
  });

  it("the refusal addresses the user and does not hand the model an argument to retry with", async () => {
    const e = await resolveLlmKey({
      anthropic_key_env: "ANTHROPIC_API_KEY",
    }).catch((x: Error) => x);
    expect(String(e)).toMatch(/AETHIS_ANTHROPIC_KEY_ENV/);
    expect(String(e)).not.toMatch(/anthropic_key_env:\s*'ANTHROPIC_API_KEY'/);
    expect(String(e)).not.toContain(ANTHROPIC_KEY);
  });

  it("a tool handler sends no provider credential when only the environment holds one", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ fields: [] }));
    const client = new AethisClient("ak_test", "https://api.aethis.ai", {
      fetchFn: fetchSpy,
      retryDelayMs: 0,
    });
    const handlers = createToolHandlers(client);
    await handlers.aethis_discover_sections({
      domain: "unit_test",
      sources: [{ name: "a.md", content: "text" }],
      anthropic_key_env: "ANTHROPIC_API_KEY",
    });
    for (const [, init] of fetchSpy.mock.calls) {
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers["X-Anthropic-Key"]).toBeUndefined();
      expect(headers["X-OpenAI-Key"]).toBeUndefined();
      expect(JSON.stringify(init)).not.toContain(ANTHROPIC_KEY);
    }
  });
});

describe("explicit user configuration", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reads the variable the user named in the server config", async () => {
    process.env.AETHIS_ANTHROPIC_KEY_ENV = "MY_AETHIS_ANTHROPIC_KEY";
    process.env.MY_AETHIS_ANTHROPIC_KEY = ANTHROPIC_KEY;
    await expect(resolveLlmKey({})).resolves.toBe(ANTHROPIC_KEY);
    await expect(
      resolveLlmKey({ anthropic_key_env: "MY_AETHIS_ANTHROPIC_KEY" }),
    ).resolves.toBe(ANTHROPIC_KEY);
  });

  it("refuses a tool-chosen variable that differs from the configured one", async () => {
    process.env.AETHIS_ANTHROPIC_KEY_ENV = "MY_AETHIS_ANTHROPIC_KEY";
    process.env.MY_AETHIS_ANTHROPIC_KEY = ANTHROPIC_KEY;
    process.env.OTHER_SECRET = OPENAI_KEY;
    await expect(
      resolveLlmKey({ anthropic_key_env: "OTHER_SECRET" }),
    ).rejects.toBeInstanceOf(LlmKeyNotPermittedError);
  });

  it("refuses openai_key and any non-Anthropic credential without echoing it", async () => {
    for (const args of [
      { openai_key: OPENAI_KEY },
      { anthropic_key: OPENAI_KEY },
      { anthropic_key: "not-a-key" },
    ]) {
      const e = await resolveLlmKey(args).catch((x: Error) => x);
      expect(e).toBeInstanceOf(LlmKeyNotPermittedError);
      expect(String(e)).not.toContain(OPENAI_KEY);
      expect(String(e)).not.toContain("not-a-key");
    }
  });
});

describe("key-shaped text never reaches a tool result", () => {
  it("masks an upstream error that echoes a key", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          {
            detail: `Incorrect API key provided: ${ANTHROPIC_KEY} / ${MASKED_ECHO}`,
          },
          400,
        ),
      );
    const client = new AethisClient("ak_test", "https://api.aethis.ai", {
      fetchFn: fetchSpy,
      retryDelayMs: 0,
    });
    const e = await client.listProjects().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AethisAPIError);
    const detail = (e as InstanceType<typeof AethisAPIError>).detail;
    expect(detail).toContain("Incorrect API key provided");
    expect(detail).not.toContain(ANTHROPIC_KEY);
    expect(detail).not.toContain(MASKED_ECHO);
    expect(detail).not.toMatch(/sk-ant-/);
  });

  it("masks key-shaped text inside a successful response rendered to the model", async () => {
    process.env.AETHIS_ANTHROPIC_KEY_ENV = "MY_AETHIS_ANTHROPIC_KEY";
    process.env.MY_AETHIS_ANTHROPIC_KEY = ANTHROPIC_KEY;
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({
          sections: [],
          confidence: 0,
          analysis_notes: `Discovery failed: 401 ${MASKED_ECHO} ${OPENAI_KEY}`,
        }),
      );
    const client = new AethisClient("ak_test", "https://api.aethis.ai", {
      fetchFn: fetchSpy,
      retryDelayMs: 0,
    });
    const out = resultText(
      await createToolHandlers(client).aethis_discover_sections({
        domain: "unit_test",
        sources: [{ name: "a.md", content: "text" }],
      }),
    );
    expect(out).toContain("Discovery failed");
    expect(out).not.toContain(MASKED_ECHO);
    expect(out).not.toContain(OPENAI_KEY);
    expect(out).not.toMatch(/sk-(ant|proj)-/);
    delete process.env.AETHIS_ANTHROPIC_KEY_ENV;
    delete process.env.MY_AETHIS_ANTHROPIC_KEY;
  });
});

describe("masking leaves ordinary identifiers alone", () => {
  it.each(["risk-assessment-v2", "task-management-queue", "desk-booking"])("%s survives", async (word) => {
    const { redactSecrets } = await import("../src/redact.js");
    expect(redactSecrets(`field ${word} ok`)).toBe(`field ${word} ok`);
  });
});
