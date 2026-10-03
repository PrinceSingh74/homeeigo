# Provider provenance closure — 2026-09-27

## Rules applied (all evidence-based, all unit-tested in `data-provenance.test.ts`, 41/41)

| Rule | Origin | Evidence, not guess |
|---|---|---|
| `user.reserved-domain` | INFERRED_SYNTHETIC | RFC 2606 reserved domains cannot receive mail |
| `user.seed-domain` | INFERRED_SYNTHETIC | `@homigo.demo` exactly — the domain the app's OWN seed/cert scripts hard-code (`ensure-demo-users.ts`, `section03-seed-live-job.ts`, `section05-live-cert.ts`); `acme.demo` and `demo.person@gmail.com` do NOT match |
| `user.plus-tag.suite` | INFERRED_TEST | `+e2e/+test/+fixture/+seed/+cert` plus-tags |
| `booking.non-canonical-number` | INFERRED_TEST | only `lib/booking-number.ts` mints numbers and it mints exactly `HOMIGO-YYYYMMDD-NNNNN`; any other format was written by a script (the rule is the format, not a prefix list) |
| refund reason rules (7) | INFERRED_CERTIFICATION / TEST / SYNTHETIC | markers humans wrote on purpose (“f2 cert”, “phase-5a certification”, “e2e”) |

Nothing is ever promoted to REAL. Ambiguous rows stay NULL = UNKNOWN, which the analytics/matching policy counts as business (owner policy, unchanged).

## Live apply (2026-09-27, `provenance-report.ts --apply`)

| Table | Before | Written | After |
|---|---|---|---|
| users | 685 INFERRED_SYNTHETIC / 200 NULL | +81 INFERRED_SYNTHETIC | **766 INFERRED_SYNTHETIC / 119 NULL** |
| bookings | 1 INFERRED_CERTIFICATION / 721 NULL | +173 INFERRED_TEST | **548 NULL / 173 INFERRED_TEST / 1 INFERRED_CERTIFICATION** |
| dispatchable providers (active+approved+not banned) | — | — | **46 business (NULL) · 42 INFERRED_SYNTHETIC (excluded from real matching)** |

Re-read 2026-09-27 12:40 IST (read-only): users 766 INFERRED_SYNTHETIC / 119 NULL, bookings 548 NULL / 173 INFERRED_TEST / 1 INFERRED_CERTIFICATION — unchanged since the apply.

Actor: session script under the owner's in-chat authorization; the script fills NULL only and never overwrites, deletes or promotes. Total 254 rows. Reversal, if ever wanted: `UPDATE … SET data_origin = NULL WHERE data_origin = 'INFERRED_SYNTHETIC' AND <rule evidence>` — recorded here so the change is reversible by design.

## Population isolation — what enforces it now

| Surface | Mechanism | Proof |
|---|---|---|
| Matching candidates | `candidatePopulation()` → business customers see business partners, non-business customers see non-business partners; plus PROVENANCE_INVALID hard gate | `w2-d4-fixture-isolation(.integration)`, `matching-population.integration`, `p11-matching-gates.integration` GF9/GF10 (25/25) |
| Availability projection | same population as matching | w2-d4 |
| Direct selection / admin reassign / case same-partner | population + capability gates via `assertOfferEligible` | w2-d4, p11 |
| Ratings / evidence counts | population-scoped aggregates | w2-d4 |
| Capability rows | `data_origin` on every capability row; rows from another population are INVISIBLE to the gate | p11 "fixture-origin certificate does not satisfy a business booking" |
| Analytics | `analyticsWhere` / `analyticsWhereVia` / `analyticsSqlPredicate` — one policy module; admin dashboard fully scoped this program; 5 more intelligence services scoped (mandate L) | `analytics-scope-adoption.test.ts`, `intel-provenance-scope.integration.test.ts` (28/28) |
| Scripts writing business rows | `requireDeclaredTarget()` (`--allow-live` or refuse) + `check-provenance-declaration` gate | 11 scripts guarded; both gates pass |

`production population ∩ test population` on live after apply: the 42 synthetic dispatchable providers and 173 script bookings are labelled and excluded; the 119 UNKNOWN users / 548 UNKNOWN bookings are the pre-column history the owner policy keeps as business (no evidence to classify them; not guessed).

## Demo partner note
`partner@homigo.demo` is now INFERRED_SYNTHETIC, as is `customer@homigo.demo`: the owner's demo flows keep working because both sit in the same NON_BUSINESS population (disjoint worlds); the owner's own gmail account will no longer be matched to the demo partner.

## Provider profile completeness on live — 2026-09-28 21:45 IST (read-only)

Population: 80 dispatchable providers (active + approved + not banned/paused/restricted) = **39 business** (provenance NULL/REAL) + **41 synthetic** (excluded from real matching). (The 09-27 figure of 46 / 42 counted 88 providers before some left the dispatchable state.)

| Fact | Business providers with it (of 39) | Where it lives | Note |
|---|---|---|---|
| Any service offered (legacy service list) | **2** | `providers.service_categories` | the other 37 match no service at all today |
| Typed provider↔service capability | 0 (688 rows planned by step F, 57 of them for these 2 providers) | `provider_service_capabilities` | the 55 existing rows belong to 2 synthetic providers |
| Skill (any / VERIFIED) | 0 / 0 | `provider_skills` | unknown stays unknown — nothing inferred |
| Certification (any / VERIFIED), expiry | 0 / 0 | `provider_certifications` | |
| Equipment | 0 | `provider_equipment` | |
| Insurance | 0 | `provider_insurance` | |
| Language | 0 | `provider_languages` | |
| Business membership | 0 | `business_providers` | no business-owned service exists either |
| Background check | CLEARED 1 · NOT_DONE 38 | `providers.background_check_status` | |
| Verified flag | true 39 | `providers.is_verified` | |
| Capacity | 4 concurrent jobs each | `providers.max_concurrent_jobs` | |
| KYC | no KYC status column on `providers`; KYC documents live in the onboarding/KYC tables | — | not re-derived here |

**Matching pool per service for a BUSINESS customer** (today's effective pool, from the recorded baseline): 2 providers for 25 services, 1 for ac-service / electrician / plumbing / fasade-cleaning / salon-at-home, **0 for spa and personal-hygiene-bathing-care**. Synthetic (demo) customers see up to 25.

Status: representation CLOSED (every fact has a typed home, provenance per row, DECLARED→VERIFIED lifecycle). Data: **OWNER / OPERATIONS** — real providers must declare and be verified for skills, certifications, equipment, insurance and languages, and 37 business providers need their services recorded before real customers can be matched to them. None of it may be backfilled from guesses.
