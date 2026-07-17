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
const PROGRESS_DETAIL_MAX_CHARS = 120;

// Allowed shapes for rulebook references. These are the only inputs
// getRulebookSchema() will send to the wire — anything else is rejected
// before URL construction so a malicious caller can't smuggle `..`, `?`,
// `#`, whitespace, or extra path segments through the slug branch.
//
// Slug grammar mirrors the engine's `{namespace}/{name}` route: each
// segment starts with a lowercase letter or digit and contains only
// lowercase letters, digits, and `-`. Two segments separated by one `/`.
// Opaque id is the engine's `rb_<urlsafe>` shape.
export const RULEBOOK_SLUG_RE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
export const RULEBOOK_OPAQUE_ID_RE = /^rb_[A-Za-z0-9_-]+$/;

// Match any C0 control char except TAB (0x09), plus DEL (0x7F).
// Source-server-supplied `progress_detail` is logged to stderr verbatim
// today; we strip non-printables so a malicious or buggy upstream can't
// inject terminal escape sequences or break log parsers. (#34)
// eslint-disable-next-line no-control-regex
const PROGRESS_DETAIL_CONTROL_RE = /[\x00-\x08\x0A-\x1F\x7F]/g;

/**
 * Strip control characters from `progress_detail` text before writing it to
 * stderr, and cap the length at `PROGRESS_DETAIL_MAX_CHARS`. Exported so the
 * test suite can exercise the redaction directly.
 */
export function sanitizeProgressDetail(s: string): string {
  const stripped = s.replace(PROGRESS_DETAIL_CONTROL_RE, "");
  if (stripped.length <= PROGRESS_DETAIL_MAX_CHARS) return stripped;
  return stripped.slice(0, PROGRESS_DETAIL_MAX_CHARS) + "…";
}

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
            ...(llmKey ? { "X-Anthropic-Key": llmKey } : {}),
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
    rulesetId: string,
    fieldValues: Record<string, unknown>,
    options?: { includeTrace?: boolean; includeExplanation?: boolean; includeGraphOverlay?: boolean },
  ): Promise<unknown> {
    return this.request("POST", "/api/v1/public/decide", {
      ruleset_id: rulesetId,
      field_values: fieldValues,
      ...(options?.includeTrace ? { include_trace: true } : {}),
      ...(options?.includeExplanation ? { include_explanation: true } : {}),
      ...(options?.includeGraphOverlay ? { include_graph_overlay: true } : {}),
    });
  }

  async decideRulebook(
    rulebookId: string,
    fieldValues: Record<string, unknown>,
    options?: { includeTrace?: boolean; includeExplanation?: boolean; includeGraphOverlay?: boolean },
  ): Promise<unknown> {
    // Same `/decide` endpoint as decide(), but sends rulebook_id instead of
    // ruleset_id. Composed-rulebook evaluation is always scope-gated by the
    // engine — anonymous callers get HTTP 401 here.
    return this.request("POST", "/api/v1/public/decide", {
      rulebook_id: rulebookId,
      field_values: fieldValues,
      ...(options?.includeTrace ? { include_trace: true } : {}),
      ...(options?.includeExplanation ? { include_explanation: true } : {}),
      ...(options?.includeGraphOverlay ? { include_graph_overlay: true } : {}),
    });
  }

  // -- Graph API --
  //
  // The ruleset-map graph: criterion/field nodes with `display.sentence` /
  // `display.routes` / `display.expr` showing how each branch composes, plus
  // a ready-to-render `mermaid` diagram string. Ruleset graphs use the same
  // anonymous-for-public-showcase policy as getSchema()/explain(); rulebook
  // graphs are tenant-scoped like getRulebookSchema() (see the comment there).

  async getRulesetGraph(rulesetId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/rulesets/${encodeURIComponent(rulesetId)}/graph`);
  }

  async getRulebookGraph(rulebookId: string): Promise<unknown> {
    // Same slug-vs-opaque-id dispatch as getRulebookSchema() — see that
    // method's comment for why the two forms are validated before touching
    // the URL.
    if (RULEBOOK_SLUG_RE.test(rulebookId)) {
      return this.request("GET", `/api/v1/public/rulebooks/${rulebookId}/graph`);
    }
    if (RULEBOOK_OPAQUE_ID_RE.test(rulebookId)) {
      return this.request("GET", `/api/v1/public/rulebooks/${encodeURIComponent(rulebookId)}/graph`);
    }
    throw new AethisAPIError(
      400,
      `Invalid rulebook reference '${rulebookId}'. ` +
        "Expected a slug like 'aethis/uk-fsm' (lowercase, digits, '-') " +
        "or an opaque id like 'rb_abc123' (letters, digits, '_', '-').",
    );
  }

  async getSchema(rulesetId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/rulesets/${encodeURIComponent(rulesetId)}/schema`);
  }

  async explain(rulesetId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/rulesets/${encodeURIComponent(rulesetId)}/explain`);
  }

  async explainFailure(
    rulesetId: string,
    fieldValues: Record<string, unknown>,
    expectedOutcome: string,
    testName?: string,
  ): Promise<unknown> {
    return this.request(
      "POST",
      `/api/v1/public/rulesets/${encodeURIComponent(rulesetId)}/explain-failure`,
      {
        field_values: fieldValues,
        expected_outcome: expectedOutcome,
        ...(testName ? { test_name: testName } : {}),
      },
    );
  }

  async getSource(rulesetId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/rulesets/${encodeURIComponent(rulesetId)}/source`);
  }

  // -- Ruleset management --

  async archiveRuleset(rulesetId: string): Promise<unknown> {
    return this.request("POST", `/api/v1/public/rulesets/${encodeURIComponent(rulesetId)}/archive`);
  }

  // -- Rulebooks API --
  //
  // Rulebooks are the composed-whole counterpart to rulesets. Today both list
  // and schema endpoints are tenant-scoped (auth required, no anonymous
  // cross-tenant catalogue) — tracked in aethis-core#160. Slugs in the
  // `aethis/uk-fsm` shape contain a forward slash; pass them as-is without
  // encoding so they hit the engine's `{namespace}/{name}` route variant.

  async listRulebooks(): Promise<unknown> {
    return this.request("GET", "/api/v1/public/rulebooks/");
  }

  async getRulebookSchema(rulebookId: string): Promise<unknown> {
    // Two valid input shapes — anything else is rejected before it
    // touches the URL, so a slug-shaped string can never smuggle
    // `..`, `?`, `#`, whitespace, or extra `/` past the client.
    //
    //   slug:      `<namespace>/<name>`, lowercase + digits + `-`
    //              (engine grammar; e.g. `aethis/uk-fsm`)
    //   opaque id: `rb_<urlsafe>` — letters, digits, `_`, `-`
    //
    // Slug form preserves the literal `/` so the engine's
    // `{namespace}/{name}/schema` route matches; opaque ids go through
    // `encodeURIComponent` for defense-in-depth even though they can't
    // contain reserved characters by grammar.
    if (RULEBOOK_SLUG_RE.test(rulebookId)) {
      return this.request("GET", `/api/v1/public/rulebooks/${rulebookId}/schema`);
    }
    if (RULEBOOK_OPAQUE_ID_RE.test(rulebookId)) {
      return this.request("GET", `/api/v1/public/rulebooks/${encodeURIComponent(rulebookId)}/schema`);
    }
    throw new AethisAPIError(
      400,
      `Invalid rulebook reference '${rulebookId}'. ` +
        "Expected a slug like 'aethis/uk-fsm' (lowercase, digits, '-') " +
        "or an opaque id like 'rb_abc123' (letters, digits, '_', '-').",
    );
  }

  // -- Rulebook authoring (create/update) --
  //
  // Rulebook creation/composition (ruleset_refs, outcome_logic) is a larger
  // surface than this client exposes today; these two methods cover the
  // fields the MCP authoring tools need: identity (name/domain/slug/
  // description) and `robot_hints` (assistant guidance, beat -> prose).

  async createRulebook(
    name: string,
    options?: { domain?: string; slug?: string; description?: string; robotHints?: Record<string, string> },
  ): Promise<unknown> {
    return this.request("POST", "/api/v1/public/rulebooks/", {
      name,
      domain: options?.domain ?? "",
      ...(options?.slug !== undefined ? { slug: options.slug } : {}),
      ...(options?.description !== undefined ? { description: options.description } : {}),
      ...(options?.robotHints !== undefined ? { robot_hints: options.robotHints } : {}),
    });
  }

  async updateRulebook(
    rulebookId: string,
    options?: { name?: string; description?: string; slug?: string; robotHints?: Record<string, string> },
  ): Promise<unknown> {
    const body: Record<string, unknown> = {};
    if (options?.name !== undefined) body.name = options.name;
    if (options?.description !== undefined) body.description = options.description;
    if (options?.slug !== undefined) body.slug = options.slug;
    if (options?.robotHints !== undefined) body.robot_hints = options.robotHints;

    // Same slug-vs-opaque-id dispatch as getRulebookSchema()/getRulebookGraph().
    if (RULEBOOK_SLUG_RE.test(rulebookId)) {
      return this.request("PATCH", `/api/v1/public/rulebooks/${rulebookId}`, body);
    }
    if (RULEBOOK_OPAQUE_ID_RE.test(rulebookId)) {
      return this.request("PATCH", `/api/v1/public/rulebooks/${encodeURIComponent(rulebookId)}`, body);
    }
    throw new AethisAPIError(
      400,
      `Invalid rulebook reference '${rulebookId}'. ` +
        "Expected a slug like 'aethis/uk-fsm' (lowercase, digits, '-') " +
        "or an opaque id like 'rb_abc123' (letters, digits, '_', '-').",
    );
  }

  // -- Projects API --

  async listProjects(): Promise<unknown> {
    return this.request("GET", "/api/v1/public/projects/");
  }

  async getStatus(projectId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/projects/${encodeURIComponent(projectId)}/status`);
  }

  async generate(projectId: string, llmKey?: string, mode?: "fresh" | "refine"): Promise<unknown> {
    // mode="refine" seeds generation from the section's active ruleset and asks
    // for the minimal edit to fix failing tests (finding-driven incremental
    // re-authoring); omitting it / "fresh" authors from scratch.
    const body = mode ? { mode } : undefined;
    return this.request("POST", `/api/v1/public/projects/${encodeURIComponent(projectId)}/generate`, body, llmKey);
  }

  async listRulesets(projectId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/projects/${encodeURIComponent(projectId)}/rulesets`);
  }

  /**
   * List published rulesets visible to anonymous callers (the cross-tenant
   * showcase catalogue). The endpoint filters on `visibility="public"`
   * regardless of whether a key is present, so this works the same for
   * authenticated and unauthenticated clients.
   */
  async discoverRulesets(limit: number = 20, offset: number = 0): Promise<unknown> {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return this.request("GET", `/api/v1/public/rulesets?${params.toString()}`);
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

  async addGuidance(projectId: string, guidanceText: string, processType?: string, adherence?: string): Promise<unknown> {
    const body: Record<string, string> = { guidance_text: guidanceText };
    if (processType) body.process_type = processType;
    if (adherence) body.adherence = adherence;
    return this.request("POST", `/api/v1/public/projects/${encodeURIComponent(projectId)}/guidance`, body);
  }

  async listGuidance(projectId: string): Promise<unknown> {
    return this.request("GET", `/api/v1/public/projects/${encodeURIComponent(projectId)}/guidance`);
  }

  async addDomainGuidance(domain: string, guidanceText: string, processType?: string, notes?: string, adherence?: string): Promise<unknown> {
    const body: Record<string, string> = { guidance_text: guidanceText };
    if (processType) body.process_type = processType;
    if (notes) body.notes = notes;
    if (adherence) body.adherence = adherence;
    return this.request("POST", `/api/v1/public/domains/${encodeURIComponent(domain)}/guidance`, body);
  }

  async validateSections(
    domain: string,
    expectedSections: string[],
    discoveredSections: string[],
  ): Promise<unknown> {
    return this.request(
      "POST",
      `/api/v1/public/domains/${encodeURIComponent(domain)}/sections/validate`,
      { expected_sections: expectedSections, discovered_sections: discoveredSections },
    );
  }

  async setFieldSpec(
    projectId: string,
    expectedFields: Array<{ key: string; sort: string; enum_values?: string[] }>,
  ): Promise<unknown> {
    return this.request(
      "POST",
      `/api/v1/public/projects/${encodeURIComponent(projectId)}/fields/spec`,
      { expected_fields: expectedFields },
    );
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

  async validateFields(
    projectId: string,
    expectedFields: Array<{ key: string; sort: string; enum_values?: string[] }>,
  ): Promise<unknown> {
    return this.request(
      "POST",
      `/api/v1/public/projects/${encodeURIComponent(projectId)}/fields/validate`,
      { expected_fields: expectedFields },
    );
  }

  async addTests(projectId: string, testCases: unknown[]): Promise<unknown> {
    return this.request("POST", `/api/v1/public/projects/${encodeURIComponent(projectId)}/tests`, {
      test_cases: testCases,
    });
  }

  async runTests(projectId: string): Promise<unknown> {
    return this.request("POST", `/api/v1/public/projects/${encodeURIComponent(projectId)}/test-run`);
  }

  async publish(projectId: string, label?: string, name?: string): Promise<unknown> {
    const body: Record<string, string> = {};
    if (label !== undefined) body.label = label;
    if (name !== undefined) body.name = name;
    const hasBody = Object.keys(body).length > 0;
    return this.request("POST", `/api/v1/public/projects/${encodeURIComponent(projectId)}/publish`, hasBody ? body : undefined);
  }

  // -- Compound operations --

  /**
   * Generate rules then poll until complete, then run tests.
   * Mirrors the CLI's generate --poll + test workflow.
   */
  async generateAndTest(projectId: string, llmKey?: string, mode?: "fresh" | "refine"): Promise<unknown> {
    // 1. Trigger generation (mode="refine" → seed-from-existing incremental edit)
    const job = await this.generate(projectId, llmKey, mode) as Record<string, unknown>;
    const jobId = job.job_id as string;

    // 2. Poll until done
    const deadline = Date.now() + this.pollTimeoutMs;
    let rulesetId: string | undefined;

    let lastDetail = "";

    while (Date.now() < deadline) {
      const status = await this.getStatus(projectId) as Record<string, unknown>;
      const jobData = status.job as Record<string, unknown> | undefined;

      if (jobData) {
        const jobStatus = jobData.status as string;

        // Log progress changes to stderr so the MCP client can surface them.
        // Sanitise by default (strip control chars + cap length); full
        // fidelity only when AETHIS_MCP_VERBOSE=1.
        const pct = (jobData.progress_percent as number) ?? 0;
        const detail = (jobData.progress_detail as string) ?? "";
        if (detail && detail !== lastDetail) {
          lastDetail = detail;
          const verbose = process.env.AETHIS_MCP_VERBOSE === "1";
          const rendered = verbose ? detail : sanitizeProgressDetail(detail);
          process.stderr.write(`[aethis] ${pct}% — ${rendered}\n`);
        }

        if (jobStatus === "success") {
          rulesetId = (status.latest_ruleset_id ?? jobData.result_ruleset_id) as string | undefined;
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

    if (!rulesetId) {
      throw new AethisAPIError(504, `Generation timed out after ${this.pollTimeoutMs / 1000}s. The generation may still be running server-side. Retry after a delay.`);
    }

    // 3. Run tests
    const testResult = await this.runTests(projectId) as Record<string, unknown>;

    return {
      ruleset_id: rulesetId,
      ...testResult,
    };
  }
}
