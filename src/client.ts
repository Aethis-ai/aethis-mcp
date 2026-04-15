/**
 * Async HTTP client for the Aethis developer API.
 */

export class AethisAPIError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly detail: string,
    public readonly reasonCode?: string,
    public readonly action?: string,
    public readonly missingPermissions: string[] = [],
  ) {
    super(`HTTP ${statusCode}: ${detail}`);
    this.name = "AethisAPIError";
  }
}

type FetchFn = typeof globalThis.fetch;

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"]);

const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_POLL_TIMEOUT_MS = 300_000; // 5 minutes

export interface AethisClientOptions {
  fetchFn?: FetchFn;
  /** Base delay in ms for exponential backoff (default 1000). Set to 0 for tests. */
  retryDelayMs?: number;
  /** Interval between status polls in ms (default 3000). Set to 0 for tests. */
  pollIntervalMs?: number;
  /** Max time to wait for generation in ms (default 300000). */
  pollTimeoutMs?: number;
}

export class AethisClient {
  private readonly baseUrl: string;
  private apiKey: string;
  private readonly fetchFn: FetchFn;
  readonly retryDelayMs: number;
  readonly pollIntervalMs: number;
  readonly pollTimeoutMs: number;

  constructor(apiKey: string, baseUrl: string, options?: AethisClientOptions) {
    this.validateBaseUrl(baseUrl);
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
    this.retryDelayMs = options?.retryDelayMs ?? 1000;
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollTimeoutMs = options?.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  }

  get hasApiKey(): boolean {
    return !!this.apiKey?.trim();
  }

  setApiKey(key: string): void {
    this.apiKey = key;
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

  private async request(method: string, path: string, body?: unknown, llmKey?: string): Promise<unknown> {
    const url = `${this.baseUrl}${path}`;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let resp: Response;

      try {
        const init: RequestInit = {
          method,
          headers: {
            ...(this.apiKey ? { "X-API-Key": this.apiKey } : {}),
            ...(llmKey ? { "X-Anthropic-Key": llmKey, "X-OpenAI-Key": llmKey } : {}),
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
        let reasonCode: string | undefined;
        let action: string | undefined;
        let missingPermissions: string[] = [];
        try {
          const json = JSON.parse(text) as Record<string, unknown>;
          const rawDetail = json.detail;
          if (typeof rawDetail === "string") {
            detail = rawDetail;
          } else if (rawDetail && typeof rawDetail === "object") {
            const payload = rawDetail as Record<string, unknown>;
            reasonCode = typeof payload.reason_code === "string" ? payload.reason_code : undefined;
            action = typeof payload.action === "string" ? payload.action : undefined;
            missingPermissions = Array.isArray(payload.missing_permissions)
              ? payload.missing_permissions.filter((v): v is string => typeof v === "string")
              : [];
            const message = typeof payload.message === "string"
              ? payload.message
              : typeof payload.error === "string"
                ? payload.error
                : `HTTP ${resp.status}`;
            const missing = missingPermissions.length > 0 ? ` missing=${missingPermissions.join(",")}` : "";
            const reason = reasonCode ? ` reason=${reasonCode}` : "";
            const act = action ? ` action=${action}` : "";
            detail = `${message}${reason}${act}${missing}`;
          } else {
            detail = text || `HTTP ${resp.status}`;
          }
        } catch {
          detail = text || `HTTP ${resp.status}`;
        }
        throw new AethisAPIError(resp.status, detail, reasonCode, action, missingPermissions);
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

  async decide(
    bundleId: string,
    fieldValues: Record<string, unknown>,
    options?: { includeTrace?: boolean; includeExplanation?: boolean },
  ): Promise<unknown> {
    return this.request("POST", "/api/v1/public/decide", {
      bundle_id: bundleId,
      field_values: fieldValues,
      ...(options?.includeTrace ? { include_trace: true } : {}),
      ...(options?.includeExplanation ? { include_explanation: true } : {}),
    });
  }

  async getSchema(bundleId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/bundles/${encodeURIComponent(bundleId)}/schema`);
  }

  async explain(bundleId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/bundles/${encodeURIComponent(bundleId)}/explain`);
  }

  async explainFailure(
    bundleId: string,
    fieldValues: Record<string, unknown>,
    expectedOutcome: string,
    testName?: string,
  ): Promise<unknown> {
    return this.request(
      "POST",
      `/api/v1/public/bundles/${encodeURIComponent(bundleId)}/explain-failure`,
      {
        field_values: fieldValues,
        expected_outcome: expectedOutcome,
        ...(testName ? { test_name: testName } : {}),
      },
    );
  }

  async getSource(bundleId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/bundles/${encodeURIComponent(bundleId)}/source`);
  }

  // -- Bundle management --

  async archiveBundle(bundleId: string): Promise<unknown> {
    return this.request("POST", `/api/v1/public/bundles/${encodeURIComponent(bundleId)}/archive`);
  }

  // -- Projects API --

  async listProjects(): Promise<unknown> {
    return this.request("GET", "/api/v1/public/projects/");
  }

  async getStatus(projectId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/projects/${encodeURIComponent(projectId)}/status`);
  }

  async generate(projectId: string, llmKey?: string): Promise<unknown> {
    return this.request("POST", `/api/v1/public/projects/${encodeURIComponent(projectId)}/generate`, undefined, llmKey);
  }

  async listBundles(projectId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/projects/${encodeURIComponent(projectId)}/bundles`);
  }

  async archiveProject(projectId: string): Promise<unknown> {
    return this.request("POST", `/api/v1/public/projects/${encodeURIComponent(projectId)}/archive`);
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
    return this.request("POST", `/api/v1/public/projects/${encodeURIComponent(projectId)}/sources`, form);
  }

  async addGuidance(projectId: string, guidanceText: string, processType?: string): Promise<unknown> {
    const body: Record<string, string> = { guidance_text: guidanceText };
    if (processType) body.process_type = processType;
    return this.request("POST", `/api/v1/public/projects/${encodeURIComponent(projectId)}/guidance`, body);
  }

  async listGuidance(projectId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/projects/${encodeURIComponent(projectId)}/guidance`);
  }

  async addDomainGuidance(domain: string, guidanceText: string, processType?: string, notes?: string): Promise<unknown> {
    const body: Record<string, string> = { guidance_text: guidanceText };
    if (processType) body.process_type = processType;
    if (notes) body.notes = notes;
    return this.request("POST", `/api/v1/public/domains/${encodeURIComponent(domain)}/guidance`, body);
  }

  async listDomainGuidance(domain: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/domains/${encodeURIComponent(domain)}/guidance`);
  }

  async discoverSections(
    domain: string,
    sources: Array<{ name: string; content: string }>,
    llmKey?: string,
  ): Promise<unknown> {
    return this.request(
      "POST",
      `/api/v1/public/domains/${encodeURIComponent(domain)}/sections/discover`,
      { sources },
      llmKey,
    );
  }

  async discoverFields(projectId: string, llmKey?: string): Promise<unknown> {
    return this.request("POST", `/api/v1/public/projects/${encodeURIComponent(projectId)}/fields/discover`, {}, llmKey);
  }

  async addTests(projectId: string, testCases: unknown[]): Promise<unknown> {
    return this.request("POST", `/api/v1/public/projects/${encodeURIComponent(projectId)}/tests`, {
      test_cases: testCases,
    });
  }

  async runTests(projectId: string): Promise<unknown> {
    return this.request("POST", `/api/v1/public/projects/${encodeURIComponent(projectId)}/test-run`);
  }

  async publish(projectId: string, label?: string): Promise<unknown> {
    const body = label !== undefined ? { label } : undefined;
    return this.request("POST", `/api/v1/public/projects/${encodeURIComponent(projectId)}/publish`, body);
  }

  // -- Compound operations --

  /**
   * Generate rules then poll until complete, then run tests.
   * Mirrors the CLI's generate --poll + test workflow.
   */
  async generateAndTest(projectId: string, llmKey?: string): Promise<unknown> {
    // 1. Trigger generation
    const job = await this.generate(projectId, llmKey) as Record<string, unknown>;
    const jobId = job.job_id as string;

    // 2. Poll until done
    const deadline = Date.now() + this.pollTimeoutMs;
    let bundleId: string | undefined;

    let lastDetail = "";

    while (Date.now() < deadline) {
      const status = await this.getStatus(projectId) as Record<string, unknown>;
      const jobData = status.job as Record<string, unknown> | undefined;

      if (jobData) {
        const jobStatus = jobData.status as string;

        // Log progress changes to stderr so the MCP client can surface them
        const pct = (jobData.progress_percent as number) ?? 0;
        const detail = (jobData.progress_detail as string) ?? "";
        if (detail && detail !== lastDetail) {
          lastDetail = detail;
          process.stderr.write(`[aethis] ${pct}% — ${detail}\n`);
        }

        if (jobStatus === "success") {
          bundleId = (status.latest_bundle_id ?? jobData.result_bundle_id) as string | undefined;
          break;
        }
        if (jobStatus === "failed") {
          const errorMsg = (jobData.error_message as string) || "";
          let diagnostic: string;
          if (!errorMsg) {
            diagnostic = `Generation failed (job ${jobId}) with no error details. Check server logs or retry.`;
          } else if (/API key|Authentication|AuthenticationError/i.test(errorMsg)) {
            diagnostic = `Generation failed: ${errorMsg}`;
          } else if (/rate.?limit/i.test(errorMsg)) {
            diagnostic = `Generation failed: ${errorMsg} Wait a moment and retry.`;
          } else {
            diagnostic = `Generation failed (job ${jobId}): ${errorMsg}`;
          }
          throw new AethisAPIError(500, diagnostic);
        }
      }

      await this.sleep(this.pollIntervalMs);
    }

    if (!bundleId) {
      throw new AethisAPIError(504, `Generation timed out after ${this.pollTimeoutMs / 1000}s. The generation may still be running server-side. Retry after a delay.`);
    }

    // 3. Run tests
    const testResult = await this.runTests(projectId) as Record<string, unknown>;

    return {
      bundle_id: bundleId,
      ...testResult,
    };
  }
}
