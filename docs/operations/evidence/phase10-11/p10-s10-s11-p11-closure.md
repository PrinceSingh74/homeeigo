# Phase 10 §10/§11 + Phase 11 — closure program evidence (2026-09-26)

Six workstreams, all implemented on the isolated test DB (`homigo_test`), typecheck clean, no live write. Live needs the owner's `migrate deploy` for three new migrations (OP-9, below).

## Workstream results

| WS | Scope | Tests | Key proofs |
|---|---|---|---|
| A | Execution + safety content DRAFT for 31 live services | 11 unit + 5 integration | validator 0 violations; 196 steps / 204 prohibited conditions; apply-plan dry-run verified; snapshot carries execution.v1 + safety.v1 end to end |
| B | Quality verdict + completion + customer confirmation | 26 + 15 (plus D1/§7/§9 suites re-run green) | Q1–Q5, GF14 (2 concurrent completes → 1 earning, 1 completion row); refusals persist a verdict; `confirmationWindowHours` freeze defect fixed |
| C | Complaint/warranty cases + rework/revisit + financial safety | 12 + 10 | Q6 expired warranty; Q7 10 concurrent opens → 1 case; Q8 concurrent rework → 1 follow-up; Q19 one refund per case (case-scoped key + refundable cap); ₹0 follow-up settled with no fake payment |
| D | Typed provider capability APIs (skills/certs/equipment/insurance/languages/business/service join) | 29 + 17 | Q16 after every partner call (no forged ACTIVE row); mass-assignment refused; VERIFIED locked; DB CHECKs proven by direct SQL |
| E | Canonical matching hard gates + reason codes | 13 + 25 (+147 regression across 13 suites = 185/185) | GF4–GF11, Q17, Q18/Q20 race → one offer; no N+1 (one capability batch per match); no fabricated location; offer/accept re-check; diagnostics 299 ms @ 56 candidates (201–215 ms @ 107–164) |
| F | Customer age policy | 19 + 11 | all refusal codes; DOB never in logs/inputs/partner payloads; append-only decisions; DOB write-once |

Coordinator fixes on top: X-3 (dead unmounted `partner-service-skills.routes.ts` deleted; its ungated twin `requestServiceSkill` now refuses, pointing at the canonical `providerCapabilityService.requestService`), X-4 (`cleanupAdversarialFixtures` silent no-op since PII encryption — now resolves fixture users via `emailHash`).

## Matching rejection reasons (all machine-readable)
PROVENANCE_INVALID, BUSINESS_NOT_AUTHORIZED, SERVICE_CAPABILITY_MISSING, SKILL_MISSING, CERTIFICATION_MISSING, CERTIFICATION_EXPIRED, CERTIFICATION_UNVERIFIED, EQUIPMENT_MISSING, INSURANCE_INVALID, LANGUAGE_MISMATCH, PROVIDER_NOT_AVAILABLE, PRESENCE_STALE, LOCATION_GATE_FAILED, CAPACITY_EXCEEDED — ordered by `MATCHING_GATE_ORDER`, counted in `matching_rejection_total`, visible per candidate at `GET /api/admin/bookings/:id/matching-diagnostics` (BOOKINGS/READ).

## Owner items (OP-9 + decisions)

| Id | Action |
|---|---|
| OP-9 | `cd apps/backend && bunx prisma migrate deploy` — applies `20260924213000_quality_verdicts_completion`, `20260924220000_booking_cases_rework_warranty`, `20260924223000_provider_capabilities`, `20260924230000_customer_policy_decisions`, `20260926120000_purge_cascade_fixes` (all additive; every reader degrades gracefully while absent) |
| OWNER-CONTENT | review/approve the 25 DRAFT service drafts; decide the open questions for the 5 OWNER_APPROVAL_REQUIRED + 1 SAFETY_HOLD services (see `p10-content-and-age-policy.md`); then run the guarded apply-plan |
| OWNER-FLAG | `matching.strict_service_capability` stays OFF: no live provider has typed capability rows yet; enabling now would empty the pool. Backfill basis: `scripts/phase11-legacy-capability-report.ts` (read-only) |
| OWNER-POLICY | rework fee policy (`rework.fee`), warranty blocks and age values per service are business decisions; engines refuse rather than invent |

## Test-infrastructure note
`homigo_test` carries residue from weeks of suites whose cleanup was the X-4 no-op (34,663 NULL-email users; 66+ leaked ONLINE partners). WS-E mitigated locally (took 68 stale residue providers offline, test DB only). A `test:setup --reset` is the clean fix when convenient.
