/**
 * Async HTTP client for the Aethis developer API.
 */

export class AethisAPIError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly detail: string,
  ) {
    super(`HTTP ${statusCode}: ${detail}`);
    this.name = "AethisAPIError";
  }
}

type FetchFn = typeof globalThis.fetch;

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"]);

export interface AethisClientOptions {
  fetchFn?: FetchFn;
  /** Base delay in ms for exponential backoff (default 1000). Set to 0 for tests. */
  retryDelayMs?: number;
}

export class AethisClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: FetchFn;
  private readonly retryDelayMs: number;

  constructor(apiKey: string, baseUrl: string, options?: AethisClientOptions) {
    if (!apiKey) {
      throw new AethisAPIError(401, "API key is required. Set AETHIS_API_KEY environment variable.");
    }
    this.validateBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
    this.retryDelayMs = options?.retryDelayMs ?? 1000;
  }

  private validateBaseUrl(url: string): void {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" && !LOCAL_HOSTS.has(parsed.hostname)) {
      throw new AethisAPIError(
        400,
        `Refusing to use HTTP for remote host '${parsed.hostname}'. Use HTTPS or target localhost for local development.`,
      );
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let resp: Response;

      try {
        const init: RequestInit = {
          method,
          headers: {
            "X-API-Key": this.apiKey,
            ...(body !== undefined && !(body instanceof FormData)
              ? { "Content-Type": "application/json" }
              : {}),
          },
          body:
            body instanceof FormData
              ? body
              : body !== undefined
                ? JSON.stringify(body)
                : undefined,
        };
        resp = await this.fetchFn(url, init);
      } catch (err) {
        lastError = err as Error;
        if (attempt < MAX_RETRIES) {
          await this.sleep(2 ** attempt * this.retryDelayMs);
          continue;
        }
        throw new AethisAPIError(
          0,
          `Connection failed after ${MAX_RETRIES + 1} attempts: ${(err as Error).message}`,
        );
      }

      if (RETRYABLE_STATUSES.has(resp.status) && attempt < MAX_RETRIES) {
        const retryAfter = parseFloat(resp.headers.get("Retry-After") ?? String(2 ** attempt));
        await this.sleep(Math.min(retryAfter, 30) * this.retryDelayMs);
        continue;
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        let detail: string;
        try {
          const json = JSON.parse(text) as Record<string, unknown>;
          detail = (json.detail as string) ?? text;
        } catch {
          detail = text || `HTTP ${resp.status}`;
        }
        throw new AethisAPIError(resp.status, detail);
      }

      if (resp.status === 204) return {};
      return resp.json();
    }

    throw new AethisAPIError(
      0,
      `Request failed after ${MAX_RETRIES + 1} attempts`,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // -- Decision API --

  async decide(bundleId: string, fieldValues: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", "/api/v1/public/decide", {
      bundle_id: bundleId,
      field_values: fieldValues,
    });
  }

  async getSchema(bundleId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/bundles/${bundleId}/schema`);
  }

  async explain(bundleId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/bundles/${bundleId}/explain`);
  }

  // -- Projects API --

  async listProjects(): Promise<unknown> {
    return this.request("GET", "/api/v1/public/projects/");
  }

  async getStatus(projectId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/projects/${projectId}/status`);
  }

  async generate(projectId: string): Promise<unknown> {
    return this.request("POST", `/api/v1/public/projects/${projectId}/generate`);
  }

  // -- Authoring API --

  async createProject(name: string, sectionId: string, domain: string = ""): Promise<unknown> {
    return this.request("POST", "/api/v1/public/projects/", {
      name,
      section_id: sectionId,
      domain,
    });
  }

  async uploadSourceText(projectId: string, filename: string, content: string): Promise<unknown> {
    const form = new FormData();
    form.append("files", new Blob([content], { type: "text/plain" }), filename);
    return this.request("POST", `/api/v1/public/projects/${projectId}/sources`, form);
  }

  async addGuidance(projectId: string, guidanceText: string): Promise<unknown> {
    return this.request("POST", `/api/v1/public/projects/${projectId}/guidance`, {
      guidance_text: guidanceText,
    });
  }

  async addTests(projectId: string, testCases: unknown[]): Promise<unknown> {
    return this.request("POST", `/api/v1/public/projects/${projectId}/tests`, {
      test_cases: testCases,
    });
  }

  async runTests(projectId: string): Promise<unknown> {
    return this.request("POST", `/api/v1/public/projects/${projectId}/test-run`);
  }

  async publish(projectId: string): Promise<unknown> {
    return this.request("POST", `/api/v1/public/projects/${projectId}/publish`);
  }

  async generateAndTest(projectId: string): Promise<unknown> {
    return this.request("POST", `/api/v1/public/projects/${projectId}/generate-and-test`);
  }
}
