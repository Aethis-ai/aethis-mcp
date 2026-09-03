---
status: reference
owner: paul
updated: 2026-09-03
topic: assessment
---

# Why did the MCP Registry reject the 0.17.2 release? — assessment

**Assessment date:** 2026-09-03  
**Verdict:** **The release used a consistently generated but incorrectly lowercased GitHub namespace; the Registry authorizes the exact case-sensitive owner `Aethis-ai`.**  
**Prior-art disposition:** EXTEND

## Question

Why did the official MCP Registry return HTTP 403 after npm had successfully
published `aethis-mcp@0.17.2`, which sibling references share the defect, and
what gate prevents another wrong-but-internally-consistent identity?

## Verdict, expanded

The Registry's GitHub OIDC login granted `io.github.Aethis-ai/*`, while
`server.json` attempted to publish `io.github.aethis-ai/aethis-mcp`. The existing
drift checks verified agreement between derived artefacts and `package.json`, so
they propagated the same wrong value rather than comparing it with the external
case-sensitive identity. The structural repair pins every release surface to one
literal canonical value in a deterministic test.

## Source baseline

| Source | Version / commit / date | How inspected |
|---|---|---|
| `aethis-mcp` merged source | `ab968ad0c30d4dd163a259395e35f87b9735e490`, 2026-09-03 | Fresh `origin/main` worktree; `rg` sweep and generated artefact checks |
| GitHub Actions release | [run 33750991238](https://github.com/Aethis-ai/aethis-mcp/actions/runs/33750991238), 2026-09-03 | `gh run view 33750991238 --log-failed` |
| MCP Registry publisher | `mcp-publisher` 1.8.0 | Exact pinned binary and checksum from `.github/workflows/release.yml` |
| Mintlify downstream | workspace checkout, 2026-09-03 | Cross-repo `rg` sweep; classified but not changed in this repo PR |

## Evidence

Observed live failure:

```text
403 Forbidden
You have permission to publish: io.github.Aethis-ai/*.
Attempting to publish: io.github.aethis-ai/aethis-mcp.
```

The source sweep was:

```bash
rg -n --hidden --glob '!**/node_modules/**' --glob '!**/dist/**' \
  --glob '!**/.git/**' --glob '!**/pnpm-lock.yaml' \
  'io\.github\.aethis-ai/aethis-mcp|io\.github\.aethis-ai' \
  aethis-mcp mintlify-docs
```

It found 15 unique source references: eleven in `aethis-mcp` and four in
`mintlify-docs`.

Current, genuine MCP siblings (ten):

- `package.json`: canonical `mcpName` input.
- `server.json`: generated Registry publication identity.
- `tool-inventory.json`: generated verification identity.
- `.github/workflows/release.yml`: two namespace comments and the exact
  post-publication lookup name.
- `docs/RELEASE.md`: identity table, OIDC description, owner setup, and final
  discovery contract.

Historical MCP match (one): `CHANGELOG.md` records the identity shipped in the
0.5.1 release. It is factual release history, not a current configuration or
instruction, and remains unchanged.

Current downstream Mintlify siblings (three) are
`reference/capabilities.mdx`, `generated/capability-inventory.json`, and
`scripts/_test_check_capability_claims.py`. They require a separate
`mintlify-docs` PR because this repository cannot atomically change another
repo's source and generated documentation. Its changelog mirror is historical
and remains factual.

## Alternatives considered

- Making GitHub organization membership public cannot fix this response: OIDC
  already authenticated and explicitly granted the correct-case namespace.
- Lowercasing the owner in Registry configuration is not available to this
  workflow and would contradict the permission the Registry returned.
- Extending only the existing parity check is insufficient if all derived files
  agree on another wrong identity. The added test compares every release surface
  with the externally granted canonical literal.

## Re-check trigger

Re-check if the GitHub organization is renamed, the Registry changes GitHub OIDC
namespace normalization, or `.github/workflows/release.yml` changes publisher
authentication. The deterministic identity test is the immediate regression
trigger.

## Consequences

Tracked by [aethis-mcp#82](https://github.com/Aethis-ai/aethis-mcp/issues/82).
The repo has no local defect-shape catalogue, so adding this new class to the
workspace `.claude/defect-shapes.md` and recording the escape in
`docs/qa/ESCAPES.md` must be a separate workspace-level PR under submodule
discipline. Likewise, the workspace-generated `docs/INDEX.md` cannot be updated
inside this submodule PR; its next workspace regeneration will discover this
assessment. The Mintlify siblings require their own downstream PR.
