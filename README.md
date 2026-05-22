<div align="center">

# aethis-mcp

MCP server for the Aethis decision engine. Compile legislation, policy, contracts, and regulation into deterministic logic — same input, same answer, every time, with a full audit trail.

[![npm version](https://img.shields.io/npm/v/aethis-mcp.svg)](https://www.npmjs.com/package/aethis-mcp)
[![Docs](https://img.shields.io/badge/docs-docs.aethis.ai-blue)](https://docs.aethis.ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Install](#install) · [Skills](#skills) · [Quick start](#quick-start) · [Tools](#tools) · [Setup](#setup) · [Authoring](#authoring-private-beta) · [DSL](#dsl-capabilities) · [Troubleshooting](#troubleshooting)

</div>

---

## Install

> **Authoring is in private beta.** Decision tools (`aethis_decide`, `aethis_schema`, `aethis_explain`, `aethis_next_question`) are public — no key required. Authoring tools (rule generation, test refinement, publishing) require an invite. Request access at [aethis.ai/developer-access](https://aethis.ai/developer-access).

**Recommended — one command via [aethis-cli](https://github.com/Aethis-ai/aethis-cli):**

```bash
uv tool install aethis-cli
aethis mcp install --target all
```

Wires the server into claude-code, cursor, claude-desktop, or windsurf. Idempotent. Restart your editor to pick up the change. Re-run after `aethis account generate` rotates a key. Full options: `aethis mcp install --help`.

**Manual install:**

```bash
claude mcp add aethis -- npx -y aethis-mcp
```

For Cursor / Claude Desktop / Windsurf manual config, see [Setup](#setup).

> Onboarding an AI coding agent end-to-end? See [docs.aethis.ai/agents/onboarding](https://docs.aethis.ai/agents/onboarding) — install + verify + auth + workflow patterns in one page.

---

## Skills

After the MCP server is installed, add reusable agent workflows with [`aethis-skills`](https://github.com/Aethis-ai/aethis-skills):

```bash
npx skills add Aethis-ai/aethis-skills
```

The skills package provides workflows for policy-to-ruleset authoring, test/refine/publish loops, decisions with trace, and regression comparison. It calls the MCP tools in this package; it does not replace the MCP server.

---

## Quick start

```
aethis_decide({
  ruleset_id: "aethis/spacecraft-crew-certification",
  field_values: { "space.crew.species": "Vogon" },
  include_trace: true
})
```

```json
{
  "decision": "not_eligible",
  "fields_provided": 1,
  "fields_evaluated": 11,
  "trace": {
    "species_check": "FAIL — species is 'Vogon' (disqualifying, Section 3)"
  }
}
```

Public rulesets work without a key. Browse: `aethis_discover_rulesets({})` or [docs.aethis.ai](https://docs.aethis.ai).

Engine determinism + accuracy benchmarks: [Aethis-ai/confidently-wrong-benchmark](https://github.com/Aethis-ai/confidently-wrong-benchmark).

---

## Tools

25 tools across five groups.

| Group | Access | Tools |
|-------|--------|-------|
| **Decision** | public | `aethis_decide`, `aethis_schema`, `aethis_next_question`, `aethis_explain`, `aethis_explain_failure` |
| **Discovery — public catalogue** | public | `aethis_discover_rulesets` |
| **Discovery — your tenant** | private beta | `aethis_list_projects`, `aethis_list_rulesets` |
| **Authoring — sections & fields** | private beta | `aethis_discover_sections`, `aethis_refine_sections`, `aethis_validate_sections`, `aethis_set_field_spec`, `aethis_discover_fields`, `aethis_refine_fields`, `aethis_validate_fields` |
| **Authoring — generation** | private beta | `aethis_create_ruleset`, `aethis_add_guidance`, `aethis_list_guidance`, `aethis_generate_and_test`, `aethis_refine`, `aethis_publish`, `aethis_add_domain_guidance`, `aethis_list_domain_guidance` |
| **Management** | private beta | `aethis_archive_project`, `aethis_archive_ruleset` |

### Workflows

**Evaluate eligibility (2 calls):**

```
aethis_schema(ruleset_id)          → fields needed
aethis_decide(ruleset_id, fields)  → eligible / not_eligible / undetermined
```

Pass `include_trace: true` for the per-criterion evaluation trail. Pass `include_explanation: true` for human-readable rule descriptions.

`aethis_decide` accepts either `ruleset_id` (single ruleset, may be public) or `rulebook_id` (composed multi-ruleset rulebook) — the two are mutually exclusive. Rulebook decide always requires an API key (`AETHIS_API_KEY`); anonymous callers get HTTP 401.

**Conversational eligibility (next-question routing):**

```
aethis_next_question(ruleset_id, field_values)
```

Returns the most informative remaining question and the `optimal_path` of remaining questions. Call again after each answer; the engine recomputes from the updated state. Stops when a decision is reachable.

**Authoring** (private beta): see [Authoring](#authoring-private-beta).

### Prompts

| Prompt | Description |
|--------|-------------|
| `aethis-author` | Step-by-step TDD authoring workflow |
| `aethis-decide` | Decision workflow guide; accepts optional `ruleset_id` |

---

## Setup

Decision tools work with no key. Add `AETHIS_API_KEY` for authoring access (private beta).

### Claude Code

```bash
# Decision tools only
claude mcp add aethis -- npx -y aethis-mcp

# With authoring access
claude mcp add aethis -e AETHIS_API_KEY=<your-key> -- npx -y aethis-mcp
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "aethis": {
      "command": "npx",
      "args": ["-y", "aethis-mcp"]
    }
  }
}
```

For authoring, add `"env": { "AETHIS_API_KEY": "<your-key>" }`.

### Cursor / Windsurf

Add to `~/.cursor/mcp.json` or `~/.codeium/windsurf/mcp_config.json` (same JSON shape).

### Keys

- `AETHIS_API_KEY` (`ak_live_...`) — Aethis platform key. **Set in the MCP client config**, not your shell — the MCP server doesn't inherit shell env. Mint with `aethis login` or via the dashboard.
- `ANTHROPIC_API_KEY` — forwarded per-request to `aethis_generate_and_test`. Used per-call, never stored. See [Passing your Anthropic key safely](#passing-your-anthropic-key-safely) below — prefer the env-var or keychain reference forms over passing the raw key as a tool argument.
- Rotate via `aethis account generate` + `aethis account revoke <key_id>`. Mint one key per machine for surgical revocation.

### Passing your Anthropic key safely

Authoring tools (`aethis_generate_and_test`, `aethis_refine`, `aethis_discover_fields`, `aethis_refine_fields`, `aethis_discover_sections`, `aethis_refine_sections`) need an Anthropic API key per call. Three accepted forms — listed in **preferred order**:

1. **`anthropic_key_env`** (recommended). Name of an env var (set in the MCP client config) that holds the key. The raw value never appears in the tool call payload, so it does not land in the MCP host's session transcript on disk.

   ```jsonc
   // claude_desktop_config.json
   {
     "mcpServers": {
       "aethis": {
         "command": "npx",
         "args": ["aethis-mcp"],
         "env": {
           "AETHIS_API_KEY": "ak_live_...",
           "ANTHROPIC_API_KEY": "sk-ant-..."   // never echoed back to the LLM
         }
       }
     }
   }
   ```

   ```
   aethis_generate_and_test({ project_id, anthropic_key_env: "ANTHROPIC_API_KEY" })
   ```

2. **`anthropic_key_keychain`** (macOS). A keychain reference — either `"account"` (service defaults to `aethis-anthropic-key`) or `"service:account"`. Store the key once with `security add-generic-password -U -s aethis-anthropic-key -a my-anthropic -w 'sk-ant-...'`, then call:

   ```
   aethis_generate_and_test({ project_id, anthropic_key_keychain: "my-anthropic" })
   ```

3. **`anthropic_key`** (deprecated). Pass the raw key as a tool argument. Accepted for backwards compatibility, but the raw value is written verbatim to the host's session transcript JSONL on disk. If a key was ever passed this way, rotate it before relying on the safer forms.

---

## Authoring (private beta)

> Authoring requires an invite. [Request access](https://aethis.ai/developer-access). Decision tools (above) are public.

Three-phase workflow. Phases 1–2 are for multi-section domains; skip them for single-section rules and go straight to Phase 3.

### Phase 1 — Section discovery

```
aethis_discover_sections({ domain, sources: [{ name, content }, ...] })
aethis_validate_sections({ domain, expected_sections, discovered_sections })
aethis_refine_sections({ domain, feedback, sources })
```

### Phase 2 — Field vocabulary

```
aethis_set_field_spec({
  project_id,
  expected_fields: [{ key, sort, enum_values? }, ...]
})
aethis_discover_fields({ project_id })           // auto-validates against the spec if set
aethis_refine_fields({ project_id, feedback })
aethis_validate_fields({ project_id, expected_fields })
```

### Phase 3 — Generate, test, publish

```
aethis_create_ruleset({
  name, section_id, domain?, source_text,
  test_cases: [{ name, field_values, expected_outcome }, ...]
})
aethis_generate_and_test({ project_id })
aethis_refine({ project_id, feedback })          // iterate until tests pass
aethis_publish({ project_id })                   // refuses if tests fail; returns ruleset_id on success
```

### Guidance

Targeted hints without regenerating, plus cross-section principles for a domain:

```
aethis_add_guidance({ project_id, guidance_text, process_type })
aethis_list_guidance({ project_id })

aethis_add_domain_guidance({ domain, guidance_text, process_type, notes? })
aethis_list_domain_guidance({ domain })
```

`process_type` is `rule_generation` (default) or `field_extraction`.

### Diagnose a failing test

```
aethis_explain_failure({
  ruleset_id, field_values, expected_outcome, test_name
})
// Returns criterion statuses, the failing rule, and a targeted fix hint.
```

> [!IMPORTANT]
> **Tests are the publish gate.** `aethis_publish` refuses to publish a ruleset with a failing test. SMEs write the tests; the LLM generates the rules from source text + guidance; the platform refuses to ship rules that don't satisfy the tests. Better tests = faster convergence.

> [!IMPORTANT]
> Anthropic key required for authoring. Prefer `anthropic_key_env` (env var name) or `anthropic_key_keychain` (macOS keychain ref) over the raw `anthropic_key` argument — see [Passing your Anthropic key safely](#passing-your-anthropic-key-safely). Used per-request, never stored server-side; the raw form, however, lands in the MCP host's session transcript on disk.

> [!IMPORTANT]
> DATE fields use integer ordinals (`date.toordinal()`), not ISO strings. `2025-04-13` = `739354`. Quick conversion: `python3 -c "from datetime import date; print(date(2025,4,13).toordinal())"`.

---

<details>
<summary><strong>DSL capabilities</strong></summary>

### Field types

| Type | Description |
|------|-------------|
| `Bool` | True / false |
| `Int` | Integer (counts, money as pence, percentages as integers) |
| `Enum` | Closed set of named values |
| `Date` | Integer ordinal — `date.toordinal()` |
| `Duration` | Integer days |
| `String` | Free text — prefer `Enum` for known sets |

### Operators

| Category | Operators |
|----------|-----------|
| Logic | `AND`, `OR`, `NOT`, `IMPLIES` |
| Comparison | `=`, `≠`, `<`, `≤`, `>`, `≥` |
| Membership | `IN [v1, v2, ...]` |
| Arithmetic | `+`, `−` for `Int`/`Date`; `*` for `Int` |
| Aggregation | `min(...)`, `max(...)` |

### Helpers

- `days_between(date_a, date_b)` → `Int`
- `min(a, b, ...)`, `max(a, b, ...)` → `Int`
- Constant arithmetic folded at authoring time (`5 * 365` → `1825`)

### Not supported

- Division between runtime field values
- Weighted scoring or probabilistic outcomes
- Lists as field values (use pre-aggregated `Int` / `Bool`)
- More than 3 outcome tiers (`eligible` / `not_eligible` / `undetermined`)

</details>

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `API key is required` | `AETHIS_API_KEY` not set (authoring) | Configure in MCP client settings, not shell profile |
| `X-Anthropic-Key header is required` | Missing Anthropic key | Pass `anthropic_key_env` (preferred) / `anthropic_key_keychain` / `anthropic_key` on the tool call. See [Passing your Anthropic key safely](#passing-your-anthropic-key-safely). |
| `Ruleset not found` (404) | Wrong ID or archived | `aethis_list_projects` → `aethis_list_rulesets` |
| `Rate limit exceeded` (429) | Daily limit | Client retries automatically. [eng@aethis.ai](mailto:eng@aethis.ai) for higher tier |
| `Cannot publish: tests failing` | Tests don't pass | `aethis_refine` until all tests pass |
| Generation timeout (504) | Server still generating (5–15 min normal) | Wait, then `aethis_list_rulesets({ project_id })` to check. Don't re-trigger |
| `Expected an integer for <field>, got str` | DATE field passed as ISO string | Use `date.toordinal()` integer |

---

## Related

- [aethis-cli](https://github.com/Aethis-ai/aethis-cli) — Python CLI; file-based authoring with YAML test cases
- [aethis-examples](https://github.com/Aethis-ai/aethis-examples) — runnable rulesets (spacecraft, construction-CAR, consumer credit) and benchmark scenarios
- [confidently-wrong-benchmark](https://github.com/Aethis-ai/confidently-wrong-benchmark) — paper, 225-scenario benchmark, LegalBench harness

## Development

```bash
git clone https://github.com/Aethis-ai/aethis-mcp.git
cd aethis-mcp && npm install && npm test && npm run build
```

## License

MIT
