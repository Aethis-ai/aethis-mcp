<div align="center">

# aethis-mcp

**LLMs interpret rules. This compiles them.**

An MCP server that compiles legislation, policy, and regulation into deterministic logic — so your agent gets the same correct answer every time.

[![npm version](https://img.shields.io/npm/v/aethis-mcp.svg)](https://www.npmjs.com/package/aethis-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[The problem](#the-problem) | [Proof](#proof) | [When to use this](#when-to-use-this) | [Quick start](#quick-start) | [Author rules](#author-your-own-rules) | [Tools](#tools) | [Setup](#setup)

</div>

---

## The problem

AI agents are making eligibility and compliance decisions using LLM reasoning. Most of the time it works. When it doesn't, nobody notices — the model returns a confident, well-structured wrong answer with no audit trail.

LLMs are good at interpreting rules. They are not reliable at executing them. The failure mode is silent: high confidence, wrong answer, no trace.

Aethis compiles rules into formal logic at authoring time. At decision time, no LLM is involved. Same inputs, same answer, every time — with a full audit trail back to the source clause.

---

## Proof

We tested GPT-5.4, Claude Sonnet 4.6, and the Aethis deterministic engine on 58 insurance coverage scenarios with three-level exception chains:

| | Accuracy | Failure mode |
|--|----------|-------------|
| **Aethis Engine** | **100% (58/58)** | — |
| GPT-5.4 | 94.8% (55/58) | Fails on nested exception overrides |
| Claude Sonnet 4.6 | 0% (0/58) | Format compliance failure |

94.8% sounds good — until you see which 5.2% GPT gets wrong.

### Where GPT fails

All 3 failures are the same pattern: a **three-level exception chain** in a London market insurance endorsement.

The rule:

> Access damage is **excluded** (Clause 8).
> Unless the project is worth >=100M — **enhanced cover reinstates** it (Clause 9(1)).
> Unless the defect is a **design defect** — enhanced cover doesn't apply (Clause 9(2)).
> Unless the project is worth >=500M — **pioneer override reinstates** it (Clause 9(3)).

GPT handles two levels. It loses track at the third. Every time.

These are the exact scenarios that end up in court.

### The scenario GPT gets wrong

A £600M pioneer infrastructure project. Design defect. Access damage claim.

```
aethis_decide({
  bundle_id: "car_defect_endorsement:20250301-a1b2c3d4",
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

Full benchmark data and reproduction script: [aethis-examples/construction-all-risks](https://github.com/aethis-ai/aethis-examples/tree/main/construction-all-risks)

---

## When to use this

**Use Aethis when:**

- The decision has regulatory, legal, or financial consequences
- You need an audit trail that traces back to source text
- Rules involve nested exceptions, conditional thresholds, or override chains
- "95% accurate" is not good enough
- You need the same answer every time, not just most of the time

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

```bash
# 1. Get your API key at https://aethis.ai/dashboard
# 2. Add the MCP server:
claude mcp add aethis -e AETHIS_API_KEY=<your-key> -- npx -y aethis-mcp
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
> Want to create your own rules from a policy document? See [Author your own rules](#author-your-own-rules) below.

---

## Author your own rules

Aethis is not just a decision engine — it lets your agent compile legislation into executable logic. Paste a policy document, write test cases, and iterate until the rules pass.

### Step 1: Create

```
aethis_create_bundle({
  name: "Consumer Credit Pre-Qualification",
  section_id: "consumer-credit",
  source_text: "Section 3: Adverse credit history\n(1) An applicant with adverse credit history...",
  test_cases: [
    { name: "Adverse credit — decline", field_values: { "credit.has_adverse_history": true }, expected_outcome: "not_eligible" },
    { name: "Good applicant — approve", field_values: { "credit.has_adverse_history": false, "credit.employment_status": "employed", ... }, expected_outcome: "eligible" },
    { name: "High DTI, existing customer — approve", field_values: { "credit.dti_percent": 55, "credit.is_existing_customer": true, ... }, expected_outcome: "eligible" }
  ]
})
```

Returns a `project_id`.

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

### Step 4: Publish

```
aethis_publish({ project_id: "proj_abc123" })
```

Returns a `bundle_id` — ready to use with `aethis_decide`.

> [!NOTE]
> **Test-driven iteration:** Aethis generates rules from your source text and guidance — not from your tests. Tests validate the output and show you what guidance to add next. Better tests = faster convergence on correct rules.

> [!IMPORTANT]
> **OpenAI key required for authoring.** Rule generation uses OpenAI LLM calls. Pass your key as `openai_key` on `aethis_generate_and_test`, `aethis_refine`, or `aethis_generate`. The key is used for the request only and **never stored**. Decision tools do not use OpenAI.

---

## Tools

19 tools in six groups. Most agents use Decision (2 calls). Authors use the full Authoring workflow.

| Group | Tools | What they do |
|-------|-------|-------------|
| **Decision** | `aethis_decide`, `aethis_schema`, `aethis_next_question`, `aethis_explain` | Evaluate eligibility, inspect fields, conversational checks, rule explanations |
| **Authoring** | `aethis_create_bundle`, `aethis_generate_and_test`, `aethis_add_guidance`, `aethis_refine`, `aethis_publish` | Create, iterate, and publish rule bundles (TDD workflow) |
| **Discovery** | `aethis_list_projects`, `aethis_project_status`, `aethis_list_bundles` | Find projects, check generation progress, browse bundle versions |
| **Test cases** | `aethis_list_tests`, `aethis_get_test`, `aethis_update_test`, `aethis_delete_test` | Full CRUD on test cases |
| **Management** | `aethis_archive_project`, `aethis_archive_bundle` | Archive projects and bundles (permanent) |
| **Low-level** | `aethis_generate` | Async generation with manual polling |

---

## Workflows

### Evaluate eligibility (2 calls)

```
aethis_schema(bundle_id)          → Learn what fields are needed
aethis_decide(bundle_id, fields)  → eligible / not_eligible / undetermined
```

Pass `include_trace: true` for the full evaluation trace with source citations.

### Conversational eligibility

```
aethis_next_question(bundle_id, {})                     → "What is the applicant's species?"
aethis_next_question(bundle_id, {species: "Vogon"})     → Decision: not eligible. No more questions needed.
```

Questions come in priority order. The engine short-circuits as soon as a decision is reachable.

### Author rules

See [Author your own rules](#author-your-own-rules) for the full TDD workflow.

---

## Setup

### Claude Code

```bash
claude mcp add aethis -e AETHIS_API_KEY=<your-key> -- npx -y aethis-mcp
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "aethis": {
      "command": "npx",
      "args": ["-y", "aethis-mcp"],
      "env": { "AETHIS_API_KEY": "<your-key>" }
    }
  }
}
```

### Cursor / Windsurf

Add to `.cursor/mcp.json` or `.windsurf/mcp.json` (same JSON as above).

### Get your API key

Sign in at [aethis.ai/dashboard](https://aethis.ai/dashboard) to create an API key. The key is shown once — copy it into your MCP client config.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| "API key is required" | `AETHIS_API_KEY` not set | Configure in MCP client settings (not shell profile) |
| "X-OpenAI-Key header is required" | Missing OpenAI key on generation | Pass `openai_key` parameter on authoring tools |
| "Bundle not found" (404) | Wrong ID or archived | Use `aethis_list_projects` → `aethis_list_bundles` |
| "Rate limit exceeded" (429) | Daily limit hit | Client retries automatically. Contact [eng@aethis.ai](mailto:eng@aethis.ai) for higher tier |
| "Cannot publish: tests failing" | Tests don't pass | Fix with `aethis_refine`, or `force=true` to override |
| Generation timeout | Large source document | Check `aethis_project_status`. Client waits up to 5 min |

---

## Related

**[aethis-cli](https://github.com/aethis-ai/aethis-cli)** — Python CLI for file-based rule authoring with YAML test cases and Rich terminal output.

**[aethis-examples](https://github.com/aethis-ai/aethis-examples)** — Benchmark data, test scenarios, and LLM comparison results for construction insurance, consumer credit, and spacecraft certification.

## Development

```bash
git clone https://github.com/aethis-ai/aethis-mcp.git
cd aethis-mcp
npm install
npm test       # 90 tests
npm run build
```

## License

MIT
