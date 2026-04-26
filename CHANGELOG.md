# Changelog

## 0.2.3 (unreleased)

### Breaking Changes

- **`openai_key` parameter renamed to `anthropic_key`** on `aethis_generate`, `aethis_generate_and_test`, and `aethis_refine`. The old parameter name is still accepted for backwards compatibility but will be removed in a future release.

### Improvements

- **Better error messages on generation failure.** Failed jobs now surface classified error details (invalid key, rate limit, connection failure) instead of "unknown error".
- Sends both `X-Anthropic-Key` and `X-OpenAI-Key` headers for backwards compatibility with older API versions.

### Docs

- **Proof section updated to cite the Simpson et al. 2026 benchmark paper.** Replaced the pre-paper 11-scenario table (GPT-5.4-mini 82%, GPT-5.3 27%) with paper-backed figures from Table 8b of the published benchmark. Removed the 27% GPT-5.3 claim — the paper identifies that figure as a harness-configuration bug; the corrected value is 63.6%.
- **Proof section: add §6.10 LegalBench external-validation paragraph.** v3.8 of the paper adds external validation across 9 LegalBench tasks (949 held-out cases). Combined paired-binomial McNemar's: *p* < 0.001 vs Sonnet 4.6, *p* = 0.003 vs Opus 4.7, *p* < 0.001 vs GPT-5.4. Linked to the public LegalBench harness at `confidently-wrong-benchmark/legalbench/`.
- **Proof section: replaced 11-scenario subset table with v3.8 adversarial extension (§6.4.1).** The v3.7 11-scenario exception-chain table no longer differentiates current frontier models from the engine (GPT-5.4 default and low both 11/11, Opus 4.7 11/11). The Proof section now leads with the v3.8 adversarial extension (20 newly-authored scenarios; engine 20/20; Opus 4.7 18/20; GPT-5.4 default 19/20 with 0 reasoning tokens; Sonnet 4.6 19/20) and the shifting-ground argument from paper §6.5 Finding 6.

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
- **Authoring tools** (TDD workflow): `aethis_create_bundle`, `aethis_generate_and_test`, `aethis_add_guidance`, `aethis_refine`, `aethis_publish`, `aethis_archive_project`, `aethis_archive_bundle`
- HTTPS enforcement for remote hosts
- Exponential backoff with retry on 429/502/503/504
- Works with Claude Desktop, Claude Code, Cursor, and Windsurf

> Note: v0.1.0 used `aethis_create_ruleset` (renamed to `aethis_create_bundle`) and `aethis_project_status` (replaced by `aethis_list_projects`). These tools were removed in v0.2.x.
