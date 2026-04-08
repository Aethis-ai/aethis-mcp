# Demo: From Policy Wording to Live Decision Engine in 5 Minutes

> This is a real transcript from an MCP session. Every tool call, every response, every decision is live and reproducible. No editing, no cherry-picking.

## The source material

A London market Construction All Risks (CAR) policy endorsement with a five-level nested exception chain for defect exclusions. This is modelled on real DE3/DE5 clause structures used for major infrastructure projects.

The exception chain:

> Access damage is **excluded** (Clause 8).
> Unless the project is worth >= 100M — **enhanced cover reinstates** it (Clause 9(1)).
> Unless the defect is a **design defect** — enhanced cover doesn't apply (Clause 9(2)).
> Unless the project is worth >= 500M — **pioneer override reinstates** it (Clause 9(3)).
> Unless the defect was **known prior** — pioneer override is blocked (Clause 9A(1)).
> Unless there's an **engineer assessment** — the block is lifted (Clause 9A(2)).

GPT-5.3, a production-tier OpenAI model, scores **64% on this exception chain** — seven correct answers out of eleven, with all failures on multi-level exception scenarios. GPT-5.4, a frontier model, drops to the same 63% when reasoning effort is reduced. ([Full benchmark](https://github.com/Aethis-ai/aethis-examples))

---

## Step 1: Create the rule bundle

Paste the policy wording and define test cases. The test cases drive the authoring process — better tests, faster convergence.

```
aethis_create_bundle({
  name: "CAR Policy Defect Exclusion Endorsement 2025",
  section_id: "car_defect_endorsement",
  domain: "insurance",
  source_text: "... 12KB of policy wording ...",
  test_cases: [
    { name: "Rectification — absolute exclusion (Cl.6)",           expected_outcome: "not_eligible" },
    { name: "Consequential damage — carve-back (Cl.7a)",           expected_outcome: "eligible" },
    { name: "Access damage, standard project — excluded (Cl.8)",   expected_outcome: "not_eligible" },
    { name: "Access damage, £150M project — reinstated (Cl.9)",    expected_outcome: "eligible" },
    { name: "Design defect, £150M — NOT reinstated (Cl.9(2))",     expected_outcome: "not_eligible" },
    { name: "Design defect, £600M pioneer — override (Cl.9(3))",   expected_outcome: "eligible" },
    { name: "Plant equipment — excluded category (Cl.5)",           expected_outcome: "not_eligible" },
    { name: "Late notification — void (Cl.11)",                     expected_outcome: "not_eligible" },
    { name: "Pioneer + known defect — BLOCKED (Cl.9A)",            expected_outcome: "not_eligible" },
    { name: "Pioneer + known + engineer — UNBLOCKED (Cl.9A(2))",   expected_outcome: "eligible" },
    { name: "Pioneer + defect NOT known — applies normally",        expected_outcome: "eligible" }
  ]
})
```

```
Rule bundle created successfully.
  Project ID: proj_nVKX4EnfOzOkkmj-
  Section: car_defect_endorsement
  Source: 11,774 characters uploaded
  Tests: 11 test case(s) added
```

---

## Step 2: Generate and test

The engine reads the policy wording, generates formal rules, and validates them against all 11 test cases. No LLM is involved in the testing — rules are compiled to formal constraints and evaluated by an SMT solver.

```
aethis_generate_and_test({ project_id: "proj_nVKX4EnfOzOkkmj-" })
```

Progress updates stream in real-time:

```
[20%] Starting rule generation agent...
[23%] Turn 1/20...
[30%] Turn 3/20...
[44%] Turn 7/20...
[55%] Turn 10/20...
[100%] All tests passed — stopping.
```

```
=== Iteration 1: 11/11 passing ===

All tests passing! Call aethis_publish to publish.

Bundle: car_defect_endorsement:20260408-285d1720
```

**11 out of 11 tests pass.** Including the five-level exception chain that GPT-5.3 scores 27% on.

---

## Step 3: Publish

```
aethis_publish({ project_id: "proj_nVKX4EnfOzOkkmj-" })
```

```
Published successfully!
  Bundle: car_defect_endorsement:20260408-285d1720
  Version: v2
  Tests: 11/11 passing
```

The bundle is now a live API endpoint. Every decision from here uses formal constraint evaluation — no LLM, no probability, no temperature.

---

## Step 4: Make decisions

### The scenario GPT gets wrong

A £600M pioneer infrastructure project. Design defect. Access damage claim.

```
aethis_decide({
  bundle_id: "car_defect_endorsement:20260408-285d1720",
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
    "car.contract.jct_compliant": true,
    "car.defect.was_known_prior": false
  },
  include_trace: true
})
```

```json
{
  "decision": "eligible",
  "trace": {
    "group_statuses": {
      "policy_period": "satisfied",
      "insuring_clause": "satisfied",
      "property_category": "satisfied",
      "notification": "satisfied",
      "jct_contract": "satisfied",
      "rectification_exclusion": "satisfied",
      "damage_cover_route": "satisfied"
    }
  }
}
```

**Aethis says: COVERED.** Pioneer override (Clause 9(3)) reinstates coverage for design defects on projects >= £500M.

**GPT says: not covered.** It collapses the exception chain and treats the design defect exclusion as absolute.

### Add a complication: known defect

Same claim, but the defect was known before work started.

```
aethis_decide({
  field_values: {
    ...same as above,
    "car.defect.was_known_prior": true,
    "car.defect.has_engineer_assessment": false
  }
})
```

```json
{ "decision": "not_eligible" }
```

**NOT COVERED.** The known defect limitation (Clause 9A) blocks the pioneer override. The trace shows exactly why — `was_known_prior=True AND has_engineer_assessment=False` fails the condition `OR(not known, has assessment)`.

### Unblock it: add the engineer assessment

```
aethis_decide({
  field_values: {
    ...same as above,
    "car.defect.was_known_prior": true,
    "car.defect.has_engineer_assessment": true
  }
})
```

```json
{ "decision": "eligible" }
```

**COVERED again.** The independent engineer assessment lifts the known-defect block. This is depth 5 in the exception chain — the kind of nested logic that LLMs consistently fail on.

### Early termination: plant equipment

```
aethis_decide({
  field_values: {
    "car.policy.period_valid": true,
    "car.property.category": "plant_equipment"
  }
})
```

```json
{
  "decision": "not_eligible",
  "fields_provided": 2,
  "missing_fields": ["car.loss.is_physical", "car.component.is_defective", ...]
}
```

**NOT COVERED after just 2 fields.** The engine knows plant equipment is excluded — it doesn't need the other 12 fields to tell you the answer.

---

## Step 5: Explain the rules

```
aethis_explain({ bundle_id: "car_defect_endorsement:20260408-285d1720" })
```

Returns every rule in human-readable form with clause references:

| Rule | Plain English |
|------|--------------|
| `policy_period_valid` | Loss occurred within the policy period |
| `insuring_clause_satisfied` | Physical loss AND defective component both established |
| `property_category_covered` | Property is permanent works, temporary works, existing structures, or materials on site |
| `not_rectification_claim` | Claim is not for rectification of the defective component |
| `carve_back_not_access_damage` | Damage is not access damage (Clause 7) |
| `access_damage_nondesign_100m` | Access damage, non-design defect, value >= £100M (Clause 9) |
| `access_damage_pioneer_design_override` | Access damage, design defect, pioneer >= £500M, with Cl.9A check |

Every rule traces back to a specific clause in the policy wording.

---

## The comparison

Live benchmark results (April 2026) — same source text, same test cases, same prompt. Reproducible via:

```bash
uv run llm_comparison.py construction-all-risks/ \
  --models gpt-5.4 gpt-5.3-chat-latest claude-opus-4-6 claude-sonnet-4-6 \
  --runs 1
```

| Model | Config | Accuracy | Notes |
|-------|--------|:--------:|-------|
| **Aethis Engine** | — | **11/11 (100%)** | Deterministic, < 5ms, full audit trail |
| Claude Opus 4.6 | default | 11/11 (100%) | Correct, but 2-5s per call |
| Claude Opus 4.6 | temp=1.0 | 11/11 (100%) | Robust even at max temperature |
| GPT-5.4 | default (high reasoning) | 10/11 (91%) | 1 false negative on enhanced access |
| Claude Sonnet 4.6 | default | 10/11 (91%) | 1 parse error |
| GPT-5.3 | default | 7/11 (64%) | 4 false negatives on exception chains |
| **GPT-5.4** | **low reasoning** | **7/11 (63%)** | **Same failures as GPT-5.3** |

The most telling result: **GPT-5.4 at low reasoning effort drops from 91% to 63%** — matching GPT-5.3's score exactly. All four new failures are false negatives on exception chain scenarios (enhanced cover, pioneer override, depth-5 unblock). The accuracy depends entirely on how much compute the model spends on reasoning. Opus 4.6 doesn't degrade even at maximum temperature.

In production, you can't guarantee that every API call uses maximum reasoning effort. You can't guarantee the model version won't change. You can't guarantee the same answer on retry. These aren't hypothetical risks — they're measurable in this benchmark.

| Property | Aethis Engine | Best LLM |
|----------|:---:|:---:|
| Deterministic | Yes | No |
| Reasoning-effort invariant | Yes | No (91% → 63% on GPT-5.4) |
| Latency | < 5ms | 2-5s |
| Audit trail | Full provenance | Post-hoc rationalisation |
| Model deprecation risk | None | Version-dependent |
| Cost per decision | Near-zero | ~$0.02 |

The LLM is used once, at authoring time, to compile the policy wording into formal logic. After that, every decision is pure constraint evaluation — deterministic, auditable, and instant.
