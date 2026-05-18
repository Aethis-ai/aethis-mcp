# Dangerous Dogs Act BSL Compliance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author and publish an Aethis ruleset encoding breed-specific legislation compliance under s.1 of the Dangerous Dogs Act 1991 (as amended).

**Architecture:** Single flat ruleset authored via the Aethis MCP authoring pipeline. Source text → field discovery → field spec validation → test cases → generate rules → refine until green → publish. All steps use MCP tools (`aethis_*`); no application code is written.

**Tech Stack:** Aethis MCP tools (aethis_create_ruleset, aethis_discover_fields, aethis_generate_and_test, aethis_refine, aethis_publish). Requires `AETHIS_API_KEY` configured in MCP client.

**Spec:** `docs/superpowers/specs/2026-05-18-dangerous-dogs-bsl-design.md`

---

### Task 1: Create the ruleset with source text and test cases

**Purpose:** Bootstrap the project with the legislative source text and all 14 test cases from the spec. The Aethis platform will use the source text for field discovery and rule generation.

- [ ] **Step 1: Call `aethis_create_ruleset`**

Use these parameters:

- `name`: `"Dangerous Dogs Act 1991 — BSL Compliance (s.1 Exemption Scheme)"`
- `section_id`: `"dangerous-dogs-bsl-compliance"`
- `domain`: `"uk_animal_law"`
- `source_text`: the full legislative source text (below)
- `test_cases`: all 14 test cases (below)

**Source text to use:**

```
Dangerous Dogs Act 1991, Section 1 — Breed-Specific Legislation and Exemption Scheme

(As amended by the Dangerous Dogs (Amendment) Act 1997, Anti-social Behaviour, Crime and Policing Act 2014 s.107, and the Dangerous Dogs Exemption Schemes (England and Wales) Order 2015.)

PROHIBITED TYPES

Section 1(1): The following types of dog are prohibited:
(a) any dog of the type known as the pit bull terrier;
(b) any dog of the type known as the Japanese tosa;
(c) any dog of the type known as the Dogo Argentino;
(d) any dog of the type known as the Fila Brasileiro.

A dog that is not of a prohibited type is not subject to any restriction under this section.

POSSESSION OFFENCE

Section 1(3): No person shall have any dog to which this section applies in his possession or custody except in accordance with an exemption order.

INDEX OF EXEMPTED DOGS (IED) AND EXEMPTION CONDITIONS

Under the Dangerous Dogs Exemption Schemes (England and Wales) Order 2015, a prohibited-type dog may be kept if it is entered on the Index of Exempted Dogs and a certificate of exemption has been issued. The following conditions must ALL be met:

1. NEUTERING: The dog must be neutered.
2. MICROCHIPPING: The dog must be microchipped with a compliant microchip.
3. THIRD-PARTY INSURANCE: The owner must hold a policy of insurance in respect of third-party liability for injury to any person caused by the dog.
4. LEAD AND MUZZLE IN PUBLIC: When in a public place, the dog must be kept on a lead and muzzled at all times.
5. HANDLER AGE: The person in charge of the dog in a public place must be aged 16 or over.
6. SECURE CONFINEMENT: When at home or on private premises, the dog must be kept in sufficiently secure conditions to prevent its escape.

NOTIFICATION DUTIES

The owner must notify the Index of Exempted Dogs of:
(a) any change of address — within 30 days;
(b) the death of the dog — within 30 days;
(c) any transfer of ownership or custody — before the transfer takes place.
Failure to notify is a breach of the exemption conditions.

BREEDING, SALE, AND EXCHANGE PROHIBITION

It is an offence to breed from, sell, exchange, gift, or advertise for sale a dog to which section 1 applies, whether or not the dog is on the Index of Exempted Dogs.

COMPLIANCE DETERMINATION

A prohibited-type dog is legally held if and only if ALL of the following are true:
- The dog is on the Index of Exempted Dogs with a valid certificate of exemption.
- The dog is neutered.
- The dog is microchipped.
- The owner holds third-party insurance.
- The dog is kept on a lead and muzzled in all public places.
- The person in charge of the dog in public is aged 16 or over.
- The dog is securely confined at home.
- All notification duties have been satisfied (or no notifiable event has occurred).
- The owner has not bred from, sold, exchanged, or gifted the dog.

If any condition is not met, the dog is not legally held and the owner is in breach.
If the dog is not of a prohibited type, no restrictions under this section apply.
```

**Test cases to use:**

```json
[
  {
    "name": "not_prohibited_type",
    "field_values": { "dog_type": "not_prohibited" },
    "expected_outcome": "satisfied"
  },
  {
    "name": "pit_bull_fully_compliant",
    "field_values": {
      "dog_type": "pit_bull_terrier",
      "has_exemption_certificate": true,
      "is_neutered": true,
      "is_microchipped": true,
      "has_third_party_insurance": true,
      "kept_on_lead_in_public": true,
      "muzzled_in_public": true,
      "handler_age": 30,
      "securely_confined_at_home": true,
      "address_change_notified": null,
      "death_notified": null,
      "ownership_transfer_notified": null,
      "has_bred_or_sold": false
    },
    "expected_outcome": "satisfied"
  },
  {
    "name": "no_exemption_certificate",
    "field_values": {
      "dog_type": "pit_bull_terrier",
      "has_exemption_certificate": false,
      "is_neutered": true,
      "is_microchipped": true,
      "has_third_party_insurance": true,
      "kept_on_lead_in_public": true,
      "muzzled_in_public": true,
      "handler_age": 30,
      "securely_confined_at_home": true,
      "address_change_notified": null,
      "death_notified": null,
      "ownership_transfer_notified": null,
      "has_bred_or_sold": false
    },
    "expected_outcome": "not_satisfied"
  },
  {
    "name": "not_neutered",
    "field_values": {
      "dog_type": "pit_bull_terrier",
      "has_exemption_certificate": true,
      "is_neutered": false,
      "is_microchipped": true,
      "has_third_party_insurance": true,
      "kept_on_lead_in_public": true,
      "muzzled_in_public": true,
      "handler_age": 30,
      "securely_confined_at_home": true,
      "address_change_notified": null,
      "death_notified": null,
      "ownership_transfer_notified": null,
      "has_bred_or_sold": false
    },
    "expected_outcome": "not_satisfied"
  },
  {
    "name": "no_insurance",
    "field_values": {
      "dog_type": "pit_bull_terrier",
      "has_exemption_certificate": true,
      "is_neutered": true,
      "is_microchipped": true,
      "has_third_party_insurance": false,
      "kept_on_lead_in_public": true,
      "muzzled_in_public": true,
      "handler_age": 30,
      "securely_confined_at_home": true,
      "address_change_notified": null,
      "death_notified": null,
      "ownership_transfer_notified": null,
      "has_bred_or_sold": false
    },
    "expected_outcome": "not_satisfied"
  },
  {
    "name": "not_microchipped",
    "field_values": {
      "dog_type": "pit_bull_terrier",
      "has_exemption_certificate": true,
      "is_neutered": true,
      "is_microchipped": false,
      "has_third_party_insurance": true,
      "kept_on_lead_in_public": true,
      "muzzled_in_public": true,
      "handler_age": 30,
      "securely_confined_at_home": true,
      "address_change_notified": null,
      "death_notified": null,
      "ownership_transfer_notified": null,
      "has_bred_or_sold": false
    },
    "expected_outcome": "not_satisfied"
  },
  {
    "name": "not_muzzled_in_public",
    "field_values": {
      "dog_type": "pit_bull_terrier",
      "has_exemption_certificate": true,
      "is_neutered": true,
      "is_microchipped": true,
      "has_third_party_insurance": true,
      "kept_on_lead_in_public": true,
      "muzzled_in_public": false,
      "handler_age": 30,
      "securely_confined_at_home": true,
      "address_change_notified": null,
      "death_notified": null,
      "ownership_transfer_notified": null,
      "has_bred_or_sold": false
    },
    "expected_outcome": "not_satisfied"
  },
  {
    "name": "handler_underage",
    "field_values": {
      "dog_type": "pit_bull_terrier",
      "has_exemption_certificate": true,
      "is_neutered": true,
      "is_microchipped": true,
      "has_third_party_insurance": true,
      "kept_on_lead_in_public": true,
      "muzzled_in_public": true,
      "handler_age": 15,
      "securely_confined_at_home": true,
      "address_change_notified": null,
      "death_notified": null,
      "ownership_transfer_notified": null,
      "has_bred_or_sold": false
    },
    "expected_outcome": "not_satisfied"
  },
  {
    "name": "not_securely_confined",
    "field_values": {
      "dog_type": "pit_bull_terrier",
      "has_exemption_certificate": true,
      "is_neutered": true,
      "is_microchipped": true,
      "has_third_party_insurance": true,
      "kept_on_lead_in_public": true,
      "muzzled_in_public": true,
      "handler_age": 30,
      "securely_confined_at_home": false,
      "address_change_notified": null,
      "death_notified": null,
      "ownership_transfer_notified": null,
      "has_bred_or_sold": false
    },
    "expected_outcome": "not_satisfied"
  },
  {
    "name": "has_bred_or_sold",
    "field_values": {
      "dog_type": "pit_bull_terrier",
      "has_exemption_certificate": true,
      "is_neutered": true,
      "is_microchipped": true,
      "has_third_party_insurance": true,
      "kept_on_lead_in_public": true,
      "muzzled_in_public": true,
      "handler_age": 30,
      "securely_confined_at_home": true,
      "address_change_notified": null,
      "death_notified": null,
      "ownership_transfer_notified": null,
      "has_bred_or_sold": true
    },
    "expected_outcome": "not_satisfied"
  },
  {
    "name": "address_change_not_notified",
    "field_values": {
      "dog_type": "pit_bull_terrier",
      "has_exemption_certificate": true,
      "is_neutered": true,
      "is_microchipped": true,
      "has_third_party_insurance": true,
      "kept_on_lead_in_public": true,
      "muzzled_in_public": true,
      "handler_age": 30,
      "securely_confined_at_home": true,
      "address_change_notified": false,
      "death_notified": null,
      "ownership_transfer_notified": null,
      "has_bred_or_sold": false
    },
    "expected_outcome": "not_satisfied"
  },
  {
    "name": "all_notifications_null_fully_compliant",
    "field_values": {
      "dog_type": "pit_bull_terrier",
      "has_exemption_certificate": true,
      "is_neutered": true,
      "is_microchipped": true,
      "has_third_party_insurance": true,
      "kept_on_lead_in_public": true,
      "muzzled_in_public": true,
      "handler_age": 25,
      "securely_confined_at_home": true,
      "address_change_notified": null,
      "death_notified": null,
      "ownership_transfer_notified": null,
      "has_bred_or_sold": false
    },
    "expected_outcome": "satisfied"
  },
  {
    "name": "japanese_tosa_fully_compliant",
    "field_values": {
      "dog_type": "japanese_tosa",
      "has_exemption_certificate": true,
      "is_neutered": true,
      "is_microchipped": true,
      "has_third_party_insurance": true,
      "kept_on_lead_in_public": true,
      "muzzled_in_public": true,
      "handler_age": 18,
      "securely_confined_at_home": true,
      "address_change_notified": null,
      "death_notified": null,
      "ownership_transfer_notified": null,
      "has_bred_or_sold": false
    },
    "expected_outcome": "satisfied"
  },
  {
    "name": "dogo_argentino_fully_compliant",
    "field_values": {
      "dog_type": "dogo_argentino",
      "has_exemption_certificate": true,
      "is_neutered": true,
      "is_microchipped": true,
      "has_third_party_insurance": true,
      "kept_on_lead_in_public": true,
      "muzzled_in_public": true,
      "handler_age": 40,
      "securely_confined_at_home": true,
      "address_change_notified": true,
      "death_notified": null,
      "ownership_transfer_notified": null,
      "has_bred_or_sold": false
    },
    "expected_outcome": "satisfied"
  },
  {
    "name": "fila_brasileiro_fully_compliant",
    "field_values": {
      "dog_type": "fila_brasileiro",
      "has_exemption_certificate": true,
      "is_neutered": true,
      "is_microchipped": true,
      "has_third_party_insurance": true,
      "kept_on_lead_in_public": true,
      "muzzled_in_public": true,
      "handler_age": 22,
      "securely_confined_at_home": true,
      "address_change_notified": null,
      "death_notified": null,
      "ownership_transfer_notified": null,
      "has_bred_or_sold": false
    },
    "expected_outcome": "satisfied"
  },
  {
    "name": "missing_key_fields_pending",
    "field_values": {
      "dog_type": "pit_bull_terrier",
      "has_exemption_certificate": true
    },
    "expected_outcome": "pending"
  }
]
```

Record the returned `project_id` — it is needed for all subsequent steps.

- [ ] **Step 2: Verify creation succeeded**

The response should contain a `project_id` (format: `proj_...`). If it fails with an auth error, check that `AETHIS_API_KEY` is set in the MCP client config.

---

### Task 2: Set field spec and discover fields

**Purpose:** Lock in the expected field vocabulary so discovery validates against it automatically, then run discovery to see what the platform extracts from the source text.

- [ ] **Step 1: Call `aethis_set_field_spec`**

Use the `project_id` from Task 1. Expected fields:

```json
[
  { "key": "dog_type", "sort": "Enum", "enum_values": ["pit_bull_terrier", "japanese_tosa", "dogo_argentino", "fila_brasileiro", "not_prohibited"] },
  { "key": "has_exemption_certificate", "sort": "Bool" },
  { "key": "is_neutered", "sort": "Bool" },
  { "key": "is_microchipped", "sort": "Bool" },
  { "key": "has_third_party_insurance", "sort": "Bool" },
  { "key": "kept_on_lead_in_public", "sort": "Bool" },
  { "key": "muzzled_in_public", "sort": "Bool" },
  { "key": "handler_age", "sort": "Int" },
  { "key": "securely_confined_at_home", "sort": "Bool" },
  { "key": "address_change_notified", "sort": "Bool" },
  { "key": "death_notified", "sort": "Bool" },
  { "key": "ownership_transfer_notified", "sort": "Bool" },
  { "key": "has_bred_or_sold", "sort": "Bool" }
]
```

- [ ] **Step 2: Call `aethis_discover_fields`**

Pass the `project_id`. The response includes a `validation_result` block showing matches and mismatches against the spec.

- [ ] **Step 3: Check validation result**

Expected: `all_match: true`. If there are mismatches (missing fields, wrong types, wrong enum values), proceed to Task 2a. If `all_match: true`, skip Task 2a and go to Task 3.

---

### Task 2a: Refine fields (conditional — only if validation fails)

**Purpose:** Fix any field discovery mismatches before generating rules.

- [ ] **Step 1: Call `aethis_refine_fields` with targeted feedback**

For each mismatch, provide specific guidance. Examples:

- Missing `handler_age`: `"The exemption conditions require the person in charge of the dog in public to be aged 16 or over. This should be captured as an integer field 'handler_age'."`
- Wrong enum values on `dog_type`: `"The dog_type field should have exactly five values: pit_bull_terrier, japanese_tosa, dogo_argentino, fila_brasileiro, not_prohibited."`
- Notification fields typed as Enum instead of Bool: `"The notification fields (address_change_notified, death_notified, ownership_transfer_notified) are boolean fields. They are true if the owner notified, false if they failed to notify, or null if no notifiable event occurred."`

- [ ] **Step 2: Re-check validation result**

Repeat until `all_match: true`. If stuck after 3 iterations, proceed to Task 3 — the rule generator can compensate for minor field naming differences.

---

### Task 3: Generate rules and run tests

**Purpose:** Generate the compiled rules from the source text and run all 16 test cases.

- [ ] **Step 1: Call `aethis_generate_and_test`**

Pass the `project_id`. This takes 60–120 seconds. The response shows pass/fail for each test case.

- [ ] **Step 2: Evaluate results**

Expected: all 16 tests pass. If all pass, skip Task 4 and go to Task 5. If any fail, proceed to Task 4.

---

### Task 4: Refine rules (conditional — only if tests fail)

**Purpose:** Diagnose and fix failing tests by adding guidance.

- [ ] **Step 1: For each failing test, call `aethis_explain_failure`**

Pass the `ruleset_id` (from the generate response), the test's `field_values`, and `expected_outcome`. The response explains why the rule produced the wrong result and suggests a fix.

- [ ] **Step 2: Call `aethis_refine` with targeted feedback**

Combine the diagnoses into a single guidance string. Be specific and reference the source text. Examples:

- `"When dog_type is 'not_prohibited', the dog is not subject to any restriction under s.1. The result must be 'satisfied' regardless of other field values — other fields should not be required."`
- `"Notification fields use null to mean 'no notifiable event has occurred'. A null value should be treated the same as true (duty satisfied). Only false means the duty was breached."`
- `"handler_age >= 16 is required. A handler aged 15 must produce 'not_satisfied'."`

This calls generate + test automatically. Check the results.

- [ ] **Step 3: Repeat until all tests pass**

If tests still fail after refinement, call `aethis_explain_failure` again on remaining failures and refine with more specific guidance. Expect convergence within 2–3 iterations.

---

### Task 5: Publish the ruleset

**Purpose:** Make the passing ruleset available for decisions.

- [ ] **Step 1: Call `aethis_publish`**

Parameters:
- `project_id`: from Task 1
- `label`: `"v1 — BSL compliance, s.1 exemption scheme (DDA 1991 as amended)"`

The tool runs tests automatically before publishing and refuses if any fail.

- [ ] **Step 2: Verify publication**

The response returns a `ruleset_id` and `slug`. Record both. The slug will be used for `aethis_decide` and `aethis_schema` calls.

---

### Task 6: Smoke-test the published ruleset

**Purpose:** Confirm the published ruleset works end-to-end via the decision API.

- [ ] **Step 1: Call `aethis_decide` — non-prohibited dog**

```json
{
  "ruleset": "<slug from Task 5>",
  "field_values": { "dog_type": "not_prohibited" }
}
```

Expected: `satisfied`.

- [ ] **Step 2: Call `aethis_decide` — compliant pit bull**

```json
{
  "ruleset": "<slug from Task 5>",
  "field_values": {
    "dog_type": "pit_bull_terrier",
    "has_exemption_certificate": true,
    "is_neutered": true,
    "is_microchipped": true,
    "has_third_party_insurance": true,
    "kept_on_lead_in_public": true,
    "muzzled_in_public": true,
    "handler_age": 30,
    "securely_confined_at_home": true,
    "address_change_notified": null,
    "death_notified": null,
    "ownership_transfer_notified": null,
    "has_bred_or_sold": false
  }
}
```

Expected: `satisfied`.

- [ ] **Step 3: Call `aethis_decide` — non-compliant (no insurance)**

```json
{
  "ruleset": "<slug from Task 5>",
  "field_values": {
    "dog_type": "pit_bull_terrier",
    "has_exemption_certificate": true,
    "is_neutered": true,
    "is_microchipped": true,
    "has_third_party_insurance": false,
    "kept_on_lead_in_public": true,
    "muzzled_in_public": true,
    "handler_age": 30,
    "securely_confined_at_home": true,
    "address_change_notified": null,
    "death_notified": null,
    "ownership_transfer_notified": null,
    "has_bred_or_sold": false
  },
  "include_explanation": true
}
```

Expected: `not_satisfied`, with explanation mentioning insurance.

- [ ] **Step 4: Call `aethis_schema`**

```json
{ "ruleset": "<slug from Task 5>" }
```

Verify the schema lists all 13 fields with correct types.

---

## Summary

| Task | Description | Conditional? |
|------|-------------|-------------|
| 1 | Create ruleset with source text + 16 test cases | No |
| 2 | Set field spec + discover fields | No |
| 2a | Refine fields | Only if validation fails |
| 3 | Generate rules + run tests | No |
| 4 | Refine rules | Only if tests fail |
| 5 | Publish | No |
| 6 | Smoke-test via decide API | No |

Happy path: Tasks 1 → 2 → 3 → 5 → 6 (skip 2a and 4).
