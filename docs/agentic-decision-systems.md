# Building Decision Systems with AI Agents

## The pattern

An AI agent designs the decision system. A formal engine executes the decisions. No LLM is in the decision path at runtime.

```
┌─────────────────────────────────────────────────────────────────┐
│  AUTHORING TIME (agent + LLM)                                   │
│                                                                  │
│  Agent reads policy document                                     │
│       ↓                                                          │
│  Agent writes test cases (expected outcomes)                     │
│       ↓                                                          │
│  aethis_create_ruleset({ source_text, test_cases })              │
│       ↓                                                          │
│  aethis_generate_and_test()  ←→  iterate until tests pass        │
│       ↓                                                          │
│  aethis_publish()  →  rules are now a live API endpoint          │
│                                                                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                        published ruleset
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│  RUNTIME (no LLM)                                                │
│                                                                  │
│  aethis_decide({ ruleset_id, field_values })                      │
│       ↓                                                          │
│  SMT constraint evaluation  →  eligible / not_eligible           │
│       +                                                          │
│  Full audit trail  →  decision → rule → source clause            │
│                                                                  │
│  < 5ms  •  deterministic  •  same answer every time              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Why this matters for high-stakes decisions

**The agent is creative.** It reads policy documents, understands context, writes test cases, refines rules when they fail. This is what LLMs are good at.

**The engine is deterministic.** It evaluates formal constraints with mathematical semantics. `OR(a, b)` is true if either operand is true — no weighting, no context collapse, no temperature. This is what high-stakes decisions require.

The separation means:
- **No model versioning risk.** Published rules are immutable. A model update doesn't change yesterday's decisions.
- **Full provenance.** Every decision traces through the exact rule to the exact source clause. Not a post-hoc rationalisation — the actual logical path.
- **Audit-ready.** A regulator can verify the determination by checking the logical path against the policy wording.
- **Near-zero marginal cost.** After compilation, each decision costs fractions of a cent and takes < 5ms.

## Integration patterns

### 1. Agent authors rules during development (MCP)

A developer or AI coding agent uses the MCP server to compile policy documents into decision endpoints during development. This is the workflow shown in the [demo](demo-construction-insurance.md).

```
Claude Code / Cursor / Windsurf
       ↓ (MCP protocol)
  aethis MCP server
       ↓ (REST API)
  Aethis platform (api.aethis.ai)
       ↓
  Published ruleset
```

The agent handles the creative work: reading the policy, writing test cases, refining guidance when tests fail. The platform handles compilation and formal evaluation.

### 2. Custom agent builds decision systems programmatically (SDK)

A custom agent built with Claude Agent SDK or LangGraph can author rules programmatically via the REST API:

```python
# Agent reads a new compliance regulation
source_text = agent.extract_from_document("regulation-2025.pdf")

# Agent designs test cases based on its understanding
test_cases = agent.design_test_suite(source_text)

# Create the ruleset
project = aethis.create_project(name="Regulation 2025", section_id="reg_2025")
aethis.upload_source(project.id, source_text)
aethis.add_tests(project.id, test_cases)

# Generate and iterate until tests pass
result = aethis.generate_and_test(project.id)
if result.passed < result.total:
    aethis.add_guidance(project.id, "The exemption in Section 4 applies independently...")
    result = aethis.generate_and_test(project.id)

# Publish — rules are now a live endpoint
aethis.publish(project.id)
```

### 3. Production app calls the decision API (REST)

At runtime, no MCP server or agent is needed. Any application calls the REST API directly:

```bash
curl -X POST https://api.aethis.ai/api/v1/public/decide \
  -H "Content-Type: application/json" \
  -d '{
    "ruleset_id": "car_defect_endorsement:20260408-285d1720",
    "field_values": {
      "car.project.value_millions_gbp": 600,
      "car.defect.origin": "design",
      "car.claim.is_access_damage": true
    }
  }'
```

The engine returns `eligible` or `not_eligible` — or `undetermined` with the optimal next question to ask, enabling interactive workflows where the system adapts its questions based on what it already knows.

## What this enables

| Use case | Agent designs | Engine decides |
|----------|:---:|:---:|
| Insurance claims adjudication | Reads policy wording, writes exclusion rules | Evaluates each claim in < 5ms |
| Loan eligibility | Reads lending criteria, encodes thresholds | Pre-qualifies applicants deterministically |
| Immigration compliance | Reads legislation, captures exemption chains | Assesses eligibility with full audit trail |
| Benefits entitlement | Reads welfare regulations, models means tests | Determines eligibility with provenance |
| Safety certification | Reads certification standards, encodes requirements | Certifies compliance formally |

In every case, the LLM's creativity is used at authoring time. The formal engine's guarantees are used at decision time. The two capabilities complement each other — and neither is asked to do the other's job.
