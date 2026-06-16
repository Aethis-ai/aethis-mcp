# Communications Act 2003 — Content Standards (S.319–320) Ruleset Design

## Summary

Single Aethis ruleset encoding the content standards objectives from S.319(1)–(2) and applicability rules from S.320(1)–(4) of the Communications Act 2003. Purpose: compliance screening for broadcast and on-demand programme services.

## Ruleset Identity

- **Name:** Communications Act 2003 — Content Standards (S.319–320)
- **Section ID:** `comms-act-2003-content-standards`
- **Domain:** `uk_broadcast_regulation`

## Approach

Single flat ruleset (Approach A). All S.319(2) objectives encoded as rules within one ruleset. S.320 applicability logic (service type, exclusions, enhanced duties) baked in as precondition rules. One `aethis_decide` call per content item returns `satisfied` (compliant) or `not_satisfied` (potential breach) with trace showing which objective(s) triggered.

## Source Text

Sections 319(1)–(2) and 320(1)–(4) of the Communications Act 2003 (verbatim legislative text).

## Fields (~15)

| Field | Type | Purpose |
|-------|------|---------|
| `service_type` | enum: `broadcast_tv`, `broadcast_radio`, `on_demand` | Determines applicability and watershed rules |
| `is_bbc_or_s4c` | boolean | S.320(4) — enhanced impartiality duties |
| `content_category` | enum: `news`, `entertainment`, `documentary`, `advertising`, `religious`, `other` | Triggers different objective weights |
| `is_advertising_content` | boolean | S.319(2)(i)–(j) advertising standards split |
| `scheduled_pre_watershed` | boolean | Under-18 protection — only relevant for broadcast_tv |
| `contains_material_harmful_to_under_18s` | boolean | S.319(2)(a) |
| `contains_material_likely_to_cause_offence` | boolean | S.319(2)(f) |
| `offence_context_justified` | boolean | Whether offensive material is editorially justified in context |
| `incites_crime_or_disorder` | boolean | S.319(2)(b) |
| `incites_hatred_on_protected_grounds` | boolean | S.319(2)(c) — race, sex, religion, etc. |
| `news_presented_with_due_accuracy` | boolean | S.319(2)(d) |
| `news_presented_with_due_impartiality` | boolean | S.319(2)(e) |
| `religious_programme_exploits_audience` | boolean | S.319(2)(g) |
| `religious_programme_involves_improper_recruitment` | boolean | S.319(2)(h) |
| `advertising_compliant_with_code` | boolean | S.319(2)(i)–(j) |

## Test Cases (12)

| # | Scenario | Key Fields | Expected |
|---|----------|-----------|----------|
| 1 | Broadcast TV, pre-watershed, harmful to under-18s | service_type=broadcast_tv, scheduled_pre_watershed=true, contains_material_harmful_to_under_18s=true | `not_satisfied` |
| 2 | Broadcast TV, post-watershed, harmful material, no other issues | service_type=broadcast_tv, scheduled_pre_watershed=false, contains_material_harmful_to_under_18s=true | `satisfied` |
| 3 | On-demand, harmful to under-18s | service_type=on_demand, contains_material_harmful_to_under_18s=true | `not_satisfied` |
| 4 | Content inciting crime/disorder | incites_crime_or_disorder=true | `not_satisfied` |
| 5 | Content inciting hatred on protected grounds | incites_hatred_on_protected_grounds=true | `not_satisfied` |
| 6 | Offensive material, editorially justified | contains_material_likely_to_cause_offence=true, offence_context_justified=true | `satisfied` |
| 7 | Offensive material, not justified | contains_material_likely_to_cause_offence=true, offence_context_justified=false | `not_satisfied` |
| 8 | News without due accuracy | content_category=news, news_presented_with_due_accuracy=false | `not_satisfied` |
| 9 | News without due impartiality on BBC | is_bbc_or_s4c=true, content_category=news, news_presented_with_due_impartiality=false | `not_satisfied` |
| 10 | Religious programme exploiting audience | content_category=religious, religious_programme_exploits_audience=true | `not_satisfied` |
| 11 | Advertising non-compliant with code | is_advertising_content=true, advertising_compliant_with_code=false | `not_satisfied` |
| 12 | Clean content, all standards met | All harm/offence/incitement fields false, accuracy/impartiality true | `satisfied` |

## Key Design Decisions

1. **Watershed is broadcast TV only.** ODPS has no watershed; harmful-to-under-18s material is always a breach for on-demand services.
2. **Offensive material has a justification defence.** S.319(2)(f) requires "generally accepted standards" — modelled as offence + context justification.
3. **BBC/S4C enhanced impartiality** from S.320(4) is an additional strictness layer within the same ruleset, not a separate one.
4. **Advertising standards** are a binary field — the detailed advertising code rules are outside scope (they live in the ASA/BCAP codes, not the Act itself).
