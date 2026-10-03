# Phase 01 — Service identity + taxonomy

Status: **PASS** (2026-09-21). Builds on `phase-00-source-of-truth.md`.

## Identity (four distinct fields, none collapsed)

| Field | Column | Rule | Enforced by |
|---|---|---|---|
| service_id | `services.id` | immutable cuid PK | PK |
| service_code | `services.service_code` | stable business code; `NOT NULL`, unique, `^[a-z0-9][a-z0-9-]*$`; defaults to slug on insert; **immutable after create** | `services_service_code_key`, `services_service_code_format`, trigger `services_default_service_code_trg`, API `409 SERVICE_CODE_IMMUTABLE` |
| internal_service_code | `services.internal_service_code` | optional operational id, unique when set, `^[A-Za-z0-9][A-Za-z0-9._-]*$`, admin-only | `services_internal_service_code_key`, `_format` CHECK |
| slug | `services.slug` | public URL, unique, lowercase-hyphen; changes only when an admin sends it explicitly | `services_slug_key`, `services_slug_format` |

Also added: `display_name` (existing), `short_name`, `parent_service_id` (self-FK, `ON DELETE SET NULL`) for service families. `version` has `CHECK > 0`. Price and duration columns got range CHECKs (`base_price ≥ 0`, `min ≤ base ≤ max`, `estimated_duration > 0`). All were measured to hold on every live row before the migration (0 violations).

`service_type` / `fulfillment_type`: **not added**. `capability_profile` (GENERAL, HOME_HELP, CLEANING, REPAIR, APPLIANCE, BEAUTY, SENIOR_CARE, PET_CARE, CONCIERGE, VEHICLE) already classifies services and drives profile-specific validation; a second classification has no consumer.

## Taxonomy

`service_categories` (previously a dead 5-row lookup of dispatch strings) is now the customer taxonomy tree:

- 13 categories and 13 subcategories, copied from `apps/web/src/lib/catalog/taxonomy.ts`. Nothing was invented.
- The 4 legacy operational rows stay in the table, marked `is_active = false`; no history is deleted.
- Columns added: `short_name`, `description`, `sort_order`, `is_active`, `operational_categories[]`.
- The tree is exactly two levels deep, enforced by trigger `service_categories_depth_guard_trg` (`SERVICE_CATEGORY_TOO_DEEP`, `SERVICE_CATEGORY_SELF_PARENT`).

`services.category_id` and `services.subcategory_id` are FKs (`ON DELETE RESTRICT`). Trigger `services_resolve_taxonomy_trg`:
- derives `category_id` from the dispatch string via `operational_categories` when it is not set;
- rejects a category that is not top-level (`SERVICE_CATEGORY_NOT_TOP_LEVEL`);
- rejects a subcategory that belongs to another category (`SERVICE_SUBCATEGORY_MISMATCH`).

Backfill: the 54 explicit slug bindings from the web catalogue are applied first, then the operational fallback. On live, all 66 services have a category and 22 have a subcategory.

`services.category` is unchanged. It remains the dispatch/matching key (`service-match.ts`), so the dispatch contract did not move.

## Lifecycle

Existing enum kept. Mapping from the requested vocabulary:

| Requested | Implemented |
|---|---|
| DRAFT | `DRAFT` |
| VALIDATING | `CONFIGURATION_REQUIRED` |
| REVIEW | `READY_FOR_REVIEW` |
| APPROVED, SCHEDULED | not implemented: there is no approver role and no scheduled publisher (not invented) |
| LIVE | `ACTIVE` (bookable), or `PUBLISHED` (visible, coming soon, derived from `comingSoon`) |
| PAUSED, DEPRECATED, ARCHIVED | same |

Explicit transitions live in `LIFECYCLE_TRANSITIONS` (`lib/service-domain.ts`):
- `ARCHIVED` is terminal.
- `ACTIVE` must be paused or deprecated before it can be archived.
- `DEPRECATED` can only move to `ARCHIVED`.
- Publishing is always gated by `validateForActivation`.

The legacy `PATCH /status` toggle and `PUT isActive` go through the same guard. Before this change, an `ARCHIVED` row could be revived; now that attempt returns `409 INVALID_LIFECYCLE_TRANSITION` with the list of allowed moves.

## Versioning

`service_config_versions` (existing) is used; no second model. Fixes in this phase:
- Every write is one transaction covering the service row, its variant/add-on rows and the version row.
- `version` increments atomically (`{ increment: 1 }`), and the update is compare-and-set on the version it read.
- The version row is `create`, not `upsert … update: {}`, so a concurrent duplicate fails loudly (`VERSION_CONFLICT`).
- The version bumps on anything that changes what a booking buys (config, base/min/max price, duration, pricing model), not only on config JSON.
- The snapshot stores real identity and price (it used to store blanks).
- The acting admin is recorded in `created_by` / `updated_by` / `published_by`, on the version row and in the audit log.
- `expectedVersion` on `PUT` and the lifecycle endpoint gives the editor optimistic concurrency (`409 VERSION_CONFLICT`).

## API

| Method | Path | Auth / RBAC | Notes |
|---|---|---|---|
| GET | `/api/services/categories` | public | active tree with live service counts; no internal ids |
| GET | `/api/services?categorySlug=&subcategorySlug=` | public | additive filters; `taxonomy` added to every list row |
| GET | `/api/services/:id` | public | adds `version`, `taxonomy`, `content`, `duration`, `addons` (additive) |
| POST / PUT | `/api/admin/services[/:id]` | SETTINGS:CREATE / UPDATE | new body fields `categorySlug`, `subcategorySlug`, `internalServiceCode`, `shortName`, `expectedVersion` |
| POST | `/api/admin/services/:id/lifecycle` | SETTINGS:UPDATE | `{ to, expectedVersion? }` |
| GET | `/api/admin/services/:id/versions` | SETTINGS:READ | version history |
| GET | `/api/admin/service-categories` | SETTINGS:READ | full tree incl. inactive, with counts |

Stable admin error contract (`SERVICE_WRITE_STATUS`):

| Code | HTTP status |
|---|---|
| `INVALID_CONFIG`, `INVALID_IDENTITY`, `INVALID_MEDIA`, `INVALID_TAXONOMY`, `SERVICE_NOT_BOOKABLE` (with `issues[]`) | 400 |
| `NOT_FOUND` | 404 |
| `DUPLICATE` (with `field`), `VERSION_CONFLICT`, `SERVICE_CODE_IMMUTABLE`, `INVALID_LIFECYCLE_TRANSITION` (with `allowed[]`) | 409 |

Raw database messages never reach the client.

## Projections

- **Customer:** no `serviceCode`, `internalServiceCode`, `operationsNotes`, `ownerTeam`, matching weights or required skills. Asserted over HTTP on both list and detail.
- **Partner:** `/me/services` whitelist unchanged. `myBookings.service` is now built field by field. The partner leak guard (`partnerNeverSees`) now also knows the catalogue-internal keys.
- **Admin:** full row, plus `allowedTransitions`, `taxonomy`, `duration`, `reservedSlotMinutes` and the audit fields.

## Tests

- `service-identity-lifecycle.test.ts` (pure)
- `service-domain-foundation.integration.test.ts` (DB + routes) covers:
  - duplicate slug / code / internal code
  - format and range CHECKs
  - taxonomy derivation and mismatch
  - tree depth
  - lifecycle: archived is terminal, a paused service is hidden (404)
  - atomic versioning and the concurrent-editor case
  - RBAC for anonymous, customer, partner and a non-catalogue admin role
  - customer projection leak check
- Reintroduction proofs, each **GOOD → FAIL → RESTORED** (see the final execution board):
  - P1: drop the `service_code` unique index
  - P2: drop the taxonomy trigger
  - P7: map the admin PUT to a permission support admins hold
  - P8: remove the compare-and-set
