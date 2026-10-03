# Phase 06 — Final business content certification (2026-09-22)

> **Superseded in part by content v2 (same day)** — see `phase-06-remaining-closure-report.md`. v2 (hash `e5de61b9…`) removed the facade access-equipment promise, promoted A1–A3 to OWNER_APPROVED (so K below now reads OWNER_APPROVED 129 / SYSTEM_INFERRED 0 on 149 assignments) and fixed two duplicated label/note pairs. Everything else in this document stands for v1 (hash `c19f8ab1…`, frozen).

Every figure below comes from a command run in this session; the raw output is under `docs/operations/evidence/phase-06-content-*`.

## A. Final status

The final requirement content is **applied to `homigo_db`**, bound to content hash `c19f8ab1ab12b5070465c7edcda4b20f9d6bc95b1b1b4d0acb0c61b305250b06`.

- 31/31 live services are configured.
- Engineering, runtime, security, data-integrity, browser and regression gates all pass.
- Two kinds of business follow-up remain as explicit holds, not defects: **COMMERCIAL_HOLD** on 4 services and **SAFETY_HOLD** on 1 (see S).

## B. Service coverage

31/31 of the live customer services (`data_origin IS NULL`). The list is pinned in `requirement-content-final.test.ts`, so a service silently dropping out fails the build.

## C. Shared catalogue

70 items: 23 materials, 17 equipment, 30 customer preconditions.

- Normalised from the 71-item proposal. Near-duplicates are refused by a stemmed similarity check. Genuinely different materials stay separate: descaler, degreaser, upholstery shampoo, carpet shampoo.
- **Added (8)** where the service semantics demanded them: `household-cleaning-supplies` and `household-cleaning-tools` (home help), `food-safe-hygiene-kit`, `pot-and-potting-mix` (customer-provided, replaces a professional-supplied line with no commercial path), `pest-application-equipment` (renamed from `pest-sprayer`), `windows-reachable-from-inside`, `safe-access-assessed-on-site`, `access-equipment-assessed-on-site`.
- **Removed (9)** as generic or unjustified by any service's scope: `microfibre-cloths` and `floor-disinfectant` (folded into category-level cleaning products), `hygiene-kit` (generic), `packaging-for-return` (off-site work, not a home requirement), `task-specific-supplies` and `task-agenda-ready` (merged into existing lines), `society-entry-arranged` (generic advice on every service), `potting-mix-and-fertiliser` and `pest-sprayer` (replaced as above).

## D. Assignments

150 total, down from 196 in the proposal. Weak or duplicate lines were removed; nothing was padded.

## E. Configuration states

| State | Services |
|---|---|
| READY | 25 |
| READY_WITH_INSPECTION | 1 (window-cleaning) |
| COMMERCIAL_HOLD | 4 (home-painting, ac-service, electrician, plumbing) |
| SAFETY_HOLD | 1 (fasade-cleaning) |
| NOT_CONFIGURED | 0 |
| INVALID | 0 |

**Per kind, NOT_CONFIGURED is kept separate from NO_SPECIAL_REQUIREMENTS:**
- Materials: 29 configured, 2 explicitly "no special requirement" (ironing-folding, mattress-sanitization).
- Equipment: 22 configured, 9 explicitly "no special requirement" (kitchen-cleaning, kitchen-cabinet-cleaning, fridge-cleaning, utensil-washing, kitchen-prep, packing-unpacking, hourly-bookings, laundry, ironing-folding), each with a written reason.
- Preconditions: 31 configured.

The readiness report reads these declarations, so an empty kind is never guessed.

## F. Commercial dependencies

- **Paint, refrigerant gas and spare parts:**
  - Marked `SEPARATE_QUOTE`, procured by the professional.
  - Customer copy promises confirmation of need and cost before use, and states no amount.
  - The app has no customer quote → approval → payment chain; only admin maker-checker wallet adjustments exist. So these four services are COMMERCIAL_HOLD.
- **No `CHARGEABLE` line exists:** no live service has an add-on to price one.
- **`INCLUDED` never mentions a charge:** enforced by rule `INCLUDED_COPY_MENTIONS_CHARGE`.

## G. Safety dependencies

Nothing asserts a certification, method, chemical specification, quantity, brand, supplier or medical requirement.

- **Work at height has no defined HOMEEIGO method:**
  - window-cleaning covers only glass reachable from inside; the professional assesses the rest at start.
  - fasade-cleaning and exterior painting assert only society permission plus an on-site safety assessment.
- **Pest-control** defers re-entry advice to the product label via the professional.
- **Safety-class preconditions must be verified by someone**, enforced by rule `SAFETY_PRECONDITION_NOT_VERIFIED`. These are switchboard isolation, water shut-off, pest preparation and safe access.

## H. Customer content

- One instruction plus one reason per line. No enums, IDs, internal notes or partner text.
- Groups appear only when non-empty (browser-verified).
- Exactly one booking-blocking confirmation exists: pest-control preparation, with the health disclosure warning.

## I. Partner content

- The brief comes from the booking snapshot: bring materials, bring equipment, customer provides, preconditions.
- Each precondition carries its check:
  - confirmed by the customer
  - verify on arrival
  - verify at start
- Operational instructions appear where a safety or dispute outcome depends on them:
  - isolate the circuit at the MCB
  - locate the shut-off valve
  - show the gauge reading before a gas refill
  - do not treat occupied rooms
  - no improvised height access

## J. Admin control

Tab 09b shows every assignment, with the catalogue picker and all copy fields. The internal note carries provenance as `[PROVENANCE version] Why: … Assumption Ax … Not asserted: …`.

- The merge-preserving editor is unchanged.
- Stale tabs get 409 (browser-verified).

## K. Provenance

| Provenance | Assignments |
|---|---|
| OWNER_APPROVED | 121 |
| EXISTING_AUTHORITATIVE | 12 |
| SYSTEM_INFERRED | 8, each citing assumption A1 / A2 / A3 |
| INSPECTION_DEPENDENT | 2 |
| SAFETY_HOLD | 2 |
| COMMERCIAL_HOLD | 5 |

Provenance is visible only to admins (verified: 0 leaks in customer and partner projections on `homigo_db`).

The three assumptions the owner may override:
- **A1:** home-help uses the home's own supplies and tools.
- **A2:** repotting uses the customer's pot and mix, only if wanted.
- **A3:** packing consumables are the customer's.

## L. Versioning

Applying the content bumped each of the 31 live services exactly once (v2 → v3). This wrote 31 `service_config_versions` rows and 31 `SERVICE_CONFIG_VERSIONED` audit entries, plus 70 `REQUIREMENT_ITEM_CREATED` entries.

## M. Snapshot

This was tested on the restored live copy:

1. Version A (v3).
2. Book pest-control.
3. Change the requirement to Version B (v4: advice-only, new wording).

**Result:** the booking's partner and customer views are byte-identical before and after. The partner still sees "CONFIRMED_BY_CUSTOMER", and the snapshot keeps `serviceVersion` 3. Version A was then restored. Also covered by M4/M10 and R9.

## N. Browser verification

Isolated stack on a restored copy of `homigo_db`.

| Surface | Result | What it covered |
|---|---|---|
| Customer web | 18/18 | 10 representative services across 8 subcategories; every structured label and note is on the page, no empty group heading, no generic preparation. Pest-control: client blocks, backend returns 400 `REQUIREMENTS_NOT_CONFIRMED`, booking succeeds with the attestation, customer booking view comes from the snapshot. AC service: "Not included — quoted separately", no amount. |
| Partner web | 6/6 | Snapshot brief, handling note, instructions, checks; no provenance. |
| Admin | 6/6 | 10 rows, provenance in the internal note, one-note save = one version bump with everything else intact, no `requirementItems` sent back, stale tab 409. |

## O. Regression

- **Full backend suite:** 2995 pass / 0 fail across 250 files (previous close: 2971).
- **Typechecks:** backend, web, admin, partner-web, customer mobile and partner mobile — 0 errors each.
- **Client tests:** admin editor 8/8, mobile quote 6/6.
- **Phase 06 suites:** content engine 24, unit 20, integration 14.
- **Performance** (isolated backend, 150 assignments live, local dev hardware; p50 / p95 ms):

  | Endpoint | p50 | p95 |
  |---|---|---|
  | Service detail | 47.8 | 67.9 |
  | Quote incl. requirement resolution | 50.7 | 64.3 |
  | Partner job list | 48.5 | 68.9 |
  | Admin list (31 services) | 70.3 | 95.5 |
  | Booking create with snapshot | 308.8 | 438.4 (dominated by the existing booking transaction) |

  No N+1: the admin list touches the item catalogue at most once per page, identical for 2, 10 and 67 rows.
- **Observability:** `service_requirement_resolution_total{outcome}`, `requirement_attestation_missing_total`, `configuration_validation_failure_total{code}` and the new `requirement_snapshot_created_total{blocking,empty}` (asserted in the integration suite) were exposed after browser traffic. Labels carry no ids, names, notes or tokens.

## P. Defect reintroduction

Each defect was reintroduced in an isolated copy and taken through GOOD → DEFECT → byte-identical restore → GOOD (58/0 before and after). **All 15 were caught.**

| # | Defect | Failing tests |
|---|---|---|
| R1 | Responsibility inversion | 3 |
| R2 | Chargeability inversion | 1 |
| R3 | Hidden customer requirement | 1 |
| R4 | Partner brief drops equipment | 2 |
| R5 | Copy/data mismatch | 1 |
| R6 | Conditional requirement omitted | 4 |
| R7 | Duplicate requirement | 1 |
| R8 | Conflicting assignment | 4 |
| R9 | Historical snapshot mutated | 1 |
| R10 | Inactive item exposed | 1 |
| R11 | Unsafe requirement downgraded | 1 |
| R12 | Chargeable without a commercial path | 6 |
| R13 | Owner edit overwritten | 1 |
| R14 | Version not bumped | 2 |
| R15 | Provenance leak into partner copy | 2 |

## Q. Final live dry-run and application

- **Backup:** `homigo_2026-09-22T13-25-07-539Z.dump`, sha256 `66fc77b2…`, uploaded to S3. The restore drill passed (707 bookings, RTO 58 s).
- **Live dry-run:** matched the rehearsal exactly (70 create / 31 apply / 0 refused).
- **Apply:** `--expect-hash c19f8ab1…` → 70 items and 31 services applied, 0 failed.
- **Post-verification:**
  - bookings, payments, refunds, ledger, 707 snapshots, slot windows and 35 fixture services are byte-identical
  - only the live service versions and the requirement tables changed
  - a re-run changes nothing (idempotent)
  - readiness is 0 invalid
  - schema drift is OK
  - the live :3000 backend serves v3 content without a restart
  - 0 projection leaks across 31 services

## R. Owner approval artifact

| Artifact | Hash |
|---|---|
| Content hash (what was applied) | `c19f8ab1ab12b5070465c7edcda4b20f9d6bc95b1b1b4d0acb0c61b305250b06` |
| Data source `scripts/data/phase-06-requirement-content-final.ts` | sha256 `5ffe9dd4365eccdaca50528ada47bd096daa43bd3a577fa0167fce0161204465` |
| Rendered `phase-06-requirement-content-final.md` | sha256 `bdaa35112ccc2d91220bed673ea91d6a829385095d5e5653e01f3377d043c51f` |

**Actor:** the audit entries are attributed to the earliest active SUPER_ADMIN (`cmpqqqexo0005tzjwsp6ldm9p`, created 2026-05-29). It was applied under the owner's authorisation of 2026-09-22, and the change reason on every version says so.

## S. Remaining true blockers (business, not engineering)

| Hold | Services | Unblocked by |
|---|---|---|
| COMMERCIAL_HOLD | home-painting, ac-service, electrician, plumbing | Phase 09 in-app quote → approval → payment, or an owner policy that on-site quotes are settled outside the app |
| SAFETY_HOLD | fasade-cleaning | An owner-defined work-at-height method (equipment, provider capability, scope) or a separate assessed-service category |
| Assumptions A1–A3 | 8 lines | Owner confirmation or an edit in admin tab 09b |
