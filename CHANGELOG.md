# Changelog

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
