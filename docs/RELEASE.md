# Releasing `aethis-mcp`

The release pipeline (`.github/workflows/release.yml`) publishes `aethis-mcp` to
npm and to the official [MCP Registry](https://registry.modelcontextprotocol.io)
through a gated, evidence-producing flow. Publication is deliberately **owner-
approved** — the pipeline builds and verifies; a human approves each publish.

## Identity that must stay in agreement

| Where | Field | Source of truth |
|---|---|---|
| `package.json` | `version` | **the** version source of truth |
| `package.json` | `name` = `aethis-mcp`, `mcpName` = `io.github.Aethis-ai/aethis-mcp` | identity |
| `server.json` | `version`, `packages[].version` | derived from `package.json` |
| `server.json` | `name`, `packages[].identifier` | derived from `package.json` |
| `tool-inventory.json` | tool surface | generated from the server |

Keep them in sync with the checked-in helpers (also run in the test suite/CI):

```bash
npm run sync:server-json     # write server.json from package.json
npm run check:server-json    # CI: fail on drift
npm run gen:inventory        # regenerate tool-inventory.json
npm run check:inventory      # CI: fail on drift
```

## The pipeline (what runs, in order)

1. **build-artefact** (no credentials) — `npm ci && build && test`, verifies
   tag==version and that the generated artefacts are in sync, then
   `npm run build:artefact` produces, under `release-artefacts/`:
   - the exact `npm pack` tarball + its **sha256** (emitted as a job output),
   - a CycloneDX SBOM (`sbom.cdx.json`),
   - a `candidate.json` manifest (identity, digests, git commit, SBOM +
     inventory digests).
   The tarball sha256 is the immutable artefact the workspace **P10** gate pins
   before publication is approved.
2. **publish-npm** — protected environment `npm-publish` (named reviewer). Re-
   verifies the downloaded tarball's sha256 equals the build output and that the
   tag commit equals the built commit, then publishes the **exact tarball** via
   npm Trusted Publishing (OIDC). No `NODE_AUTH_TOKEN`.
3. **publish-registry** — separate protected environment `registry-publish`.
   Publishes `server.json` with `mcp-publisher` (pinned + sha256-verified) using
   GitHub OIDC for the case-sensitive `io.github.Aethis-ai` namespace. No static
   token.
4. **verify-publication** — queries npm and the official Registry for the exact
   name + version/integrity; a release **cannot** report success if either
   discovery fails.
5. **verify-fresh-install** — installs the exact version into a clean temp
   environment and compares the enumerated tools against `tool-inventory.json`.
6. **finalize** — cuts the GitHub Release and triggers the workspace sync.

All third-party actions are pinned by commit SHA. The pipeline runs only on a
version-tag push or manual dispatch — never on a branch push/merge — so a merge
can never publish.

## One-time owner setup (required before publishing)

1. **Protected environments with a required reviewer** — create both
   `npm-publish` and `registry-publish` GitHub Environments and add a required
   reviewer to each. (An unconfigured environment auto-creates *without*
   protection; the reviewer rule is the gate.)
2. **npm Trusted Publishing** — configure `aethis-mcp` on npm to trust this
   repo's `release.yml` workflow. No npm token is stored anywhere.
3. **MCP Registry namespace** — use the exact case-sensitive namespace
   `io.github.Aethis-ai` for this GitHub org/user (GitHub OIDC covers this repo's
   namespace). Do not lowercase the organization name: Registry authorization
   compares this identity exactly.

## Cutting a release

```bash
# 1. Bump version + CHANGELOG, sync derived artefacts, commit, land the PR.
npm version <patch|minor|major> --no-git-tag-version
npm run sync:server-json && npm run gen:inventory
# 2. After the release commit is on protected main, tag it (owner):
git tag "v$(node -p "require('./package.json').version")"
git push origin "v$(...)"
# 3. Approve each protected environment when GitHub prompts.
```

## Failure states & safe retry

The pipeline is designed so a failure leaves a **clear failed state, never a
false "submitted" success**. No secret is ever printed (OIDC only; tokens are
never echoed).

| Failure | Meaning | Safe retry |
|---|---|---|
| `build-artefact` red | tests/build/drift failed, or tag≠version | Fix on a branch, re-tag; nothing was published. |
| digest mismatch in `publish-npm` | the artefact changed between build and publish | Re-run the workflow from the tag; the build is deterministic. Do **not** hand-publish. |
| `publish-npm` OIDC/permission error | Trusted Publishing not configured | Configure it (owner setup #2), re-run. Never fall back to a static npm token. |
| `publish-npm` "version already exists" | npm already has this version | Bump the version and start a new release; npm versions are immutable. |
| `publish-registry` fails after npm succeeded | Registry publish failed; npm is live | Re-run **only** `publish-registry` (npm publish is idempotent-by-refusal). The release is **not** verified until the Registry lists it. |
| `verify-publication` red | npm or the Registry does not show the exact version | The release is **failed**, regardless of earlier green steps. Investigate propagation delay vs a real gap; the job already retries for ~2 min. |
| `verify-fresh-install` red | the installed tool surface ≠ `tool-inventory.json` | A real defect — do not announce the release. Fix and cut a new version. |

Because publication is two independent registries, treat a release as **done
only when `verify-publication` and `verify-fresh-install` are both green**.

## History: the earlier registry submission (#17)

Closed issue [aethis-mcp#17](https://github.com/Aethis-ai/aethis-mcp/issues/17)
recorded an earlier attempt to submit this server to the MCP Registry. That is an
**unverified historical submission, not proof of current discoverability**: at
the time this pipeline was built (2026-07-25) a live query of the official
Registry —

```
curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=aethis"
# => {"servers":[],"metadata":{"count":0}}
```

— returned **no Aethis result**. `verify-publication` exists precisely so
"submitted" can never again stand in for "discoverable": a release is verified
only when the Registry actually lists the exact `io.github.Aethis-ai/aethis-mcp`
version.
