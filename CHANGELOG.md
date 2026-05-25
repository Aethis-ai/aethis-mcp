# Changelog

## 0.7.2 (2026-05-26)

- **chore(server): tighten MCP instructions against decision extrapolation.** Adds a "Reporting decisions" section to the server `instructions` block (visible to every client model as part of its system prompt on connect). New rules forbid asserting facts that are not in the tool response, generalising a single-ruleset decision to a composite outcome, naming rulesets/rulebooks not yet observed in the session, and offering follow-up calls against unverified slugs. Triggered by a real user trace where a model summarising a `uk-fsm-child-eligibility` decision closed with an offer to run the broader `aethis/uk-fsm` rulebook "to get the complete household-level decision" — the rulebook exists but currently 422s on prod (empty `ruleset_refs`, see aethis-core#90), so the offer overstated what would actually happen. Advisory, not enforced — but client models reliably honour `instructions` blocks.

## 0.7.1 (2026-05-22)

- **docs(readme): v0.27.0 accuracy pass.** Three fixes for fresh-developer accuracy:
  - Documented `rulebook_id` as an alternative to `ruleset_id` on `aethis_decide` — mutually exclusive; composed-rulebook evaluation always requires an API key.
  - Quickstart example: corrected field name from `species` to `space.crew.species` (the actual field ID in the spacecraft-crew-certification ruleset).
  - Windsurf config path: corrected from `.windsurf/mcp.json` to `~/.codeium/windsurf/mcp_config.json` (canonical path per aethis-cli README).

## 0.7.0 (2026-05-22)

Add rulebook surface to `aethis_decide` — closes the converged-2-term
client-completeness gap for MCP. The tool now accepts either
`ruleset_id` (single ruleset) or `rulebook_id` (composed rulebook),
mutually exclusive. Mirrors `aethis-sdk-python` v0.5.0 and
`aethis-cli` `rulebooks decide`.

### Added

- `aethis_decide` tool accepts `rulebook_id` as an alternative to
  `ruleset_id`. Pass an opaque `rb_<id>` or a slug like
  `aethis/uk-fsm`. Composed-rulebook evaluation is always
  scope-gated by the engine — anonymous callers get HTTP 401.
- `AethisClient.decideRulebook(rulebookId, fieldValues, options?)` —
  parallel to `decide()`; sends `rulebook_id` in the `/decide` payload.

### Changed

- `aethis_decide` description and schema updated to reflect both
  paths. Tool validates that exactly one of `ruleset_id` / `rulebook_id`
  is provided.

### Requires

- aethis-core v0.27.0+ live on the target API for slug-form rulebook
  paths. The `rulebook_id` body field on `/decide` has been supported
  since aethis-core v0.18.x.

## 0.6.0 (2026-05-20)

Add optional `name` parameter to `aethis_publish` tool — lets clients
override the human-readable section name when publishing a ruleset.
Companion to aethis-core v0.18.0's `PublishRequest.name` field.

### Added

- `aethis_publish` tool now accepts an optional `name` parameter. When
  supplied, it overrides the section name stored on the ruleset (default
  is a titlecase of `section_id`, e.g. `"english_language"` →
  `"English Language"`). Section names are surfaced in rulebook
  responses so end users can see which sections compose a rulebook.
- `AethisClient.publish()` now accepts a third `name?: string` argument
  and includes it in the POST body when set.

### Tests

- `server.test.ts` — two new `aethis_publish` cases: forwarding `name`
  to the client and echoing it in output; confirming `name` is omitted
  when not provided.
- `client.test.ts` — two new `publish()` cases: body contains `name`
  when provided; body is absent when neither `label` nor `name` is set.

## 0.5.1 (2026-05-20)

Surface the human-readable section `name` in `aethis_list_rulesets` and
`aethis_discover_rulesets` tool output. The engine has been returning
`name` on both `RulesetSummary` (public catalogue) and `RulesetListItem`
(project-scoped) responses since aethis-core v0.18.0; the MCP server
already forwarded every API field verbatim via `JSON.stringify`, so the
data was reaching the LLM, but the tool descriptions didn't advertise
the field. The descriptions now mention `name` so models know to read
and surface it to users (e.g. "Knowledge of language and life in the
UK" instead of just `b_123…`).

### Changed

- `aethis_list_rulesets` tool description now mentions the
  human-readable `name` field returned alongside ruleset ID, status,
  version, field count, and rule count.
- `aethis_discover_rulesets` tool description now lists `name` in the
  documented response shape.

### Tests

- `aethis_list_rulesets` and `aethis_discover_rulesets` server tests
  assert the `name` field passes through to the LLM-facing JSON output.

## 0.5.0 (2026-05-19)

Security hardening pass. Bundles the v0.5 security review fixes into one
release. Closes #33, #34, #35; addresses GHSA-ph7q-r9q4-922g (disclosed
on publish).

### Security

- **GHSA-ph7q-r9q4-922g** (high) — prompt injection via unsanitised API
  response text in `aethis_explain_failure`. `formatExplainFailure` now
  wraps every API-supplied free-text field (`diagnosis`, `dsl_hint`,
  criterion `title` / `rule_text` / `source_refs`) in an
  `<api_response>` fence and prepends a one-line preface telling the
  model the contents are data, not instructions. Literal closing tags
  inside payloads are neutralised so a payload cannot break out of the
  fence. The same `fenceUntrusted` helper has been applied to other
  free-text API surfaces (`aethis_next_question`,
  `aethis_discover_sections`, `aethis_refine_sections`,
  `aethis_discover_fields`, `formatTestResults`).
- **#33** — `src/credentials.ts` now resolves the credentials file via
  `fs.realpath` and asserts the canonical path sits under `$HOME` (or
  under an absolute `XDG_CONFIG_HOME` the user controls); refuses with
  `UnsafeCredentialsError` otherwise. Permissions check now matches
  `ssh` / `aws-cli` behaviour: any group/other bit set on the
  credentials file → refuse with `Permissions 0NNN ... too open. Run:
  chmod 600 <path>`.
- **#34** — `progress_detail` from the polling API is sanitised before
  it lands on stderr: control characters are stripped (TAB preserved)
  and the body is capped at 120 visible chars + `…`. Full-fidelity
  output is gated behind `AETHIS_MCP_VERBOSE=1`. Prevents the server
  from injecting terminal escape sequences or PII into anything that
  captures the MCP process stderr.

### Changed

- **#35** — Authoring tools now accept safer per-call key forms.
  - New `anthropic_key_env: string` — name of an env var the MCP server
    reads at call time. **Preferred.** The raw value never appears in
    the tool call so it does not land in the MCP host's session
    transcript JSONL.
  - New `anthropic_key_keychain: string` — macOS keychain reference,
    either `service:account` or just `account` (service defaults to
    `aethis-anthropic-key`).
  - Raw `anthropic_key` / `openai_key` arguments remain accepted for
    backwards compatibility but are now marked `[sensitive — do not
    echo or log]` in the schema; deprecated in tool descriptions.
  - `resolveLlmKey` (exported from `src/credentials.ts`) consolidates
    the resolution chain and throws `MissingLlmKeyError` if every form
    is empty.
  - Applies to `aethis_generate_and_test`, `aethis_refine`,
    `aethis_discover_fields`, `aethis_refine_fields`,
    `aethis_discover_sections`, `aethis_refine_sections`.

### Docs

- README: new "Passing your Anthropic key safely" section showing env /
  keychain forms first; raw-key form marked deprecated.
- CLAUDE.md: new gotchas covering safe-key resolution and the
  untrusted-content fencing helper.

## 0.4.4 (2026-05-12)
- docs: surface `aethis-skills` as the optional agent workflow layer on top of MCP.

## 0.4.3 (2026-05-11)
- fix: align `package.json` repository metadata with GitHub provenance so npm Trusted Publishing can verify the package source.

## 0.4.2 (2026-05-11)
- fix: pin `zod` to v3 so the MCP SDK tool registration types match the build-time schema shape; `npm publish` now runs the `prepublishOnly` TypeScript build successfully.

## 0.4.1 (2026-05-10)
- docs: fix stale `bundle`/`bundle_id`/`aethis_create_bundle` terminology in `docs/demo-construction-insurance.md` and `docs/agentic-decision-systems.md` — these files were not caught by the v0.3.0 rename sweep. All references now use `ruleset`/`ruleset_id`/`aethis_create_ruleset`
- chore: bump `server.json` version to 0.4.1 (was lagging behind `package.json`)
- security: regenerate `package-lock.json` — bumps `hono` 4.12.12 → 4.12.18, `fast-uri` 3.1.0 → 3.1.2, `ip-address` 10.1.0 → 10.2.0, `postcss` 8.5.8 → 8.5.14; clears all 6 open Dependabot alerts (closes #19)

## 0.4.0 (2026-05-10)
- feat: new `aethis_discover_rulesets` tool — lists the cross-tenant
  public showcase catalogue (no authentication required). Mirrors the
  no-auth policy of `aethis_decide` / `aethis_schema` /
  `aethis_explain`. Returns slug, ruleset_id, description, field_count,
  rule_count for each entry; the slug or ruleset_id can then be passed
  to the existing decision tools. Distinct from `aethis_list_rulesets`,
  which remains tenant-scoped and authenticated. Tool count: 24 → 25.
- feat: `client.discoverRulesets(limit, offset)` wrapping
  `GET /api/v1/public/rulesets`.
- docs: `aethis-decide` prompt and server-instructions now point at
  `aethis_discover_rulesets` for first-time discovery (no key) before
  falling back to `aethis_list_projects` → `aethis_list_rulesets` for
  authenticated tenant browsing.

## 0.3.5 (2026-05-07)
- docs: surface the test-gate guarantee — `aethis_publish` refuses to publish a ruleset with a failing test, derived from positioning bible §5/§7. Strengthens the existing Note to an Important callout and annotates the publish line in the four-stage workflow
- docs: drop `force=true` mention from troubleshooting — surfacing the override on the public README undermines the "cannot be published with failing tests" guarantee. The API parameter remains in the engine; whether to deprecate it is tracked separately
- docs: fix tool count (25 → 24); tools table sums to 24 (5 + 7 + 8 + 2 + 2). Fixed in README header and in CLAUDE.md

## 0.3.4 (2026-05-07)
- docs: link to docs.aethis.ai/agents/onboarding from Install section

## 0.3.3 (2026-05-06)
- docs: restructure README as dev MCP docs — Install / Quick start / Tools / Setup leads, positioning sections (Problem, Accuracy, When to use this, How it works, Example walkthrough) removed; their content belongs in docs.aethis.ai or the benchmarks repo
- docs: trim narrative paragraphs across Quick start, Conversational eligibility, and Authoring; collapse repeated Tips into terse callouts
- docs: header tagline rewritten to a single factual line; link bar updated to the new structure

## 0.3.2 (2026-05-06)
- docs: normalise tone to documentation register — replace argumentative Proof section with one-liner accuracy claim, neutralise example framing, trim sales-y bullets in When to use this
- docs: add private-beta callout for authoring tools (decision tools remain public, no key required)

## 0.3.1 (2026-05-06)

- docs: align README with positioning bible — promote 225-scenario accuracy framing
- docs: add aethis-bible: markers to derived copy blocks
- docs: fix latency claim to <1ms (was <5ms)
- fix: replace deprecated "rule bundle" terminology with "ruleset"

## 0.3.0 (2026-05-05)

- **Breaking**: renamed the public *bundle* concept to *ruleset* throughout the MCP tool set, to match the `aethis-core 0.10.0` API contract. The compiled rule artefact is now called a **ruleset** in every tool name, parameter, and prose description. Specifically:
  - Tools: `aethis_create_bundle` → `aethis_create_ruleset`, `aethis_list_bundles` → `aethis_list_rulesets`, `aethis_archive_bundle` → `aethis_archive_ruleset`
  - Parameters: every `bundle_id` → `ruleset_id`
  - JSON keys returned to the agent: `bundle_id`/`latest_bundle_id`/`bundle_version`/`deprecated_bundles`/`result_bundle_id`/`bundle_refs` → `ruleset_id` etc.
  - URL paths inside the client: `/bundles/...` → `/rulesets/...`
- This release **requires `aethis-core 0.10.0` or newer.** Older engines respond at the legacy `/bundles/*` paths with `bundle_id` JSON keys; this client expects `/rulesets/*` and will 404. Pin `aethis-mcp@0.2.6` if you need to keep working against an older engine until you can deploy.
- **MCP tool renames are part of the public LLM-facing contract.** Coding agents that have learnt the old tool names (`aethis_list_bundles` etc.) from training data will get "no such tool" errors and need to retry against the new names. Tool descriptions explicitly call out the new naming so the LLM picks it up on first read.

## 0.2.6 (2026-05-03)

- Docs: replaced two stale `aethis.ai/sign-up` request-access pointers in the README authoring section with `aethis.ai/developer-access`. After the Clerk cutover, `/sign-up` serves the Clerk SignUp form for invitees rather than the Notion request-access form. No code or behaviour changes.

## 0.2.5 (2026-05-01)

- Docs: README Quick start now leads with `aethis mcp install --target all` (via [aethis-cli](https://github.com/Aethis-ai/aethis-cli) v0.5.0+). The manual `claude mcp add` and per-client JSON tabs are demoted to "Manual install" beneath. Setup section gains a **Keys & security** subsection covering `AETHIS_API_KEY` vs `ANTHROPIC_API_KEY` placement (MCP client config, not shell), rotation workflow (`aethis account generate` + `aethis account revoke`), and multi-machine guidance.
- Discoverability: `package.json` `keywords` extended with `regulation`, `policy`, `eligibility-check`, `deterministic-decision` — matches the highest-intent search terms used by developers in regulated domains. Existing keywords retained.
- CLAUDE.md updated to note the `aethis mcp install` install path so future contributors don't re-document the manual JSON as primary.

No code or behaviour changes.

## 0.2.4 (2026-04-28)

First version published to npm since 0.2.2. The `v0.2.3` tag exists in git but predates the publish workflow — it never reached npm. This release rulesets all work since 0.2.2.

### Registry

- **MCP Registry submission ready.** Added `mcpName: io.github.aethis-ai/aethis-mcp` to `package.json` and a top-level `server.json` declaring the npm package, transport, and environment variables. Submit via `mcp-publisher` after `npm publish`.

### Breaking Changes

- **`openai_key` parameter renamed to `anthropic_key`** on `aethis_generate`, `aethis_generate_and_test`, and `aethis_refine`. The old parameter name is still accepted for backwards compatibility but will be removed in a future release.

### Improvements

- **Better error messages on generation failure.** Failed jobs now surface classified error details (invalid key, rate limit, connection failure) instead of "unknown error".
- Sends both `X-Anthropic-Key` and `X-OpenAI-Key` headers for backwards compatibility with older API versions.
- **`aethis_explain_failure` clarification.** Tool docs now note that `ruleset_id` must be the concrete ID from a `/decide` envelope; slugs are not yet resolved on this endpoint (tracked in aethis-core#51).

### Docs

- **Proof section updated to cite the Simpson et al. 2026 benchmark paper.** Replaced the pre-paper 11-scenario table (GPT-5.4-mini 82%, GPT-5.3 27%) with paper-backed figures from Table 8b of the published benchmark. Removed the 27% GPT-5.3 claim — the paper identifies that figure as a harness-configuration bug; the corrected value is 63.6%.
- **Proof section: add §6.10 LegalBench external-validation paragraph.** v3.8 of the paper adds external validation across 9 LegalBench tasks (949 held-out cases). Combined paired-binomial McNemar's: *p* < 0.001 vs Sonnet 4.6, *p* = 0.003 vs Opus 4.7, *p* < 0.001 vs GPT-5.4. Linked to the public LegalBench harness at `confidently-wrong-benchmark/legalbench/`.
- **Proof section: replaced 11-scenario subset table with v3.8 adversarial extension (§6.4.1).** The v3.7 11-scenario exception-chain table no longer differentiates current frontier models from the engine (GPT-5.4 default and low both 11/11, Opus 4.7 11/11). The Proof section now leads with the v3.8 adversarial extension (20 newly-authored scenarios; engine 20/20; Opus 4.7 18/20; GPT-5.4 default 19/20 with 0 reasoning tokens; Sonnet 4.6 19/20) and the shifting-ground argument from paper §6.5 Finding 6.
- **Use `aethis/construction-all-risks` slug in CAR proof example** for stable URL across ruleset regenerations.
- **Invite-only beta messaging** replaces "rolling out now" framing throughout README — explicit approval-gated framing aligned with current onboarding.
- **`docs.aethis.ai` badge** added to README.

### Internal

- Added `.github/workflows/publish.yml` (provenance via OIDC + `NPM_TOKEN`) so future tag pushes auto-publish.
- Added Claude PR review workflow (dry-run mode).
- Added internal `CLAUDE.md` for agent onboarding.

## 0.2.2 (2026-04-14)

### New Tools

- **`aethis_add_domain_guidance`** — Add cross-section guidance hints at domain level (e.g. `uk_citizenship`). Applies automatically to all projects in the domain during generation.
- **`aethis_list_domain_guidance`** — List all active domain-level guidance hints.
- **`aethis_list_guidance`** — List all guidance hints accumulated for a project. Use before adding new guidance to avoid duplicates.
- **`aethis_explain_failure`** — Diagnose a failing test case. Returns criterion statuses with DSL metadata and a targeted fix hint.

### Improvements

- **`aethis_add_guidance` now accepts `process_type`** (`"rule_generation"` | `"field_extraction"`). Use `field_extraction` for field design principles (solicitor navigation, raw-facts principle). Defaults to `"rule_generation"`.
- **`aethis_add_domain_guidance` accepts `notes`** — SME commentary or legislation provenance stored on the hint. Never sent to the LLM.
- Two-level hint retrieval: generation now fetches domain-level hints (cross-section) alongside project-level hints in a single pass.

## 0.2.1 (2026-04-09)

### New Tools

- **`aethis_discover_fields`** — Discover input fields from source text. Returns field names, types, and completeness assessment. Call before writing test cases.
- **`aethis_refine_fields`** — Iterate on field discovery with targeted feedback.

### Improvements

- Added `aethis-author` and `aethis-decide` MCP prompts for compatible clients (Claude Desktop, Cursor, VS Code Copilot).

## 0.1.0 (2026-04-05)

Initial release.

### Features

- **Decision tools**: `aethis_schema`, `aethis_decide`, `aethis_next_question`, `aethis_explain`
- **Discovery tools**: `aethis_list_projects`
- **Authoring tools** (TDD workflow): `aethis_create_ruleset`, `aethis_generate_and_test`, `aethis_add_guidance`, `aethis_refine`, `aethis_publish`, `aethis_archive_project`, `aethis_archive_ruleset`
- HTTPS enforcement for remote hosts
- Exponential backoff with retry on 429/502/503/504
- Works with Claude Desktop, Claude Code, Cursor, and Windsurf

> Note: v0.1.0 used `aethis_create_ruleset` (renamed to `aethis_create_ruleset`) and `aethis_project_status` (replaced by `aethis_list_projects`). These tools were removed in v0.2.x.
