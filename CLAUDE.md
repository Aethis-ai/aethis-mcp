# CLAUDE.md

Agent notes for `aethis-mcp`. Human-facing docs in [README.md](README.md) and [docs.aethis.ai/mcp-server/overview](https://docs.aethis.ai/mcp-server/overview).

## What this is

Node.js MCP server that exposes 24 tools for the Aethis platform so coding agents (Claude Code, Claude Desktop, Cursor, Windsurf) can call `aethis_decide`, `aethis_schema`, `aethis_explain`, `aethis_generate_and_test`, `aethis_publish`, etc. directly from a conversation. Published to npm as `aethis-mcp`.

Decision tools work with no API key. Authoring tools require `AETHIS_API_KEY` in the MCP client config.

The documented install path for end users is `aethis mcp install --target <client>` from [aethis-cli](../aethis-cli/) (added in aethis-cli v0.5.0, May 2026). The README's "Manual install" section (`claude mcp add ...` and per-client JSON snippets) is the fallback for users who don't have aethis-cli. When updating install instructions, keep the cli one-liner as the primary path.

## Dev loop

```bash
pnpm install
pnpm run build       # tsc compile
pnpm test            # vitest

# Run against a local aethis-core:
AETHIS_BASE_URL=http://localhost:8080 AETHIS_API_KEY=test node dist/server.js

# Or via npx once published:
npx aethis-mcp
```

## Architecture

- [src/server.ts](src/server.ts) — MCP transport wiring (stdio)
- [src/tools/](src/tools/) — one file per tool; each exports a name, JSONSchema params, and a handler that calls the appropriate `/api/v1/public/*` endpoint
- [src/client.ts](src/client.ts) — thin httpx-style wrapper with retries + `AETHIS_BASE_URL` / `AETHIS_API_KEY` config

The server-side HTTP targets are always on aethis-core; this package is a client shim. The 24 tools map 1:1 to public API endpoints plus a few MCP-ergonomics tools (e.g. `aethis_next_question` wraps an incremental decide loop).

## Gotchas

- **`AETHIS_BASE_URL` defaults to `https://api.aethis.ai`.** Override in the MCP client config, not your shell — the MCP server process doesn't inherit the invoking shell's environment.
- **Two keys, two places.** `AETHIS_API_KEY` (Aethis platform key) is for all Aethis tool calls. `ANTHROPIC_API_KEY` is forwarded per-request on `aethis_generate_and_test` so server-side generation can use the caller's quota rather than server-side credits. Both are set in the MCP client config; the server never stores them.
- **Slug resolution is client-side for `aethis_explain_failure`.** The REST endpoint doesn't yet resolve slugs on `/explain-failure` (tracked in aethis-core#51), so the MCP tool resolves slug → bundle_id via a `/bundles/{id}/schema` probe first. Don't break this without checking the upstream fix has landed.
- **Version bump rule.** Published npm package — bump `package.json` and update `CHANGELOG.md` on every change, per `.claude/rules/public-repos.md`.
- **Tool naming convention.** Every tool starts with `aethis_` to avoid collision with other MCP servers running in the same client. Keep it.

## Testing

[src/tools/*.test.ts](src/tools/) mocks the HTTP client and asserts the produced request shape. The full-stack integration tests live in a CI workflow that spins up a local aethis-core via Docker — don't reach that tier from unit tests.

## See also

- Public MCP docs: [docs.aethis.ai/mcp-server](https://docs.aethis.ai/mcp-server/overview)
- Tools reference (all 25): [docs.aethis.ai/mcp-server/tools](https://docs.aethis.ai/mcp-server/tools)
- Workspace operational index: [../docs/OPERATIONAL_INDEX.md](../docs/OPERATIONAL_INDEX.md)
