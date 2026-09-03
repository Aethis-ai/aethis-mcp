---
status: reference
owner: paul
updated: 2026-09-03
topic: assessment
---

# Why did Registry verification fail after successful publication? — assessment

**Assessment date:** 2026-09-03

**Verdict:** **The verifier assumed Registry search results were flat, but the live API wraps each record under `entry.server`; version 0.17.3 was published successfully and the workflow result was false-red.**

**Prior-art disposition:** EXTEND

## Question

Why did release run 33751837480 fail its final Registry verification when the
publish step was green, and what other parsers share the same untested response
shape assumption?

## Verdict, expanded

The workflow queried the correct endpoint and exact identity, but compared
`entry.name` and `entry.version`. Live results expose those fields as
`entry.server.name` and `entry.server.version`; the outer entry contains `_meta`.
The repair moves this parsing into a tested script, checks that script out in the
verification job, and pins it with a fixture captured from the real response
envelope, eliminating the duplicated untestable inline parser.

## Source baseline

| Source | Version / commit / date | How inspected |
|---|---|---|
| `aethis-mcp` merged source | `5e86d76`, 2026-09-03 | Fresh `origin/main` worktree |
| GitHub Actions release | [run 33751837480](https://github.com/Aethis-ai/aethis-mcp/actions/runs/33751837480), 2026-09-03 | `gh run view 33751837480 --log-failed` |
| Official MCP Registry | live query, 2026-09-03 | `curl -fsS 'https://registry.modelcontextprotocol.io/v0/servers?search=aethis'` |

## Evidence

The live response returned one exact record at
`servers[0].server.name = io.github.Aethis-ai/aethis-mcp` and
`servers[0].server.version = 0.17.3`. Its official metadata reported
`status = active` and `isLatest = true`, with publication at
`2026-09-03T11:52:03.082199Z`. The workflow instead executed:

```javascript
(j.servers || []).find(x => x.name === expectedName && x.version === expectedVersion)
```

Sibling sweep:

```bash
rg -n --hidden --glob '!**/node_modules/**' --glob '!**/dist/**' \
  --glob '!**/.git/**' \
  'j\.servers|\.servers\s*\|\||servers\?\?|/v0/servers|registry\.modelcontextprotocol\.io' \
  aethis-mcp mintlify-docs aethis-cli aethis-sdk-python aethis-skills docs .github scripts
```

One genuine parser existed: `.github/workflows/release.yml`. The other matches
were the endpoint URL and prose/history in `docs/RELEASE.md`, not response
parsers. No sibling parser remains after the workflow delegates to
`scripts/find-registry-release.mjs`.

## Alternatives considered

- Increasing the retry duration cannot help because every valid response is
  interpreted with the wrong object shape.
- Accepting npm success as overall success would hide a genuine Registry gap.
- Updating the inline expression alone repairs the instance but leaves the
  response contract untested. A fixture-tested script is the class fix.

## Re-check trigger

Re-check when the official Registry changes the `/v0/servers` response schema or
the release workflow changes its discovery endpoint. The fixture-backed parser
test is the immediate regression trigger.

## Consequences

Tracked by [aethis-mcp#84](https://github.com/Aethis-ai/aethis-mcp/issues/84).
This repository has no local defect-shape catalogue; recording the new
"hand-written external response envelope without a fixture" shape and escape in
the workspace catalogue remains a separate workspace-level change under
submodule discipline. The next workspace docs-index regeneration will discover
this submodule assessment.
