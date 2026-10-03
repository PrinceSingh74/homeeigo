# Phase 10 — execution / safety content draft (Phase B+C) and customer age policy (Phase D)

## Execution + safety content for the 31 live services

**Status: DRAFT_FOR_OWNER_REVIEW for 25 services; OWNER_APPROVAL_REQUIRED for 5; SAFETY_HOLD for 1. Nothing applied to any database.**

Source of truth: `apps/backend/scripts/data/phase-10-execution-safety-content-draft.ts` (31 services, read from the live catalogue export: id, slug, included/excluded, material/equipment policy, Phase 06 requirement assignments).

| Slug | Status | Steps | Prohibited conditions |
|---|---|---|---|
| ac-service | OWNER_APPROVAL_REQUIRED | 5 | 8 |
| electrician | OWNER_APPROVAL_REQUIRED | 5 | 6 |
| plumbing | OWNER_APPROVAL_REQUIRED | 5 | 7 |
| pest-control | OWNER_APPROVAL_REQUIRED | 4 | 7 |
| home-painting | OWNER_APPROVAL_REQUIRED | 7 | 9 |
| fasade-cleaning | SAFETY_HOLD (work at height) | 5 | 7 |
| 25 cleaning / beauty / home services | DRAFT_FOR_OWNER_REVIEW | 5–9 each | 3–9 each |

Totals: 196 steps, 204 prohibited conditions. The 6 held services carry only arrival, scope confirmation, stop conditions and closeout — no WORK steps — until the owner decides the questions below.

**Validator** `scripts/phase10-content-validate.ts` (offline): every plan through `validateExecutionPlan` + `resolveExecutionPlan`, every safety/quality block through the real catalogue zod schema, every `safetyRequirement` code checked against the Phase 06 content, no contradiction of material/equipment policy, and a banned-wording scan (chemical names, formulations, "certified/licensed/insured", guarantees, percentages, durations, diagnosis). **0 violations.** Unit test `phase10-content-draft.test.ts` (11) runs it in-process.

**Apply plan** `scripts/phase10-content-apply-plan.ts`: dry-run by default; prints a per-key diff of only `execution` / `safety` / `quality`; `--apply` runs through `catalogService.update` (versioning, `service_config_versions`, audit, `syncServiceExecution`) and needs `--approved-by`, a hash-bound `--owner-approval` file, `--actor-id` (active SUPER_ADMIN) and `--allow-live` on a non-test database. Non-DRAFT services are refused. Defect found and fixed during verification: the diff compared the raw draft against the schema-normalised stored config, so a second run would have re-applied forever.

**Runtime proof** `phase10-content-draft.integration.test.ts` (5): the sofa-deep-cleaning draft applied to a fixture service through `PUT /api/admin/services/:id` → version bumped, 6 steps mirrored → booking snapshot carries `execution.v1` (6 steps) and `safety.v1` (7 prohibited conditions) → partner execution and safety views render them, customer sees warnings but not provider requirements, partner can raise a listed condition and not an unlisted one.

### Owner decisions needed before the held services get WORK steps
- Commercial holds with no in-app quote → approval → payment chain: ac-service (gas + parts), electrician (parts), plumbing (parts), home-painting (paint).
- Regulated / specialist method documents: pest-control (authorisation, per-pest procedure, re-entry wording), electrician, plumbing, ac-service (gas handling), home-painting (surface prep + coats).
- Work at height: fasade-cleaning (define or decline a method; keep bookable meanwhile?), home-painting exterior, ac-service outdoor units.
- Global: exclusions list per service (live `excluded` is null everywhere), the emergency number (112) and the Homeeigo escalation contact, gloves as the only asserted PPE.
- Scope: kitchen-cleaning chimney, kitchen-prep cooking, hourly-bookings task list, laundry dry-clean items, plant-care products, mattress UV rule, salon sensitivity test, wardrobe-cleaning duration (4320 min on live).

To apply approved drafts: `cd apps/backend && bun run scripts/phase10-content-apply-plan.ts --url "<homigo_db url>" --apply --approved-by "<name>" --owner-approval <file> --actor-id <SUPER_ADMIN user id> --allow-live` — **OWNER_APPROVAL_REQUIRED**.

## Customer age policy

**Status: CLOSED in code; 0 live services configured; migration `20260924230000_customer_policy_decisions` not on live (OP-9).**

- Catalogue block `customerPolicy.age` with modes NONE / MINIMUM_AGE / ADULT_ONLY / GUARDIAN_REQUIRED. The schema refuses MINIMUM_AGE, ADULT_ONLY and GUARDIAN_REQUIRED without an explicit age — **no legal age is assumed anywhere**.
- `src/lib/customer-policy.ts` (pure) + `src/services/customer-policy.service.ts`: evaluated on booking create before the transaction; refusals return 422 `AGE_VERIFICATION_REQUIRED` (no date of birth), 403 `AGE_BELOW_MINIMUM` / `ADULT_REQUIRED`, 422 `GUARDIAN_ATTESTATION_REQUIRED`; the price-quote endpoint previews the outcome without writing.
- `customer_policy_decisions` (append-only) records policy, version, mode, outcome, reason and `inputs` = `{ageKnown, ageYears, guardianAttested}` — never the date of birth. Allowed decisions are written inside the booking transaction; refusals with `booking_id` NULL.
- The policy that applied is frozen into the booking snapshot (`customerPolicy: {age, version}`).
- Date of birth: `PUT /api/users/me/date-of-birth` (write once; second change → 409 `DOB_LOCKED`), admin `PUT /api/admin/users/:id/date-of-birth` with a reason (USERS/UPDATE); audit rows carry no date value; `GET /api/users/me` exposes only `dateOfBirthSet`. Partner booking payloads carry no DOB, age, policy or attestation.
- Tests: `p10-age-policy.test.ts` 19, `p10-age-policy.integration.test.ts` 11 (all refusal codes, append-only trigger, no-DOB-in-inputs, partner payload free of age, admin RBAC).
- Without the table (live today) the refusal is still enforced; the row is skipped with `customer_policy_decision_unrecorded_total{reason=table_absent}`.

Owner: deploy the migration before configuring any service policy; choosing a minimum/adult age for a service is a business decision (**OWNER_APPROVAL_REQUIRED**).
