# CLAUDE.md

Agent notes for `aethis-mcp`. Human-facing docs in [README.md](README.md) and [docs.aethis.ai/mcp-server/overview](https://docs.aethis.ai/mcp-server/overview).

## What this is

Node.js MCP server that exposes 27 tools for the Aethis platform so coding agents (Claude Code, Claude Desktop, Cursor, Windsurf) can call `aethis_decide`, `aethis_schema`, `aethis_explain`, `aethis_discover_rulesets`, `aethis_list_rulebooks`, `aethis_generate_and_test`, `aethis_publish`, etc. directly from a conversation. Published to npm as `aethis-mcp`.

Decision tools and `aethis_discover_rulesets` (the public-catalogue browser) work with no API key. Tenant-scoped tools (`aethis_list_projects`, `aethis_list_rulesets`, all authoring) require `AETHIS_API_KEY` in the MCP client config.

The documented install path for end users is `aethis mcp install --target <client>` from [aethis-cli](../aethis-cli/) (added in aethis-cli v0.5.0, May 2026). The README's "Manual install" section (`claude mcp add ...` and per-client JSON snippets) is the fallback for users who don't have aethis-cli. When updating install instructions, keep the cli one-liner as the primary path.

## Dev loop

```bash
pnpm install
pnpm run build       # tsc compile
pnpm test            # vitest

# Run against a local aethis-core:
AETHIS_BASE_URL=http://localhost:8080 AETHIS_API_KEY=test node dist/index.js

# Or via npx once published:
npx aethis-mcp
```

## Architecture

The server is a single monolithic module, not a per-tool file tree:

- [src/index.ts](src/index.ts) — everything MCP-facing in one file: the `main()` stdio transport wiring, the `createToolHandlers(client)` factory (every `aethis_*` handler), `registerTools()` / `registerPrompts()` that register them on the `McpServer`, the untrusted-content fencing helpers (`fenceUntrusted`, `UNTRUSTED_PREFACE`), and the output formatters (`formatTestResults`, `formatExplainFailure`, …). The package version is read from `package.json` as `PKG_VERSION`; `dist/index.js` is the published `bin`.
- [src/client.ts](src/client.ts) — `AethisClient`, a thin fetch wrapper with retries/backoff, base-URL validation, and one method per `/api/v1/public/*` endpoint (`AETHIS_BASE_URL` / `AETHIS_API_KEY` config).
- [src/credentials.ts](src/credentials.ts) — Aethis-API-key resolution (`resolveApiKey`) and per-call LLM-key resolution (`resolveLlmKey`, keychain/env/raw forms).
- [tests/](tests/) — vitest suites (`index.test.ts`, `server.test.ts`, `client.test.ts`, `credentials.test.ts`) that import the exported handlers/formatters and mock the HTTP client.

The server-side HTTP targets are always on aethis-core; this package is a client shim. The tools map 1:1 to public API endpoints plus a few MCP-ergonomics tools (e.g. `aethis_next_question` wraps an incremental decide loop).

## Gotchas

- **`AETHIS_BASE_URL` defaults to `https://api.aethis.ai`.** Override in the MCP client config, not your shell — the MCP server process doesn't inherit the invoking shell's environment.
- **Two keys, two places.** `AETHIS_API_KEY` (Aethis platform key) is for all Aethis tool calls. `ANTHROPIC_API_KEY` is forwarded per-request on `aethis_generate_and_test` so server-side generation can use the caller's quota rather than server-side credits. Both are set in the MCP client config; the server never stores them.
- **Passing the Anthropic key safely (v0.5+).** Authoring tools accept three forms in preferred order: `anthropic_key_env` (env-var name read at call time — keeps the raw value out of the MCP host's session JSONL), `anthropic_key_keychain` (macOS keychain reference `service:account` or just `account` defaulting to service `aethis-anthropic-key`), and `anthropic_key` (deprecated raw value, kept for backwards compatibility). `resolveLlmKey` in `src/credentials.ts` does the resolution; `MissingLlmKeyError` is what handlers throw when all forms are empty. The corresponding zod schema chunk is `llmKeyFields` in `src/index.ts` — reuse it on any new authoring tool. See README §"Passing your Anthropic key safely" for user-facing copy.
- **Untrusted-content fencing (GHSA-ph7q-r9q4-922g, v0.5+).** Tool output handed back to the LLM must wrap any API-supplied free-text field in an `<api_response>` fence via `fenceUntrusted(label, value)` (`src/index.ts`). The function appears immediately after `apiError`; the preface constant is `UNTRUSTED_PREFACE`. When adding a new handler that interpolates a server-returned natural-language field into `lines.push(...)`, fence it. Identifier-shaped fields (IDs, enum values, weights) don't need the treatment.
- **Slug resolution is client-side for `aethis_explain_failure`.** The REST endpoint doesn't yet resolve slugs on `/explain-failure` (tracked in aethis-core#51), so the MCP tool resolves slug → bundle_id via a `/bundles/{id}/schema` probe first. Don't break this without checking the upstream fix has landed.
- **Version bump rule.** Published npm package — bump `package.json` and update `CHANGELOG.md` on every change, per `.claude/rules/public-repos.md`.
- **Tool naming convention.** Every tool starts with `aethis_` to avoid collision with other MCP servers running in the same client. Keep it.

## Testing

Three tiers:

- **Mocked unit suites** (`tests/{index,client,credentials,server}.test.ts`) — mock the HTTP client and assert the produced request shape and the LLM-facing output. These are the fast PR gate; keep them mocked.
- **Drift suite** (`tests/drift.test.ts`) — runs in the PR gate (`npm test`) and nightly. Compares each of the 27 tools' zod input schemas against the **deployed staging OpenAPI document** (the oracle — no vendored schema copy). The one hand-maintained artefact is [`tests/tool-endpoint-map.ts`](tests/tool-endpoint-map.ts): the tool → engine-operation correspondence plus field renames (e.g. `force → force_unsafe`). **When you add, remove, or rename a tool or one of its input fields, update that map in the same change** — an unmapped tool or unclassified field fails the suite by design. PR runs tolerate a genuinely unreachable staging (loud warning); nightly (`DRIFT_NETWORK_REQUIRED=1`) fails red. Run locally: `npm run test:drift`.
- **Staging integration lane** (`tests/integration/`, nightly `staging-integration.yml`) — runs the **built** server as a subprocess with a freshly minted staging key and drives it over the real MCP protocol (`tools/list`, read-only core loop, `aethis_decide`, invalid-key negative path). Excluded from the default `npm test`; run with `npm run test:integration` and `CLERK_SECRET_KEY_DEV_TOOLS` + `CLERK_E2E_DX_USER_ID` set (mint path is Clerk dev-tools JWT → self-serve key on `staging.api.aethis.ai`, revoked in teardown). Staging only, never prod.

## See also

- Public MCP docs: [docs.aethis.ai/mcp-server](https://docs.aethis.ai/mcp-server/overview)
- Tools reference (all 27): [docs.aethis.ai/mcp-server/tools](https://docs.aethis.ai/mcp-server/tools)
- Workspace operational index: [../docs/OPERATIONAL_INDEX.md](../docs/OPERATIONAL_INDEX.md)
