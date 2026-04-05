<div align="center">

# aethis-mcp server

**Deterministic eligibility checks for AI agents.**

LLMs hallucinate policy. Aethis compiles it into logic that returns the same answer every time.

[![npm version](https://img.shields.io/npm/v/aethis-mcp.svg)](https://www.npmjs.com/package/aethis-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Quick start](#quick-start) | [How it works](#how-it-works) | [Tools](#tools) | [Docs](https://aethis.ai/docs)

</div>

---

## Quick start

```bash
# 1. Get your API key at https://aethis.ai/dashboard (sign in → create key)
# 2. Add the MCP server:
claude mcp add aethis -e AETHIS_API_KEY=<your-key> -- npx -y aethis-mcp
```

The examples below use the **Spacecraft Crew Certification Act 2049** — a synthetic statute modelled on UK primary legislation that ships as a public demo bundle. Every decision is **deterministic**: no language model is involved at decision time. Rules are compiled from the source legislation into formal logic, fully tested, then evaluated by a constraint engine. Same inputs, same answer, every time.

### The source legislation

The rules were generated from a statute that reads like real legislation:

> **Section 3: Species eligibility**
>
> (1) An applicant for crew certification must be of an eligible species.
>
> (2) A Vogon national is not an eligible species for the purposes of this Act, by virtue of the Galactic Diplomatic Exclusion Treaty 2045.
>
> (3) Where the applicant is a Vogon, the application must be refused without consideration of any other requirement under this Act.

> **Section 4: Flight readiness**
>
> (1) The applicant must demonstrate flight readiness by satisfying all of the following conditions —
>
> (a) the applicant has accumulated not fewer than 500 flight hours; and
>
> (b) the applicant holds a valid pilot licence issued or recognised by the Authority.

You can inspect the rules generated from this legislation without seeing any code:

> Explain the rules in the spacecraft crew certification bundle.

```json
{
  "bundle_id": "space_crew_cert:20490101-a1b2c3d4",
  "criteria": [
    {
      "group": "species_check",
      "title": "Species eligibility",
      "rule_text": "species must not be 'Vogon'"
    },
    {
      "group": "flight_readiness",
      "title": "Flight hours and licence",
      "rule_text": "flight_hours >= 500 AND has_pilot_license is true"
    }
  ]
}
```

Human-readable rule descriptions, traceable to the source — but no generated code is ever exposed.

### Eligible

> Is a 35-year-old human with 600 flight hours, a pilot licence, GAA medical exam, valid medical cert, on a suborbital mission with conventional propulsion and a towel — eligible for crew certification?

```json
{
  "decision": "eligible",
  "bundle_id": "space_crew_cert:20490101-a1b2c3d4",
  "bundle_version": "v2",
  "fields_evaluated": 11,
  "fields_provided": 11
}
```

### Not eligible — with provenance

> Is a Vogon eligible? Show me the trace.

```json
{
  "decision": "not_eligible",
  "bundle_id": "space_crew_cert:20490101-a1b2c3d4",
  "fields_provided": 1,
  "fields_evaluated": 11,
  "trace": {
    "species_check": {
      "criterion": "Species eligibility — Section 3",
      "result": "FAIL — species is 'Vogon' (disqualifying, no further checks)"
    }
  }
}
```

Every decision traces back to the exact section and clause in the source legislation.

### Optimal path to eligible — conversational flow

The engine doesn't just evaluate — it finds the **shortest path to a decision**. It asks questions in priority order, most discriminating first, and short-circuits the moment a decision is reachable.

> Walk me through a crew certification eligibility check.

```
Decision: undetermined (0/11 fields provided)

Next question to ask:
  Field: space.crew.species
  Question: What is the applicant's species?
  Priority weight: 1 (lower = more important)

Full remaining path (11 questions):
  1. What is the applicant's species? (space.crew.species, weight=1)
  2. Does the applicant have a towel? (space.crew.has_towel, weight=2)
  3. How many flight hours? (space.crew.flight_hours, weight=3)
  ...
```

> They're a Vogon.

```
Decision: not eligible. No more questions needed.
```

One question. The engine knew that a Vogon is disqualified under Section 3 regardless of flight hours, medical certs, or towel status — so it stopped asking.

> [!TIP]
> Want to create your own rules from a policy document? See [Author rules (TDD loop)](#author-rules-tdd-loop) below.

---

## How it works

```
Source text ──→ LLM compiles to rules ──→ Published rule bundle
                (authoring time only)           │
                                                ▼
                                      Constraint engine evaluates
                                      (deterministic, no LLM)
                                                │
                                                ▼
                                      eligible / not_eligible / undetermined
                                      + trace back to source clause
```

The LLM is used once, at authoring time. After that, every decision is pure logic — same inputs, same answer, every time.

**Use cases:** Loan eligibility, immigration compliance, insurance underwriting, HR policy, benefits qualification — any regulated workflow where the answer must be deterministic, explainable, and backed by source text.

---

## Tools

19 tools in six groups:

| Group | Tools | What they do |
|-------|-------|-------------|
| **Decision** | `aethis_decide`, `aethis_schema`, `aethis_next_question`, `aethis_explain` | Evaluate eligibility, inspect fields, conversational checks, rule explanations |
| **Discovery** | `aethis_list_projects`, `aethis_project_status`, `aethis_list_bundles` | Find projects, check generation progress, browse bundle versions |
| **Test cases** | `aethis_list_tests`, `aethis_get_test`, `aethis_update_test`, `aethis_delete_test` | Full CRUD on golden test cases |
| **Management** | `aethis_archive_project`, `aethis_archive_bundle` | Archive projects and bundles (permanent) |
| **Authoring** | `aethis_create_bundle`, `aethis_generate_and_test`, `aethis_add_guidance`, `aethis_refine`, `aethis_publish` | Create, iterate, and publish rule bundles (TDD workflow) |
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
aethis_next_question(bundle_id, {})                     → "Does the operative carry a radio?"
aethis_next_question(bundle_id, {has_radio: false})      → Decision: not eligible.
```

Questions come in priority order. The engine short-circuits as soon as a decision is reachable.

### Author rules (TDD loop)

```
aethis_create_bundle(name, section_id, source_text, test_cases)  → project_id
aethis_generate_and_test(project_id)                               → 2/3 passing, shows failures
aethis_refine(project_id, "the trainee exemption overrides...")    → 3/3 passing
aethis_publish(project_id)                                         → bundle_id, ready to use
```

> [!NOTE]
> **Test-driven iteration:** Aethis generates rules from your source text and guidance — not from your tests. Tests validate the output and show you what guidance to add next. Better tests = faster convergence on correct rules.

> [!IMPORTANT]
> **OpenAI key required for authoring.** Rule generation uses OpenAI LLM calls. Pass your key as `openai_key` on `aethis_generate_and_test`, `aethis_refine`, or `aethis_generate`. The key is used for the request only and **never stored**. Decision tools do not use OpenAI.

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

## Related tools

**[aethis-cli](https://github.com/aethis-ai/aethis-cli)** — Python CLI for file-based rule authoring with YAML test cases and Rich terminal output.

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
