# Phase 06 — Materials, equipment and customer requirements

Status: see §12, the gate (2026-09-22). This phase builds on Phases 00–05. The Phase 05 pricing and quote engine is unchanged. No second catalogue or resolver was created.

## 1. Audit — what existed before

| Where | What | Classification |
|---|---|---|
| `catalog_config.materialPolicy` / `equipmentPolicy` / `sparePartsPolicy` | one enum per service ("who provides"), with no items | **KEPT** as the legacy summary. It is not a requirement list and is not converted automatically. |
| `catalog_config.materials` (string[]) and `preparation` (string[]) | free text, with no kind, responsibility, charge or enforcement | **DEPRECATED** (commented in the schema). It is still shown when no structured requirement exists and is never auto-converted. |
| `services.requirements` (legacy `String[]` column) | unused free text | **UNTOUCHED** (history). The Prisma relation was named `requirementAssignments` to avoid the collision. |
| web `lib/catalog/taxonomy.ts` `prepare` (e.g. "Make sure water and electricity are available") | frontend-authored preparation shown on every service in a category | **FABRICATED PREREQUISITE → no longer rendered.** Preparation comes only from the backend. |
| partner job brief | no materials or equipment for the job | **GAP → closed** (brief from the booking snapshot) |
| booking | no record of what the customer was told or confirmed | **GAP → closed** (`service_config_snapshot.requirements`, `requirements.v1`) |

## 2. Domain model (additive migration `20260922100000_service_requirements`)

**`service_requirement_items`** — the catalogue: *what* an item is.

| Column | Notes |
|---|---|
| `code` | unique, kebab-case, ≤ 60 |
| `kind` | `MATERIAL` / `EQUIPMENT` / `CUSTOMER_PRECONDITION` |
| `name`, `customer_label`, `description` | length CHECKs |
| `is_active`, `version` | CAS on update |

**`service_requirements`** — the assignment: *how* a service uses an item. Each concern is a separate field, never one blob:

| Field | Values |
|---|---|
| `responsibility` | `CUSTOMER` / `PROFESSIONAL` / `PLATFORM` / `SHARED` / `UNKNOWN` (UNKNOWN is refused at publish) |
| `procurement` | who buys it, when different from who brings it (nullable) |
| `charge` | `INCLUDED` / `CHARGEABLE` / `SEPARATE_QUOTE` / `NOT_APPLICABLE` |
| `enforcement` | `INFORMATIONAL` / `WARNING` / `REQUIRED_BEFORE_BOOKING` / `REQUIRED_BEFORE_ARRIVAL` / `REQUIRED_AT_START` |
| `verification` | `NONE` / `CUSTOMER_ATTESTATION` / `PARTNER_CHECK` |
| `quantity` + `unit` + `quantity_basis` | `PER_BOOKING` / `PER_SELECTED_UNIT`; all three or none |
| conditions | `when_variant_codes`, `when_addon_codes`, `when_min_quantity` |
| notes | customer note, customer warning, partner instructions, handling note, internal note (length-capped) |
| other | `is_optional`, `sort_order`, `is_active` |

**Database invariants** (CHECK constraints; 19 constraints and 7 indexes in total):
- A customer-provided item has charge `NOT_APPLICABLE`.
- `CHARGEABLE` requires `when_addon_codes`, so the add-on that prices it is named. Requirements never price anything; Phase 05 is unchanged.
- `REQUIRED_BEFORE_BOOKING` requires `CUSTOMER_ATTESTATION`.
- The quantity shape rules and text lengths above.
- Unique (service, code).
- FK `item_id` `ON DELETE RESTRICT`: a used item cannot be deleted. FK `service_id` `ON DELETE CASCADE`.

**Pattern:** the same one Phase 03 uses for variants and add-ons. The typed zod copy lives in `catalog_config.requirements`; the relational rows are written in the same transaction; rows win on hydrate. Item facts (`requirementItems`) are populated by the server only. A client-sent copy is stripped and never persisted.

## 3. The one resolver

`lib/service-requirements.ts`:

**`validateServiceRequirements(cfg)`** is the static publish and bookability gate. Its issues:
- `REQUIREMENT_ITEMS_UNRESOLVED`
- `REQUIREMENT_DUPLICATE_ID`
- `ITEM_UNKNOWN`, `ITEM_INACTIVE`
- `RESPONSIBILITY_UNKNOWN`
- `KIND_INCONSISTENT`
- `CHARGE_UNSPECIFIED`, `CHARGE_INVALID`
- `CONDITION_INVALID`
- `QUANTITY_BASIS_INVALID`
- `CONFLICT` — the same item, with overlapping conditions, assigned differently

**`resolveServiceRequirements(cfg, {variantId, addonIds, quantity})`** returns the requirements of this selection:
- Deterministic: sorted by sortOrder, then code.
- Deduplicated by item.
- Fail-closed: `REQUIREMENT_CONFIGURATION_INVALID` or `REQUIREMENT_CONFLICT`, never a guess.
- Inactive assignments never resolve.

Projections:

| Function | Produces |
|---|---|
| `customerRequirementsView` | groups `weBring`, `youProvide`, `shared`, `beforeArrival`, `beforeBooking`, `optional`, as server-phrased text. No enums, partner instructions or internal notes. |
| `buildRequirementsSnapshot` | `requirements.v1`: items without `internalNote`, the attested codes, the service version, and `professionalNeeds` (the Phase 11 matching contract; no matching change was made) |
| `partnerRequirementsFromSnapshot` | `bringMaterials`, `bringEquipment`, `customerProvides`, `preconditions` (check `CONFIRMED_BY_CUSTOMER` / `VERIFY_ON_ARRIVAL` / `VERIFY_AT_START` / `INFORMATIONAL`). Always from the booking snapshot. |
| `customerRequirementsFromSnapshot` | what this customer was told, from the snapshot |

## 4. Where it runs

- **Publish gate** (`catalogService` create and update): the requirement issues join `blockingBookabilityIssues`. `assertBookable` refuses `REQUIREMENTS_CONFIG_INVALID`.
- **Quote** (`bookingPricingService.quote`): resolves after the selection. The breakdown gains `requirements` (customer view); the result gains `resolvedRequirements`. A conflict or invalid config refuses the quote.
- **Booking** (`booking.service.create`):
  - Every `REQUIRED_BEFORE_BOOKING` code must be in `requirementAttestations`, otherwise **400 `REQUIREMENTS_NOT_CONFIRMED`**, carrying `requirements:[{code,label}]` and the quote.
  - The check runs in the backend; the client checkbox is only UX.
  - The snapshot is written once, at creation.
- **Reads:** partner `GET /api/bookings/:id` returns `booking.requirements` from the snapshot. The customer sees the same booking's `requirements` (customer view, from the snapshot). Service detail returns `preparation` (customer view of the base selection).

## 5. API

| Endpoint | Auth | Contract |
|---|---|---|
| GET `/api/admin/requirement-items` | SETTINGS READ | catalogue list (`?kind=`, `?includeInactive=true`); each item carries `activeAssignments` |
| POST `/api/admin/requirement-items` | SETTINGS CREATE | 201; 409 on duplicate code; 400 on invalid code/kind |
| PUT `/api/admin/requirement-items/:id` | SETTINGS UPDATE | `expectedVersion` CAS → 409 `VERSION_CONFLICT`; archiving an item used by an active assignment → 409 `IN_USE` |
| PUT `/api/admin/services/:id` | SETTINGS UPDATE | `catalogConfig.requirements` (full assignment incl. internal note); version bump, `ServiceConfigVersion`, audit `SERVICE_CONFIG_VERSIONED`; invalid → 400 `INVALID_CONFIG` + issues |
| GET `/api/services/:id` | public | `preparation` (customer view); `catalogConfig` never carries `requirements` / `requirementItems` |
| POST `/api/bookings/price-quote` | customer | `quote.requirements` for the selection |
| POST `/api/bookings` | customer | `requirementAttestations?: string[]`; 400 `REQUIREMENTS_NOT_CONFIRMED` |

Audit actions: `REQUIREMENT_ITEM_CREATED`, `REQUIREMENT_ITEM_UPDATED`, `REQUIREMENT_ITEM_ARCHIVED`, `SERVICE_CONFIG_VERSIONED`.

## 6. Clients

| Surface | Change |
|---|---|
| web service detail | "What you need before we arrive" (`ServicePreparation`) when configured; otherwise the existing materials section. Generic category preparation removed. |
| web `/book` | `BookingPreparation` with checkboxes for `beforeBooking`; sends `requirementAttestations`; `REQUIREMENTS_NOT_CONFIRMED` scrolls to the section |
| customer mobile `app/book.tsx` | "Before we arrive" block + checkbox pressables; `QUOTE_ERROR_COPY` for the 3 new codes |
| partner web job detail | `JobPreparation` after `JobBrief` |
| partner mobile `JobDetailScreen` | "Job preparation" block (`testID job-preparation`) |
| admin service editor | tab "09b Requirements": assignments + new catalogue item form; merge-not-rebuild (`unlessDefault`), server-owned `requirementItems` never sent back |

## 7. Observability

| Counter | Labels |
|---|---|
| `service_requirement_resolution_total` | `outcome` |
| `requirement_resolution_failure_total` | `reason` |
| `requirement_attestation_missing_total` | — |
| `configuration_validation_failure_total` | `code` (REQUIREMENT_* only; no names, notes or ids) |
| `requirement_catalog_mutation_total` | — |

All except the catalogue counter are asserted in the integration suite.

## 8. Readiness report

`bun --env-file=.env run scripts/requirements-readiness-report.ts [--json] [--fail-on-invalid]` is read-only. For each service it reports materials, equipment and preconditions as `CONFIGURED` / `INVALID` / `OWNER_INPUT_REQUIRED`, plus the blocking codes of the base selection, the legacy policy fields and the gate issues.

An empty kind is never reported as `NOT_APPLICABLE`: "needs nothing" is an owner statement.

## 9. Snapshot and versioning

- `service_config_snapshot.requirements` is written once, at booking creation, and never updated.
- Changing a service's requirements bumps its version; existing bookings keep their snapshot (tested; M4/M10).
- Stale editors get 409.

## 10. Hydrate cost

- The store probes `to_regclass` once per process, so a database without the Phase 06 tables is not queried and does not log a Prisma error per read. "Absent" is rechecked every 60 s.
- Steady state: 3 queries, or 4 when requirements exist.

## 11. Owner inputs (none invented)

| Input | State |
|---|---|
| Materials, equipment, preconditions for each of the 31 live services | **APPLIED to `homigo_db` 2026-09-22** under owner authorisation: `phase-06-requirement-content-final.md` (70 items, 150 assignments, hash `c19f8ab1…`), certified in `phase-06-requirement-content-final-certification.md`. 25 READY · 1 READY_WITH_INSPECTION · 4 COMMERCIAL_HOLD · 1 SAFETY_HOLD · 0 invalid. The earlier proposal is kept as history. |
| Supplier / procurement party, quantities, specs, safety/chemical handling | OWNER_INPUT_REQUIRED per item |
| A way to record "this service needs nothing of kind X" | OWNER_INPUT_REQUIRED (a policy decision; not modelled) |
| Migrating legacy `materials` / `preparation` free text into structured items | OWNER_INPUT_REQUIRED (not auto-converted: free text has no responsibility, charge or enforcement) |
| Applying the migration to `homigo_db` | **DONE 2026-09-22** with owner approval (see §12). Production: OPERATOR_ACTION when a target exists. |

## 12. Gate (2026-09-22) — evidence from commands run, nothing inferred

| Area | Result | Evidence |
|---|---|---|
| Implementation / engineering | **PASS** | backend + 5 client apps tsc 0; lint 0 errors on changed files |
| Unit + integration | **PASS** | `service-requirements.test.ts` 20/0; `service-requirements.integration.test.ts` 14/0; admin editor 8/0; mobile quote 6/0; RBAC routes 11/0 |
| Full backend regression | **PASS** | 2971 / 0 across 249 files (Phase 05 close: 2936) |
| Migration parity | **PASS** | `certify-fresh-migrate` rebuilt `homigo_migrations_test` (drift OK, 35 protected objects); `diff-schema-catalogs` vs `homigo_test` = 93, the unchanged Phase 05 baseline, **0** Phase 06 objects; Phase 06 suites 32/0 on the migrations DB (inserts verified there) |
| Reintroduction proofs M1–M10 | **PASS** (M9 after a test was added) | isolated copy + a migrations-built proof DB; every defect GOOD → FAIL → byte-identical restore → GOOD. See the table below. |
| Browser (isolated stack → homigo_test) | **PASS** | customer web 11/11, partner web 6/6 (+ history check 6/6), admin 6/6; no leaks, no unexpected API errors |
| Data integrity (live `homigo_db`) | **PASS** | bookings / payments / refunds / ledger / 707 booking snapshots / 66 services fingerprints identical before → after; Phase 06 tables not created there |
| Live migration (`homigo_db`) | **PASS** (owner-approved 2026-09-22) | verified backup `07fb8fd6…` (restore drill PASS, RTO 33.6 s) → read-only preflight 12/12 → `migrate deploy` (1 migration) → post 33/33: tables + 5 named constraints + FK RESTRICT present, 0 rows seeded, 707 booking snapshots and 113 partner windows byte-identical, protected-object drift OK, all financial fingerprints identical; live backend picked the tables up without a restart. Evidence: `docs/operations/evidence/phase-06-migration-homigo_db-2026-09-22.json` |
| Production migration | **OPERATOR_ACTION** | no production target exists; same runbook (`phase05-migration-preflight.ts`, now Phase 06-aware) |
| Business configuration | **OWNER_INPUT_REQUIRED** | 31/31 live services, all three kinds (§11) |

### Reintroduction proofs

| # | Defect reintroduced | Caught by |
|---|---|---|
| M1a | customer view reads partner instructions | 4 tests (unit + customer detail/quote + projections) |
| M1b | public config stops stripping requirements | customer detail/quote test |
| M2 | equipment dropped from the partner brief | 3 tests |
| M3a | admin editor rebuilds config from `{}` | 3 editor tests |
| M3b | editor drops fields the form does not model | 1 editor test |
| M3c | saving one service deletes every service's rows | sibling-isolation test (added this phase) |
| M4 | partner view reads the current service instead of the snapshot | projections + versioning |
| M5 | backend attestation check removed | booking + 2 downstream tests |
| M6 | resolver ignores `active` | inactive-exposure test |
| M7 | conditional add-on requirement never resolves | 7 tests |
| M8 / M8b | conflict check removed (static; static + resolver) | 3 tests each |
| M9 | requirement-catalogue create needs only READ | **first run NOT caught** (no seeded non-super role holds any SETTINGS permission, so HTTP cannot tell READ from CREATE); `admin-rbac-routes.test.ts` now pins the rule → 1 fail |
| M10 | a version update rewrites existing booking snapshots | versioning test |

### Defects found and fixed during certification

| # | Defect | Found by | Fix + proof |
|---|---|---|---|
| D1 | partner web job page reads bookings from `/api/providers/me/bookings`, which had no `requirements` → "Job preparation" never rendered on partner web | reading the page's data flow before the browser run | list payload carries `partnerRequirementsFromSnapshot`; integration assertion; removing the fix → 1 fail; browser 6/6 |
| D2 | admin services list / save responses validated a config without catalogue facts → `REQUIREMENT_ITEMS_UNRESOLVED` → Save disabled for every service with requirements | admin browser run | `withRequirementItemsMany` (one query per page) + `hydratedAdminRow`; test; revert → 1 fail |
| D3 | lifecycle publish gate used the same unhydrated config → publishing a service with requirements refused | code review while fixing D2 | hydrate before the gate; pause → publish test; revert → fail |
| D4 | Prisma logged a 42P01 error on every read on a DB without the tables | readiness report run on `homigo_db` | cached `to_regclass` probe (§10) |
| D5 | web rendered generic category "preparation" (e.g. water and electricity) the backend never configured | audit | removed (§1) |
