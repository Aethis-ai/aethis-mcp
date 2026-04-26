<div align="center">

# aethis-mcp

**LLMs interpret rules. This compiles them.**

An MCP server that compiles legislation, policy, and regulation into deterministic logic — so your agent gets the same correct answer every time.

[![npm version](https://img.shields.io/npm/v/aethis-mcp.svg)](https://www.npmjs.com/package/aethis-mcp)
[![Docs](https://img.shields.io/badge/docs-docs.aethis.ai-blue)](https://docs.aethis.ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[The problem](#the-problem) | [Proof](#proof) | [When to use this](#when-to-use-this) | [Quick start](#quick-start) | [Author rules](#author-your-own-rules) | [Tools](#tools) | [Workflows](#workflows) | [DSL capabilities](#dsl-capabilities) | [Setup](#setup) | [Troubleshooting](#troubleshooting)

</div>

---

## The problem

AI agents are making eligibility and compliance decisions using LLM reasoning. Most of the time it works. When it doesn't, nobody notices — the model returns a confident, well-structured wrong answer with no audit trail.

LLMs are good at interpreting rules. They are not reliable at executing them. The failure mode is silent: high confidence, wrong answer, no trace.

Aethis compiles rules into formal logic at authoring time. At decision time, no LLM is involved. Same inputs, same answer, every time — with a full audit trail back to the source clause.

---

## Proof

Numbers below from the paper ([Simpson, Kozak, Doake, v3.8, 2026](https://github.com/Aethis-ai/confidently-wrong-benchmark/blob/main/paper/Simpson_Exception_Chain_Collapse_2026.md)). Three independent evidence sources.

**v3.8 adversarial extension (paper §6.4.1):** 20 newly-authored construction-CAR scenarios stratified across 5 complexity dimensions, independent-prose-then-engine methodology. Engine 20/20 (100%) by construction; current frontier models still fail:

| Configuration | N=20 | Failures |
|--|:--:|--|
| **Aethis Engine** | **20/20 (100%)** | — |
| GPT-5.4 (`reasoning_effort=low`) | 20/20 (100%) | — |
| GPT-5.4 (default) | 19/20 (95%) | **0 reasoning tokens on every scenario** — short-circuits on E4 (DE3/LEG3 carveback gap) |
| Claude Sonnet 4.6 | 19/20 (95%) | E4 |
| **Claude Opus 4.7** (current Anthropic strongest) | **18/20 (90%)** | E4 + B3 (£499 M boundary) |

Three of four frontier configurations fail the same scenario across both Anthropic and OpenAI families.

**External validation on LegalBench (paper §6.10):** across **9 LegalBench tasks (949 held-out cases authored by Stanford researchers)** the engine is significantly more accurate than each of three frontier LLMs by combined paired-binomial McNemar's test: *p* < 0.001 vs Claude Sonnet 4.6, *p* = 0.003 vs Claude Opus 4.7, *p* < 0.001 vs GPT-5.4. The structural advantage is largest on multi-prong rule-application tasks (Δ up to +41 pp) and persists at a smaller cross-task-significant margin on randomly-sampled tasks chosen without fit inspection.

**The shifting-ground problem (paper §6.5 Finding 6):** between March and April 2026 several v3.7 paper cells closed silently under the same model alias — GPT-5.4 on construction-CAR moved from 96.6% to 100%; Opus 4.6 on spacecraft from 89.7% to 98.5%; the GPT-5.3 alias was deprecated by OpenAI mid-cycle. Frontier-LLM accuracy on a fixed benchmark is a moving target. The Aethis Engine is invariant by construction — same bundle, same answer, any month, any prompt.

See [`confidently-wrong-benchmark/legalbench/`](https://github.com/Aethis-ai/confidently-wrong-benchmark/tree/main/legalbench) for the full harness and per-call replication artefacts.

In regulated workflows (financial services, insurance, immigration, healthcare), decisions must be **deterministic** (same answer every time), **explainable** (audit trail to source clause), and **reproducible**. LLMs fail all three regardless of peak accuracy.

### Where LLMs fail

The failure pattern is nested exception chains in a London market insurance endorsement:

> Access damage is **excluded** (Clause 8).
> Unless the project is worth >=100M — **enhanced cover reinstates** it (Clause 9(1)).
> Unless the defect is a **design defect** — enhanced cover doesn't apply (Clause 9(2)).
> Unless the project is worth >=500M — **pioneer override reinstates** it (Clause 9(3)).
> Unless the defect was **known prior** — pioneer override is blocked (Clause 9A(1)).
> Unless there's an **engineer assessment** — the block is lifted (Clause 9A(2)).

GPT-5.4 fails on the pioneer override boundary at £500M (paper §6.4). GPT-4.1-mini fails systematically across the enhanced cover chain, treating the access damage exclusion as absolute.

Full benchmarks, reproducible test runner, and per-scenario breakdown: [Aethis-ai/confidently-wrong-benchmark](https://github.com/Aethis-ai/confidently-wrong-benchmark) · [aethis-examples](https://github.com/Aethis-ai/aethis-examples)

### The scenario GPT gets wrong

A £600M pioneer infrastructure project. Design defect. Access damage claim.

```
aethis_decide({
  bundle_id: "aethis/insurance/construction-all-risks",
  field_values: {
    "car.policy.period_valid": true,
    "car.property.category": "permanent_works",
    "car.loss.is_physical": true,
    "car.component.is_defective": true,
    "car.defect.origin": "design",
    "car.claim.is_rectification": false,
    "car.claim.is_access_damage": true,
    "car.damage.consequence_of_failure": false,
    "car.project.value_millions_gbp": 600,
    "car.notification.within_period": true,
    "car.contract.jct_compliant": true
  },
  include_trace: true
})
```

```json
{
  "decision": "eligible",
  "bundle_version": "v3",
  "fields_provided": 11,
  "fields_evaluated": 11,
  "trace": {
    "not_rectification": "PASS — claim is not for rectification",
    "carveback_qualification": "PASS — Route B: not solely access damage for removal",
    "access_exclusion": "TRIGGERED — access damage claimed",
    "enhanced_cover": "PASS — project value 600M >= 100M threshold",
    "design_defect_check": "TRIGGERED — defect origin is design",
    "pioneer_override": "PASS — project value 600M >= 500M, pioneer override applies"
  }
}
```

**GPT says:** not covered.
**Aethis says:** covered — pioneer override (Clause 9(3)) reinstates coverage even for design defects on projects >= £500M.

Sub-5ms, no LLM at inference, same trace every time. The example trace above is representative — run the full reproducer (all 11 scenarios, every frontier model) yourself: [aethis-examples/construction-all-risks](https://github.com/aethis-ai/aethis-examples/tree/main/construction-all-risks).

---

## When to use this

**Use Aethis when:**

- The decision has regulatory, legal, or financial consequences
- You need an audit trail that traces back to source text
- Rules involve nested exceptions, conditional thresholds, or override chains
- "95% accurate" is not good enough
- You need the same answer every time, not just most of the time
- **You're making decisions at scale** — the engine evaluates in under 5ms per decision (1000x faster than an LLM call). A batch of 10,000 evaluations completes in seconds, not hours
- **Your agent needs to ask the right questions** — the engine computes the optimal next question to ask given what it already knows, finding the shortest path to a decision. Two applicants with different facts get different question sequences — the engine adapts in real time

**Domains:** Loan eligibility, insurance underwriting, immigration compliance, HR policy, benefits qualification, medical device clearance, trade compliance — any domain where rules are written in legislation or policy documents.

**You probably don't need this for:**

- Content recommendations, search ranking, sentiment analysis
- Decisions where "close enough" is fine
- One-off questions that don't repeat

---

## How it works

The LLM is used once, at authoring time, to compile source text into formal logic. After that, every decision is pure constraint evaluation.

```
Source text ──→ LLM compiles to rules ──→ Test suite validates ──→ Published rule bundle
                (authoring time only)                                      │
                                                                           ▼
                                                                 Eligibility engine evaluates
                                                                 (deterministic, no LLM)
                                                                           │
                                                                           ▼
                                                                 eligible / not_eligible / undetermined
                                                                 + trace back to source clause
```

---

## Quick start

**Two use cases — decide which is yours:**

- **Evaluate existing rules** — a bundle already exists, you want to evaluate eligibility against it. No API key needed. Start with `aethis_decide` or `aethis_next_question`.
- **Author new rules** — you have a policy document and want to compile it into logic. Requires an API key and Anthropic key. Start with `aethis_create_bundle` and follow the TDD workflow.

No sign-up needed to evaluate. Decision tools work immediately.

```bash
claude mcp add aethis -- npx -y aethis-mcp
```

Try it immediately with the public demo bundle (Spacecraft Crew Certification Act 2049):

> Is a Vogon eligible for crew certification?

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

One field provided. Decision reached instantly — the engine knew a Vogon is disqualified regardless of flight hours, medical certs, or anything else. No further questions asked.

> Is a 35-year-old human with 600 flight hours, a pilot licence, GAA exam, valid medical cert, on a suborbital mission with conventional propulsion and a towel — eligible?

```json
{
  "decision": "eligible",
  "fields_provided": 11,
  "fields_evaluated": 11
}
```

Every decision traces back to the exact section and clause in the source legislation. Pass `include_trace: true` for the full evaluation trail.

> [!TIP]
> Want to create your own rules from a policy document? See [Author your own rules](#author-your-own-rules) below. Rule authoring is **invite-only private beta**. Decision tools (above) stay public and free. [Request access →](https://aethis.ai/sign-up)

---

## Author your own rules

> [!NOTE]
> Rule authoring is **invite-only private beta** — approval required. Decision tools (above) work publicly with no keys.
>
> **What you'll need once approved:** an Aethis API key (we provision one for approved tenants) and your own Anthropic key for generation (passed per-request, never stored). Attempting authoring tools without approval returns `403 Forbidden`. [Request access →](https://aethis.ai/sign-up)

Aethis is not just a decision engine — it lets your agent compile legislation into executable logic. Paste a policy document, write test cases, and iterate until the rules pass.

### Three-phase authoring workflow

Complex legislation that spans multiple sections needs a structured approach before you write rules. The three phases build on each other: discover the structure, nail the field vocabulary, then generate and test rules.

> [!TIP]
> **Simple single-section rules?** Skip Phases 1–2. Go straight to `aethis_create_bundle` → `aethis_discover_fields` → write tests → `aethis_generate_and_test`. The phase structure is for multi-section domains where getting the decomposition right matters.

#### Phase 1 — Section discovery

Use when you have complex legislation that needs to be split into separate, independently-evaluable sections.

```
aethis_discover_sections({
  domain: "uk_fsm",
  sources: [{ name: "fsm_legislation.md", content: "..." }]
})
→ Suggests: child_eligibility, household_qualifying_criteria, universal_infant_fsm

aethis_validate_sections({
  domain: "uk_fsm",
  expected_sections: ["child_eligibility", "household_qualifying_criteria", "universal_infant_fsm"],
  discovered_sections: [... result from above ...]
})
→ all_match: true
```

If sections don't match your expectation, refine and re-discover:

```
aethis_refine_sections({
  domain: "uk_fsm",
  feedback: "Universal Infant Free School Meals must be a separate section with no income test.",
  sources: [...]
})
```

#### Phase 2 — Field vocabulary

Use before writing test cases to ensure the field names the engine produces match what you expect. If you skip this, you may write tests with invented field names that silently mismatch.

```
// Tell the engine what fields you expect (SME-defined spec):
aethis_set_field_spec({
  project_id: "proj_abc123",
  expected_fields: [
    { key: "child.age", sort: "Int" },
    { key: "child.school_type", sort: "Enum", enum_values: ["state_funded", "independent"] }
  ]
})

// Discover fields from source text — auto-validates against the spec:
aethis_discover_fields({ project_id: "proj_abc123" })
→ field list + validation_result if spec was set (shows missing/mismatched fields)

// Refine if fields are wrong:
aethis_refine_fields({
  project_id: "proj_abc123",
  feedback: "child.school_type should include 'home_educated' as a value"
})

// Explicit validation against spec:
aethis_validate_fields({
  project_id: "proj_abc123",
  expected_fields: [...]
})
```

#### Phase 3 — Generate and test

What's documented below as Steps 1–4. Once sections are agreed and fields are validated, create bundles and run the TDD loop.

---

### Step 1: Create

```
aethis_create_bundle({
  name: "Consumer Credit Pre-Qualification",
  section_id: "consumer-credit",
  domain: "consumer_credit",                          // optional — groups related sections
  source_text: "Section 3: Adverse credit history\n(1) An applicant with adverse credit history...",
  test_cases: [
    { name: "Adverse credit — decline", field_values: { "credit.has_adverse_history": true }, expected_outcome: "not_eligible" },
    { name: "Good applicant — approve", field_values: { "credit.has_adverse_history": false, "credit.employment_status": "employed", ... }, expected_outcome: "eligible" },
    { name: "High DTI, existing customer — approve", field_values: { "credit.dti_percent": 55, "credit.is_existing_customer": true, ... }, expected_outcome: "eligible" }
  ]
})
```

Returns a `project_id`.

> [!TIP]
> **Discover field names before writing tests.** Call `aethis_discover_fields({ project_id })` after creating a bundle to get the exact field names the engine will use. Writing tests with invented field names causes silent mismatches. Run discover → write tests → generate.

> [!TIP]
> **Use `domain` to share guidance across sections.** If you have multiple related bundles (e.g. `residence`, `english_language`, `good_character` under `uk_citizenship`), set the same `domain` on each. Guidance added with `aethis_add_domain_guidance` for that domain applies automatically to all projects in it — no need to repeat cross-section principles on every bundle.

### Step 2: Generate and test

```
aethis_generate_and_test({ project_id: "proj_abc123" })
```

```
Generation complete. Test results: 2/3 passing.

PASS  Adverse credit — decline
PASS  Good applicant — approve
FAIL  High DTI, existing customer — approve
      Expected: eligible  Got: not_eligible
      The existing customer exemption (Section 10) is not yet captured.
```

### Step 3: Refine

```
aethis_refine({
  project_id: "proj_abc123",
  feedback: "Section 10 says existing customers (24+ months good standing) are exempt from the DTI threshold in Section 6."
})
```

```
Generation complete. Test results: 3/3 passing.

PASS  Adverse credit — decline
PASS  Good applicant — approve
PASS  High DTI, existing customer — approve  (was: FAIL → now: PASS)
```

You can also add guidance directly without regenerating, and inspect what's accumulated:

```
// Add targeted guidance for a specific failing test
aethis_add_guidance({
  project_id: "proj_abc123",
  guidance_text: "When DTI > 45%, existing customers with 24+ months good standing are exempt (Section 10).",
  process_type: "rule_generation"    // default; use "field_extraction" for field design principles
})

// Check what guidance is in place before adding more
aethis_list_guidance({ project_id: "proj_abc123" })
```

For cross-section principles that apply to multiple bundles in the same domain:

```
// Add once — applies to all projects in the domain automatically
aethis_add_domain_guidance({
  domain: "consumer_credit",
  guidance_text: "The system flags, never decides. Discretionary clauses ('we will consider', 'may be waived') must produce 'undetermined', not 'not_eligible'.",
  process_type: "rule_generation",
  notes: "Core discretion principle — do not remove."   // stored for SME context, never sent to LLM
})

aethis_list_domain_guidance({ domain: "consumer_credit" })
```

**Diagnosing a specific failure:**

```
aethis_explain_failure({
  bundle_id: "consumer-credit:20250301-abc123",
  field_values: { "credit.dti_percent": 55, "credit.is_existing_customer": true },
  expected_outcome: "eligible",
  test_name: "High DTI, existing customer — approve"
})
// Returns: criterion statuses, which rule failed, and a targeted fix hint
```

### Step 4: Publish

```
aethis_publish({ project_id: "proj_abc123" })
```

Returns a `bundle_id` — ready to use with `aethis_decide`.

> [!NOTE]
> **Test-driven iteration:** Aethis generates rules from your source text and guidance — not from your tests. Tests validate the output and show you what guidance to add next. Better tests = faster convergence on correct rules.

> [!IMPORTANT]
> **Anthropic key required for authoring.** Rule generation uses Anthropic LLM calls. Pass your key as `anthropic_key` on `aethis_generate_and_test` or `aethis_refine`. The key is used for the request only and **never stored**. Decision tools do not use Anthropic.

> [!IMPORTANT]
> **DATE fields use integer ordinals, not ISO strings.** Pass dates as Python `date.toordinal()` values (days since year 1). Example: `2025-04-13` = `739354`, `2026-04-13` = `739719`. Passing `"2025-04-13"` will fail with a type error. Quick conversion: `python3 -c "from datetime import date; print(date(2025, 4, 13).toordinal())"`.


---

## Tools

25 tools in four groups. Most agents use Decision (2 calls). Authors use the full Authoring workflow.

| Group | Tools | What they do |
|-------|-------|-------------|
| **Decision** | `aethis_decide`, `aethis_schema`, `aethis_next_question`, `aethis_explain`, `aethis_explain_failure` | Evaluate eligibility, inspect fields, conversational checks, rule explanations, diagnose failures |
| **Authoring — section & field phases** | `aethis_discover_sections`, `aethis_refine_sections`, `aethis_validate_sections`, `aethis_set_field_spec`, `aethis_discover_fields`, `aethis_refine_fields`, `aethis_validate_fields` | Decompose legislation into sections (Phase 1); establish and validate field vocabulary (Phase 2) |
| **Authoring — rule generation** | `aethis_create_bundle`, `aethis_add_guidance`, `aethis_list_guidance`, `aethis_generate_and_test`, `aethis_refine`, `aethis_publish`, `aethis_add_domain_guidance`, `aethis_list_domain_guidance` | Create, iterate, and publish rule bundles (TDD workflow); manage project and domain guidance |
| **Discovery** | `aethis_list_projects`, `aethis_list_bundles` | Find projects, browse bundle versions |
| **Management** | `aethis_archive_project`, `aethis_archive_bundle` | Archive projects and bundles (permanent) |

### Prompts

MCP prompts are pre-built workflow guides that compatible clients (Claude Desktop, Cursor, VS Code Copilot) can surface as selectable templates.

| Prompt | Description |
|--------|-------------|
| `aethis-author` | Step-by-step TDD workflow: gather requirements → create bundle → generate → refine → publish |
| `aethis-decide` | Decision workflow: find bundle → get schema → evaluate (quick or conversational). Accepts optional `bundle_id` argument |

---

## Workflows

### Evaluate eligibility (2 calls)

```
aethis_schema(bundle_id)          → Learn what fields are needed
aethis_decide(bundle_id, fields)  → eligible / not_eligible / undetermined
```

- `include_trace: true` — full evaluation trace with source citations for each criterion
- `include_explanation: true` — human-readable rule descriptions (useful for surfacing to end users)

### Conversational eligibility — optimal question routing

The engine doesn't just evaluate — it tells your agent what to ask next. Given the facts collected so far, it computes the single most informative question and returns the shortest remaining path to a decision.

```
aethis_next_question(bundle_id, {})
→ "What is the applicant's species?" (10 questions remaining)

aethis_next_question(bundle_id, {species: "Vogon"})
→ Decision: not eligible. No more questions needed.
```

One fact was enough. A Vogon is disqualified immediately — the engine doesn't ask about flight hours, medical certs, or towel compliance. A different applicant might need 5 questions. Another might need 8. The engine adapts the path based on the answers it receives, always choosing the question that resolves the most uncertainty.

This means your agent can run a guided assessment — asking only the questions that matter, in the order that matters — and reach a provable decision in the fewest possible steps.

The response includes `optimal_path` — the full ranked list of remaining questions. You don't need to ask all of them: call `aethis_next_question` again after each answer and the engine recomputes the shortest path from the updated state. Once a decision is reachable, `is_eligible` is returned and no further questions are needed.

### Author rules

See [Author your own rules](#author-your-own-rules) for the full TDD workflow.

---

## Setup

Decision tools work with no API key. Add `AETHIS_API_KEY` when you have authoring access.

### Claude Code

```bash
# Decision tools only (no key needed)
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

To enable authoring, add `"env": { "AETHIS_API_KEY": "<your-key>" }` to the config above.

### Cursor / Windsurf

Add to `.cursor/mcp.json` or `.windsurf/mcp.json` (same JSON as above).

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| "API key is required" | `AETHIS_API_KEY` not set (authoring tools only) | Configure in MCP client settings (not shell profile). Decision tools don't need a key |
| "X-Anthropic-Key header is required" | Missing Anthropic key on generation | Pass `anthropic_key` parameter on authoring tools |
| "Bundle not found" (404) | Wrong ID or archived | Use `aethis_list_projects` → `aethis_list_bundles` |
| "Rate limit exceeded" (429) | Daily limit hit | Client retries automatically. Contact [eng@aethis.ai](mailto:eng@aethis.ai) for higher tier |
| "Cannot publish: tests failing" | Tests don't pass | Fix with `aethis_refine`, or `force=true` to override |
| Generation timeout (504) | The client timed out waiting (normal for complex rules — generation can take 5–15 min server-side) | **The server continues generating after the timeout.** Wait 10–15 min, then call `aethis_list_bundles({ project_id })` to check if a new bundle appeared. If yes, call `aethis_publish`. If not, the server may still be running — wait and check again rather than re-triggering generation |
| `"Expected an integer for <field>, got str"` | DATE field passed as ISO string | Pass as `date.toordinal()` integer — e.g. `739354` for 2025-04-13. Quick: `python3 -c "from datetime import date; print(date(2025,4,13).toordinal())"` |

---

<details>
<summary><strong>DSL capabilities</strong></summary>

### Supported field types

| Type | Description |
|------|-------------|
| `Bool` | True / false |
| `Int` | Integer (includes counts, money as pence, percentages as integers) |
| `Enum` | Closed set of named values |
| `Date` | Stored as integer ordinal (days since year 1). Pass via `date.toordinal()` |
| `Duration` | Integer number of days |
| `String` | Free text (use sparingly — prefer Enum for known value sets) |

### Supported operators

| Category | Operators |
|----------|-----------|
| Logic | AND, OR, NOT, IMPLIES |
| Comparison | `=`, `≠`, `<`, `≤`, `>`, `≥` |
| Membership | `IN` — field IN [v1, v2, ...] |
| Arithmetic | `+` and `−` for Int/Date fields; `*` (multiply) for Int fields |
| Aggregation | `min(a, b, ...)` and `max(a, b, ...)` — return the smallest/largest Int |

### Helpers

- `days_between(date_a, date_b)` — returns Int (number of days, `date_b − date_a`)
- `min(a, b, ...)` — minimum of 2+ Int values
- `max(a, b, ...)` — maximum of 2+ Int values
- Constant arithmetic is folded at authoring time: `5 * 365` becomes `1825` in the compiled rule

### Not supported

- Division between runtime field values
- Weighted scoring or probabilistic outcomes
- Lists as field values (model as pre-aggregated Int or Bool fields instead)
- More than 3 outcome tiers (`eligible` / `not_eligible` / `undetermined`)

</details>

---

## Related

**[aethis-cli](https://github.com/aethis-ai/aethis-cli)** — Python CLI for file-based rule authoring with YAML test cases and Rich terminal output.

**[aethis-examples](https://github.com/aethis-ai/aethis-examples)** — Benchmark data, test scenarios, and LLM comparison results for construction insurance, consumer credit, and spacecraft certification.

## Development

```bash
git clone https://github.com/aethis-ai/aethis-mcp.git
cd aethis-mcp
npm install
npm test       # 107 tests
npm run build
```

## License

MIT
