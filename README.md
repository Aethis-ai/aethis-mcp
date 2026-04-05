# aethis-mcp

LLMs hallucinate policy. Aethis compiles it into logic that returns the same answer every time.

Give Aethis a source document — legislation, lending criteria, an HR handbook — and it compiles the rules into a formal constraint system. At decision time, no LLM is involved: the engine evaluates your inputs and returns `eligible`, `not_eligible`, or `undetermined`, traceable to the exact clause that drove the outcome.

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

**Use cases:** Loan eligibility, immigration compliance, insurance underwriting, HR policy, benefits qualification — any regulated workflow where the answer must be deterministic, explainable, and backed by source text.

## Setup

Get an API key at [aethis.ai](https://aethis.ai), then add the server to your client.

### Claude Code

```bash
claude mcp add aethis -e AETHIS_API_KEY=ak_live_... -- npx -y aethis-mcp
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "aethis": {
      "command": "npx",
      "args": ["-y", "aethis-mcp"],
      "env": { "AETHIS_API_KEY": "ak_live_..." }
    }
  }
}
```

### Cursor / Windsurf

Add to `.cursor/mcp.json` or `.windsurf/mcp.json`:

```json
{
  "mcpServers": {
    "aethis": {
      "command": "npx",
      "args": ["-y", "aethis-mcp"],
      "env": { "AETHIS_API_KEY": "ak_live_..." }
    }
  }
}
```

### OpenAI API key (required for rule generation)

Rule generation uses OpenAI LLM calls. You must provide your own OpenAI API key — Aethis does not cover LLM costs for external users.

Pass your key when generating rules. The key is sent as a header on the generation request, used for that request only, and **never stored**.

Your agent will pass it automatically when you include `openai_key` in your `aethis_generate_and_test`, `aethis_refine`, or `aethis_generate` calls:

```json
{
  "project_id": "proj_abc123",
  "openai_key": "sk-proj-..."
}
```

You can also set it as an environment variable so your agent can read it:

```bash
export OPENAI_API_KEY=sk-proj-...
```

Then tell your agent: *"Use my OPENAI_API_KEY environment variable as the openai_key for generation."*

**Note:** The OpenAI key is only needed for authoring tools (generation, refinement). Decision tools (`aethis_decide`, `aethis_next_question`, etc.) do not use OpenAI and do not require it.

## Your first rule bundle

Every new user starts here. You'll go from a paragraph of policy text to a working eligibility check in about 3 minutes.

### Why tests come first

Aethis uses a **test-driven iteration loop** to get rules right. The cycle works like this:

1. The system generates rules from your **source text** and **guidance hints** — test cases are not passed to the generator
2. Your test cases **validate** the generated rules by checking whether the outcomes are correct
3. Failing tests show you **what's wrong** — which cases the rules don't handle correctly
4. You add **guidance** (domain knowledge, clarifications) based on what failed
5. The system regenerates with your new guidance, and tests validate again

The tests don't steer the generator directly — they steer **you**. They're the feedback loop that tells you where the generated rules diverge from your intent, so you know what guidance to add next. Without good tests, you're flying blind: generation might succeed but produce rules that silently get edge cases wrong.

Write test cases that cover:
- The obvious happy path (clearly eligible)
- The obvious rejection (clearly not eligible)
- The edge cases that matter most (exemptions, overrides, boundary conditions)

The more precisely your tests describe the boundary between eligible and not eligible, the faster you'll converge on correct rules.

**Step 1 — Tell your agent to create a ruleset:**

> Create an Aethis ruleset called "Equipment Policy" with section ID `equipment_policy` from this policy text:
>
> *"All field operatives must carry a valid radio and a first aid kit. Operatives assigned to hazardous zones must additionally carry a gas mask. Trainees are exempt from the gas mask requirement regardless of zone assignment."*
>
> Use these test cases:
> - "fully_equipped_hazardous": operative has radio, first aid kit, gas mask, hazardous zone → eligible
> - "missing_radio": operative has first aid kit but no radio → not_eligible
> - "hazardous_no_mask": operative has radio and first aid kit, hazardous zone, no gas mask → not_eligible
> - "trainee_hazardous_no_mask": trainee with radio and first aid kit, hazardous zone, no gas mask → eligible (trainee exemption)

Your agent calls `aethis_create_ruleset` with the source text and 4 test cases. Returns a `project_id`.

**Step 2 — Generate and test:**

> Generate and test the rules for that project. Use my OpenAI key.

Your agent calls `aethis_generate_and_test`. This takes ~60-120 seconds. You'll see output like:

```
=== Iteration 1: 3/4 passing ===

STILL FAILING:
  x trainee_hazardous_no_mask: expected eligible, got not_eligible

To fix remaining failures:
  - If it requires domain knowledge not in the source, call aethis_add_guidance
    with the missing information, then aethis_generate_and_test.

Bundle: equipment_policy:20260405-a1b2c3d4
```

**Step 3 — Refine until tests pass:**

> The trainee exemption isn't being applied. Refine with this guidance: "The trainee exemption in sentence 3 overrides the gas mask requirement from sentence 2. If is_trainee is true, the gas mask check should be skipped entirely."

Your agent calls `aethis_refine`. Another ~60-120 seconds:

```
=== Iteration 2: 4/4 passing ===

IMPROVED:
  + trainee_hazardous_no_mask — was FAIL, now PASS

All tests passing! Call aethis_publish to publish.

Bundle: equipment_policy:20260405-e5f6a7b8
```

**Step 4 — Publish and use:**

> Publish that bundle, then check if an operative with a radio and first aid kit in a standard zone is eligible.

Your agent calls `aethis_publish` (which runs tests first and blocks if any fail), then `aethis_decide`:

```json
{
  "decision": "eligible",
  "bundle_id": "equipment_policy:20260405-e5f6a7b8",
  "fields_provided": 3,
  "fields_evaluated": 5
}
```

That bundle is now a shared, versioned API endpoint. Every agent in your organisation — Claude Code, Cursor, a production microservice, a compliance dashboard — calls the same rules and gets the same answer. No prompt drift, no model-version surprises, no "it depends which LLM you use." One source of truth, compiled from the actual policy document.

## Conversational eligibility

Instead of providing all field values upfront, walk a user through one question at a time. The tool returns questions in priority order — the most discriminating question first — so you reach a decision in the fewest possible steps.

```
Agent: [calls aethis_next_question(bundle_id, {})]

→ Decision: undetermined (0/5 fields provided)

  Next question to ask:
    Field: equipment.has_radio
    Question: Does the operative carry a valid radio?
    Priority weight: 1 (lower = more important)

  Full remaining path (4 questions):
    1. Does the operative carry a valid radio? (equipment.has_radio, weight=1)
    2. Does the operative carry a first aid kit? (equipment.has_first_aid, weight=2)
    3. Is the operative assigned to a hazardous zone? (zone.is_hazardous, weight=3)
    4. Does the operative carry a gas mask? (equipment.has_gas_mask, weight=4)
```

The agent asks the user, collects the answer, and calls again with the accumulated fields:

```
Agent: [calls aethis_next_question(bundle_id, {"equipment.has_radio": false})]

→ Decision: not eligible. No more questions needed.
```

One question was enough. An operative without a radio is ineligible regardless of zone or other equipment — the engine knows this from the compiled rules and short-circuits.

## Discovering what's available

```
aethis_list_projects()             → All your projects with status and latest bundle
aethis_list_bundles(project_id)    → All bundles for a project (active + archived)
aethis_schema(bundle_id)           → What fields a bundle needs (types, descriptions, enums)
aethis_explain(bundle_id)          → Human-readable rule descriptions with criteria groups
```

To see the full evaluation trace and source citations for a decision, pass `include_trace: true` and `include_explanation: true` to `aethis_decide`.

## Tool reference

19 tools organised into six groups.

### Decision tools

| Tool | Parameters | What it does |
|------|-----------|-------------|
| `aethis_decide` | `bundle_id`, `field_values`, `include_trace?`, `include_explanation?` | Evaluate eligibility. Returns `eligible` / `not_eligible` / `undetermined`. |
| `aethis_schema` | `bundle_id` | Get input field definitions (types, descriptions, enums). |
| `aethis_next_question` | `bundle_id`, `field_values` | Get the optimal next question for a conversational check. |
| `aethis_explain` | `bundle_id` | Get human-readable rule descriptions. |

### Discovery tools

| Tool | Parameters | What it does |
|------|-----------|-------------|
| `aethis_list_projects` | *(none)* | List all projects with status and latest bundle. |
| `aethis_project_status` | `project_id` | Check generation job status and progress. |
| `aethis_list_bundles` | `project_id` | List all bundles for a project (version history). |

### Test case tools

| Tool | Parameters | What it does |
|------|-----------|-------------|
| `aethis_list_tests` | `project_id` | List all test cases with names, field values, and expected outcomes. |
| `aethis_get_test` | `project_id`, `tc_id` | Get a single test case by ID. |
| `aethis_update_test` | `project_id`, `tc_id`, `name?`, `field_values?`, `expected_outcome?` | Update a test case (partial update — only provided fields change). |
| `aethis_delete_test` | `project_id`, `tc_id` | Delete a test case permanently. |

### Management tools

| Tool | Parameters | What it does |
|------|-----------|-------------|
| `aethis_archive_project` | `project_id` | Archive a project permanently. |
| `aethis_archive_bundle` | `bundle_id` | Archive a bundle permanently (excluded from decisions). |

### Authoring tools

| Tool | Parameters | What it does |
|------|-----------|-------------|
| `aethis_create_ruleset` | `name`, `section_id`, `source_text`, `test_cases`, `domain?` | Create a project with source text and test cases (TDD). |
| `aethis_generate_and_test` | `project_id` | Generate rules and run tests (~60-120s). Shows pass/fail and regressions. |
| `aethis_add_guidance` | `project_id`, `guidance_text` | Add domain knowledge not in the source text. |
| `aethis_refine` | `project_id`, `feedback?` | Add guidance + regenerate + test in one call. |
| `aethis_generate` | `project_id` | Trigger generation only (async). Poll with `aethis_project_status`. |
| `aethis_publish` | `project_id`, `force?` | Publish bundle. Blocks on test failures unless `force=true`. |

### Test case format

Every test case passed to `aethis_create_ruleset` must have these three keys:

```json
{
  "name": "descriptive_scenario_name",
  "field_values": { "field.id": "value", "another.field": true },
  "expected_outcome": "eligible"
}
```

`expected_outcome` must be `eligible`, `not_eligible`, or `undetermined`.

## Troubleshooting

**"API key is required"** — `AETHIS_API_KEY` is not set. MCP servers don't inherit your shell environment — configure it in your MCP client settings (the JSON config or `-e` flag).

**"Refusing to use HTTP for remote host"** — HTTPS is enforced for all remote connections. The Aethis API at `api.aethis.ai` uses HTTPS by default. If you see this error, check that your `AETHIS_API_KEY` is set correctly and you haven't overridden the base URL.

**"Bundle not found" (404)** — The bundle ID is wrong or the bundle was archived. Use `aethis_list_projects` → `aethis_list_bundles` to find active bundles.

**"Rate limit exceeded" (429)** — The client retries automatically with exponential backoff. If you're consistently hitting limits, contact [eng@aethis.ai](mailto:eng@aethis.ai).

**`aethis_generate_and_test` times out** — Generation typically takes 60-120s; the client waits up to 5 minutes. If it times out, check `aethis_project_status` to see if the job is still running.

**"X-OpenAI-Key header is required" (400)** — Rule generation requires your own OpenAI API key. Pass it as the `openai_key` parameter on `aethis_generate_and_test`, `aethis_refine`, or `aethis_generate`. See [OpenAI API key](#openai-api-key-required-for-rule-generation) above.

**"Cannot publish: tests failing"** — `aethis_publish` runs tests first and blocks if any fail. Fix with `aethis_refine`, or pass `force=true` to override.

## Related tools

**[aethis-cli](https://github.com/aethis-ai/aethis-cli)** — Python CLI for rule authoring with YAML-based test cases, browser sign-in, and Rich terminal output. Use the CLI for file-based authoring workflows; use this MCP server for agent integration.

## Development

```bash
git clone https://github.com/aethis-ai/aethis-mcp.git
cd aethis-mcp
npm install
npm test          # 90 tests
npm run build
```

## License

MIT
