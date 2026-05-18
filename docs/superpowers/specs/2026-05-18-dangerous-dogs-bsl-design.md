# Dangerous Dogs Act — BSL Compliance Ruleset

**Date**: 2026-05-18
**Status**: Approved

## Purpose

Encode the breed-specific legislation (BSL) regime under s.1 of the Dangerous Dogs Act 1991, as amended by the Dangerous Dogs (Amendment) Act 1997 and the Anti-social Behaviour, Crime and Policing Act 2014, as an Aethis ruleset.

**Target user**: Dog owners / prospective owners who want to know whether they are legally compliant (or what steps they need to take).

## Scope

- Prohibited type determination (binary input — user states whether their dog is a prohibited type)
- Index of Exempted Dogs (IED) certificate requirement
- Core exemption conditions: neutering, microchipping, third-party insurance
- Public place requirements: lead, muzzle, handler age (16+)
- Home confinement: secure containment to prevent escape
- Notification duties: change of address, death of dog, transfer of ownership
- Breeding/sale/exchange/gifting prohibition

### Out of scope

- Physical conformation assessment (users unsure of type should seek professional assessment)
- Court procedure (s.4B contingent destruction orders, interim exemption)
- Import/export restrictions
- Temporary custody provisions
- Behavioural offences under s.3 (dog dangerously out of control)
- Sentencing / penalty guidance

## Approach

Single flat ruleset (~13 fields, ~8 rules). One conjunctive eligibility test: the dog is legally held only when all applicable conditions are met.

### Why single ruleset

The s.1 exemption scheme is a single conjunctive test. Splitting into multiple sections or rulesets would over-engineer what is fundamentally one question: "Am I legal?" Field grouping and explanation text provide sufficient granularity for the user to understand what's missing.

## Fields

| Field | Type | Description |
|-------|------|-------------|
| `dog_type` | enum: `pit_bull_terrier`, `japanese_tosa`, `dogo_argentino`, `fila_brasileiro`, `not_prohibited` | Prohibited type of the dog |
| `has_exemption_certificate` | boolean | Dog is on the Index of Exempted Dogs with valid certificate |
| `is_neutered` | boolean | Dog has been neutered |
| `is_microchipped` | boolean | Dog has been microchipped |
| `has_third_party_insurance` | boolean | Owner holds third-party insurance against injury caused by the dog |
| `kept_on_lead_in_public` | boolean | Dog is kept on a lead in public places |
| `muzzled_in_public` | boolean | Dog is muzzled in public places |
| `handler_age` | integer | Age in years of the person in charge of the dog in public |
| `securely_confined_at_home` | boolean | Dog is kept securely confined to prevent escape when at home |
| `address_change_notified` | boolean or null | Owner has notified IED of change of address (null if no change) |
| `death_notified` | boolean or null | Owner has reported dog's death to IED (null if dog is alive) |
| `ownership_transfer_notified` | boolean or null | Owner has notified IED of ownership transfer (null if no transfer) |
| `has_bred_or_sold` | boolean | Owner has bred from, sold, exchanged, or gifted the dog |

## Rules

1. **Not a prohibited type**: if `dog_type` is `not_prohibited`, result is `satisfied`. No other fields required.
2. **Exemption certificate**: if prohibited type and `has_exemption_certificate` is false, `not_satisfied`.
3. **Physical conditions**: `is_neutered`, `is_microchipped`, and `has_third_party_insurance` must all be true.
4. **Public place conditions**: `kept_on_lead_in_public` and `muzzled_in_public` must be true; `handler_age` >= 16.
5. **Home confinement**: `securely_confined_at_home` must be true.
6. **Notification duties**: each of `address_change_notified`, `death_notified`, `ownership_transfer_notified` must be true or null. False = `not_satisfied`.
7. **Breeding/sale prohibition**: `has_bred_or_sold` must be false.

**Result**: `satisfied` when all applicable conditions met. `not_satisfied` with explanation listing every failing condition. `pending` when required fields missing.

## Test Cases

| # | Scenario | Expected |
|---|----------|----------|
| 1 | `dog_type: not_prohibited` (no other fields) | `satisfied` |
| 2 | Prohibited type, all conditions met, no notifications due | `satisfied` |
| 3 | Prohibited type, no exemption certificate | `not_satisfied` |
| 4 | Prohibited type, exempt but not neutered | `not_satisfied` |
| 5 | Prohibited type, exempt but no insurance | `not_satisfied` |
| 6 | Prohibited type, exempt but not microchipped | `not_satisfied` |
| 7 | Prohibited type, exempt but not muzzled in public | `not_satisfied` |
| 8 | Prohibited type, exempt but handler is 15 | `not_satisfied` |
| 9 | Prohibited type, exempt but not securely confined | `not_satisfied` |
| 10 | Prohibited type, exempt but has bred/sold the dog | `not_satisfied` |
| 11 | Prohibited type, exempt but address change not notified | `not_satisfied` |
| 12 | Prohibited type, all conditions met, all notifications null | `satisfied` |
| 13 | Each of the four prohibited types with full compliance | `satisfied` |
| 14 | Prohibited type, missing key fields | `pending` |

## Legislative Sources

- Dangerous Dogs Act 1991, s.1
- Dangerous Dogs (Amendment) Act 1997
- Anti-social Behaviour, Crime and Policing Act 2014, s.107
- Dangerous Dogs Exemption Schemes (England and Wales) Order 2015
- DEFRA guidance on prohibited dog types and the IED
