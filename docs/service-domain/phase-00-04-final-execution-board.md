# Service domain Phases 00–04 — final execution board

Date: 2026-09-21. Evidence is from commands run in this session; nothing below is inferred.

## Overall

| Phase | Result |
|---|---|
| PHASE 00 — audit + source of truth | **PASS** |
| PHASE 01 — identity + taxonomy | **PASS** |
| PHASE 02 — content + media | **PASS** (no upload system exists for service media; references validated) |
| PHASE 03 — options, variants, add-ons | **PASS** (generic option groups deliberately not built) |
| PHASE 04 — quantity, unit, duration | **PASS** (owner decision D1 decided and implemented 2026-09-21 — see phase-04 addendum) |
| PHASE 05 — pricing + quote engine | **Implementation / engineering / runtime / security / migration PASS; production execution BLOCKED (no target)** — final loop 2026-09-22: 14 defects fixed incl. a P0 split-payment bypass, T1–T7 + D1 + S1 proven, browser customer 16/16 · admin 7/7 · partner 7/7, 2936/0 (+2934/0 on a migrations-only DB) — `phase-05-pricing-quote.md` §Final certification loop |
| PHASE 06 — materials, equipment, requirements | **Implementation / engineering / runtime / security / data-integrity / migration-parity PASS; business configuration OWNER_INPUT_REQUIRED (31/31 services); live/production migration OPERATOR_ACTION** — 2026-09-22: M1–M10 proven (M9 needed a new test), 5 defects fixed (D1 partner list, D2 admin Save disabled, D3 lifecycle publish refused), browser customer 11/11 · partner 6/6 · admin 6/6, 2971/0 — `phase-06-materials-equipment-requirements.md` §12 |

## Architecture

- **Authoritative models:**
  - `services` (identity, lifecycle, version)
  - `service_categories` (taxonomy tree)
  - `catalog_config` + `service_variants` / `service_addons`
  - `service_config_versions`
  - booking snapshots
- **Authoritative code:** `resolveServiceSelection` and `resolveServiceDuration` (one each). `LIFECYCLE_TRANSITIONS`, `validateForActivation`, `partnerJobBrief`.
- **Duplicates removed:**
  - second duration calculator `operationalSlotMinutes`
  - web client pricing (`estimateSelection` deleted in Phase 05; the summary and hour options are server-resolved)
  - mobile dead `ADDONS`
  - mobile invented ₹199 / "60-120 mins"
  - partner-mobile invented basePrice
  - web adapter category mapping (now server taxonomy first)
- **Duplicates kept, with a guard:**
  - web `/book` shared add-on display list: pinned to the backend by `service-domain-mirrors.test.ts`; the quote still prices.
  - frontend type mirrors: key fields pinned by the same test.
- **Legacy:** 4 inactive operational rows in `service_categories`, kept for history.

## Database

- Migrations: `20260921150000_service_identity_taxonomy`, `20260921160000_service_addon_dependencies`. Both hand-scoped; `check-migration-safety` OK.
- Fresh rebuild: `certify-fresh-migrate` PASS (drift OK, 35 protected objects).
- Live: `migrate deploy` on local `homigo_db` after a verified backup and with your approval. `check-schema-drift` OK.
- Test parity: 267/267 declared invariants present on `homigo_test`. The 8 CHECKs that had been missing are now created, and the checker defect is fixed and tested.
- Business data before → after:

  | Table | Before | After |
  |---|---|---|
  | services | 66 | 66 |
  | bookings | 707 | 707 |
  | payments | 421 | 421 |
  | refund requests | 339 | 339 |
  | services modified | — | 0 |

## API

| Endpoint | Auth | Runtime evidence |
|---|---|---|
| GET `/api/services/categories` | public | live 200; 13 categories |
| POST `/api/services/:id/resolve-selection` | public | live: valid 597 ₹; out-of-range `QUANTITY_ABOVE_MAX`; 3 issues reported together; stale version 409 |
| GET `/api/services/:id` (+version, taxonomy, content, duration, addons) | public | live; no internal fields |
| POST/PUT `/api/admin/services`, POST `…/:id/lifecycle`, GET `…/:id/versions`, GET `/api/admin/service-categories` | SETTINGS RBAC | integration suite; RBAC coverage test green |
| price-quote / bookings (+addonQuantities, serviceVersion, issues[]) | customer | integration suite + 675-test regression |

## Customer

Listing, detail, content, variants, add-ons, quantity and duration all come from the server. Verified in a headless browser against the isolated dev server:
- 4 live detail pages rendered with no console errors and no internal fields
- the summary is priced by resolve-selection (₹399 / ₹349 / ₹899 / ₹149)
- add-on toggles re-priced by the server (₹248, ₹498)
- add-on curation kept (no fridge add-on on Fridge Cleaning)
- estimated service time shown

## Partner

The job brief (variant, quantity, unit, add-on units, duration) comes from the immutable booking snapshot. The HTTP test gets partner 200, the brief is correct, and nothing internal is exposed. Rendered on partner web and partner mobile; mobile now also renders `execution` (it was declared but never shown). The leak guard knows the catalogue internals.

## Admin

- Taxonomy selects, internal code, permanent service code display.
- Lifecycle actions (allowed moves only; archive confirm), version history, resolved duration and calendar reservation.
- Unsaved-changes guard; `expectedVersion` on save.
- Editor merge fix (P1 data-loss defect) proven by a reintroduction test.

## Tests

| Suite | Result |
|---|---|
| new: `service-selection-resolver` | 32/32 |
| new: `service-identity-lifecycle` | 12/12 |
| new: `service-domain-foundation.integration` | 26/26 |
| new: `service-domain-mirrors` | 4/4 |
| new: `test-db-invariant-parser` | 4/4 |
| new: admin `service-config-editor` | 4/4 |
| updated: `service-domain` | legacy slot-override test rewritten to the corrected rule |
| updated: `service-catalog-config` | duplicate add-on now rejected |
| regression: 68 existing booking / pricing / service / matching / dispatch / RBAC / partner suites | **675 pass, 0 fail** |
| typecheck: backend, admin, web, partner-web, customer mobile, partner mobile | 0 errors each |
| web catalogue unit tests | 18/18 |

## Reintroduction proofs

Run in an isolated copy against a migrations-only DB, never against live `src/`. Each was GOOD → DEFECT → RESTORED:

| # | Control | Defect introduced | Result |
|---|---|---|---|
| P1 | identity uniqueness | drop `services_service_code_key` | 2 fail → pass |
| P2 | taxonomy integrity | drop taxonomy trigger | 1 fail → pass |
| P3 | compatibility | resolver ignores `compatibleVariantIds` | 4 fail (incl. HTTP frontend bypass) → pass |
| P4 | quantity | resolver ignores max | 4 fail → pass |
| P5 | duration | no sum-to-total check | 2 fail → pass |
| P6 | content requiredness | gate ignores content | 3 fail → pass |
| P7 | role access | admin PUT mapped to a support permission | 1 fail → pass |
| P8 | versioning | no compare-and-set | the first run did **not** fail; a concurrent same-version test was added; then 1 fail → pass |
| — | admin editor merge | rebuild from `{}` | 1 fail → pass |

## Blocked / open (not converted to PASS)

Updated 2026-09-22 after the Phase 05 full closure.

| Item | Class | Status |
|---|---|---|
| Duration-aware partner calendar slot | BUSINESS_DECISION | **Resolved.** Owner chose option B, with laundry keeping the fixed block; implemented (migration `20260921180000`); boundaries, release and races now tested. |
| 17 active fixture services visible in the public API | OPERATOR_ACTION | **Resolved.** Owner approved; classified `INFERRED_FIXTURE` (none deleted); public list 48 → 31. Nine secondary surfaces that still read fixtures were closed in the closure pass. |
| ₹49 "free visit" discount against a fee never charged | BUSINESS_DECISION | **Resolved.** Owner chose: a waiver applies only to a charged fee → no longer granted. |
| Script-derived Premium tier prices | BUSINESS_DECISION | **Resolved.** Owner chose to stop selling them; withdrawn via the audited admin path (31 services). |
| Unit prices / variants / tier prices for services other than Hourly Bookings | BUSINESS_DECISION | **Open.** Not invented; base price only; unpriced configurations fail closed (`PRICING_CONFIG_MISSING`). |
| Admin & partner UIs browser-verified | ENVIRONMENTAL | **Resolved.** 7/7 admin + 7/7 partner on an isolated stack (defects C2, C3, C6–C8 found and fixed there). |
| Production migrate | OPERATOR_ACTION | **Open / BLOCKED.** No production target exists. Readiness certified: `docs/operations/phase-05-production-migration-runbook.md` + read-only preflight. |
| Migration history drift (48 rows; earlier miscounted as 6) | ENGINEERING | **Resolved.** 40 line-ending only (LF + `.gitattributes`), 8 checksums reconciled under a catalog-IDENTICAL proof; preflight PASS. |
| Google Maps API key in tracked mobile files (pushed) | EXTERNAL | **Repo side resolved** (env-injected, stale builds removed). **Provider side open:** restrict/rotate needs the release signing SHA-1 + API Keys API / console access (owner). |
| Gift-card void refunds twice (gateway + wallet) | P1 (outside Phase 05) | **Open.** Business choice of refund destination needed. |
| APPROVED / SCHEDULED lifecycle | BUSINESS_DECISION | **Open.** No approver role or scheduled publisher exists. |

| Phase 06 closure track (content v2) | ENGINEERING | **Done 2026-09-22.** Facade equipment promise removed (live since v1), A1–A3 promoted to OWNER_APPROVED, label duplication fixed; v2 hash `e5de61b9…` applied to `homigo_db` (7 services v3→v4, 24 identical, snapshots/finances identical); 3006/0. `phase-06-remaining-closure-report.md`. Commercial and safety holds stay open by design — see the design doc. |
| Phase 06 requirement configuration for the 31 live services | BUSINESS_DECISION | **Resolved 2026-09-22** (owner-authorised final content applied to `homigo_db`, hash `c19f8ab1…`; `phase-06-requirement-content-final-certification.md`). **Still open:** COMMERCIAL_HOLD on home-painting / ac-service / electrician / plumbing (no in-app quote → approval → payment chain) and SAFETY_HOLD on fasade-cleaning (no work-at-height method); assumptions A1–A3 overridable in admin tab 09b. |
| Phase 06 migration on `homigo_db` | OPERATOR_ACTION | **Resolved 2026-09-22.** Owner approved; verified backup + restore drill, preflight 12/12, deploy, post 33/33, snapshots and finances byte-identical. Production: open (no target). |

No commit was made.
