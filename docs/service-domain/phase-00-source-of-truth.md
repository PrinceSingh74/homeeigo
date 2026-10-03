# Phase 00 — Service domain: audit and source of truth

Audit date: 2026-09-21. Read-only. No live business row was changed during this audit.
Measured against the local live database `homigo_db` (docker `homigo-postgres:5433`) and the isolated `homigo_test`.

## 1. Current architecture (what exists, not what is planned)

The service domain was already built in earlier passes (`docs/service-domain-architecture.md`,
`docs/service-domain-data-model.md`). It is a **hybrid**:

```
services row (identity, lifecycle, price columns, duration column, content columns)
  + services.catalog_config JSONB   (zod: serviceCatalogConfigSchema — quantity, variants, add-ons,
                                     audiences, content, duration, policies, media, payment, quality …)
  + service_variants / service_addons (relational copy of the JSON options; dual-written by admin save)
  + service_config_versions          (published catalog_config per (service_id, version))
  + service_categories               (lookup of the 5 distinct services.category strings; NO reader)
        │
        ▼  loadHydratedCatalog()  — relational rows override JSON when present
  resolveSelection()  (lib/service-catalog-config.ts)   ← the ONLY pricer / selection validator
        │
  bookingPricingService.quote()  →  booking.service.create()
        │                                 └─ bookings.service_selection (priced snapshot)
        │                                 └─ bookings.service_config_version / _snapshot
        ▼
  matching.service + service-match.ts (operational category → provider skills)
```

Customer web adds a second, **editorial** layer: `apps/web/src/lib/catalog/taxonomy.ts` defines the
13 customer categories and 113 service definitions; `adapter.ts buildCatalog()` binds a definition to a
backend service by slug (`bind: [...]`). A definition with no bound active backend row is shown as
"coming soon".

## 2. Current models (Prisma, `apps/backend/prisma/schema.prisma`)

| Model / table | Key fields | Constraints (live) | Notes |
|---|---|---|---|
| `Service` / `services` | `id` cuid PK, `name` UNIQUE, `slug` UNIQUE, `service_code` UNIQUE (nullable), `display_name`, `category` text, `subcategory` text, `base_price/min_price/max_price` float, `estimated_duration` int, `duration_range` text, `pricing_model` text, `is_active`, `is_customer_visible`, `is_bookable`, `lifecycle_status` enum, `config_status` enum, `capability_profile` enum, `version` int, `catalog_config` jsonb, content arrays (`included_services`, `excluded_services`, `requirements`), media (`icon`, `thumbnail`, `images[]`), SEO (`seo_*`), audit (`published_at/by`, `created_by`, `updated_by`, `last_reviewed_at`), `owner_team`, `operations_notes` | PK only; 3 unique indexes; no CHECK constraint; no trigger | `category`/`subcategory` are free strings, not FKs |
| `ServiceVariant` / `service_variants` | `service_id` FK, `code`, `name`, `price`, `duration_min`, `audiences[]`, `inclusions[]`, `exclusions[]`, `requirements[]`, `quantity_override` jsonb, `sort_order`, `is_active` | UNIQUE(service_id, code); CHECK price ≥ 0; CHECK code format | 0 rows live |
| `ServiceAddon` / `service_addons` | `service_id` FK, `code`, `name`, `price`, `duration_min`, `quantity_allowed`, `compatible_variant_codes[]`, `sort_order`, `is_active` | UNIQUE(service_id, code); CHECK price ≥ 0; CHECK code format | 0 rows live |
| `ServiceConfigVersion` / `service_config_versions` | `service_id` FK, `version`, `status`, `catalog_config`, `snapshot` | UNIQUE(service_id, version); CHECK version > 0; CHECK status | 0 rows live |
| `ServiceCategory` / `service_categories` | `slug` UNIQUE, `name`, `parent_id` self-FK | — | 5 rows (cleaning, beauty, repair, home, apartments); **no code reads it** |
| `Booking` (service part) | `service_id` FK RESTRICT, `service_selection` jsonb, `addons` jsonb, `service_config_version`, `service_config_snapshot`, `estimated_duration` | slot trigger + GiST exclusion (protected) | snapshot, not FK, so history survives catalogue edits |

Enums: `ServiceLifecycleStatus` (DRAFT, CONFIGURATION_REQUIRED, READY_FOR_REVIEW, PUBLISHED, ACTIVE,
PAUSED, DEPRECATED, ARCHIVED), `ServiceConfigStatus` (READY, CONFIGURATION_REQUIRED, COMING_SOON,
PAUSED, ARCHIVED, INTERNAL), `ServiceCapabilityProfile` (GENERAL, HOME_HELP, CLEANING, REPAIR, APPLIANCE,
BEAUTY, SENIOR_CARE, PET_CARE, CONCIERGE, VEHICLE).

No `ServiceOptionGroup`, `ServiceOption`, `ServiceQuantityRule`, `ServiceDurationRule`, `ServiceContent`
or `ServiceMedia` model exists; quantity, duration, content and media live in the validated
`catalog_config` document and in `services` columns.

## 3. Current APIs

| Method | Path | Auth / RBAC | Request | Response | Consumer | Owner |
|---|---|---|---|---|---|---|
| GET | `/api/services` | public | page, limit, category, city, minPrice, maxPrice, sortBy | `{services: formatServiceList[], total, page, limit}` (5 s serialized body cache + 60 s data cache) | web catalogue, mobile, sitemap | `catalog.service.list` |
| GET | `/api/services/featured` | public | — | `{services[{id,name,basePrice,rating,…}]}` | web/mobile home | `catalog.service.featured` |
| GET | `/api/services/category/:category` | public | page, limit | `{services[{id,name,basePrice,category}]}` (operational category string) | web/mobile legacy | `catalog.service.byCategory` |
| POST | `/api/services/search` | public | q, category, city, price, pricingModel, audience, bookingMode | `{services[], total, searchTime}` | web/mobile search | `catalog.service.search` |
| GET | `/api/services/:id` | public (`CUSTOMER_CATALOG_WHERE`) | — | `{service: detail}` incl. `publicCatalogConfig`, bookable, ratings, policy copy | web detail, /book, mobile | `catalog.service.byId` |
| POST | `/api/bookings/price-quote` | customer JWT | serviceId, variantId, quantity, audience, professionalPreference, addonIds, packagePrice, addressId/lat/lng, couponCode | breakdown incl. `selection` snapshot | web /book, mobile book | `bookingPricingService.quote` |
| POST | `/api/bookings` | customer JWT | same selection keys + schedule | booking (stores selection + snapshot) | web/mobile | `booking.service.create` |
| GET | `/api/providers/me/services` | partner JWT | — | eligible operational services (policies, checklist) | partner-web work-hq | `catalog.service.partnerEligible` |
| GET | `/api/partner/register/service-options` | public (registration) | — | onboarding options from catalogue | partner web/mobile onboarding | `catalog.service.partnerOnboardingOptions` |
| GET | `/api/providers/me/bookings` | partner JWT | — | jobs: `service{id,name,icon,basePrice}`, `addons` — **no selection / duration** | partner web/mobile | `provider.service.myBookings` |
| GET | `/api/bookings/:id` (partner branch) | partner JWT | — | + `execution` (materials, equipment, quality, durationMinutes) — **no variant / quantity** | partner mobile (not rendered), web never calls | `booking.service.getById` |
| GET | `/api/admin/services` | admin, SETTINGS:READ | search, category, status, sort | admin rows + summary | admin-panel `/services` | `catalog.service.adminList` |
| GET | `/api/admin/services/:id` | SETTINGS:READ | — | admin row (hydrated) | **no admin-panel client** | `catalog.service.adminById` |
| POST | `/api/admin/services` | SETTINGS:CREATE | `createServiceBody` (t.Object) + zod config | row / 400 INVALID_CONFIG / 400 SERVICE_NOT_BOOKABLE / 409 DUPLICATE | admin-panel | `catalog.service.create` |
| PUT | `/api/admin/services/:id` | SETTINGS:UPDATE | partial body | same + 404 | admin-panel | `catalog.service.update` |
| PATCH | `/api/admin/services/:id/status` | SETTINGS:UPDATE | `{isActive}` | row | admin-panel | `catalog.service.setActive` |
| DELETE | `/api/admin/services/:id` | SETTINGS:DELETE | — | 404 / 409 HAS_BOOKINGS | admin-panel | `catalog.service.remove` |

There is no lifecycle-transition, version-history, taxonomy, variant or add-on endpoint; publishing and
versioning are side effects of POST/PUT/PATCH-status.

## 4. Consumers

**Customer web** (`apps/web`): `lib/catalog/{taxonomy,adapter,pricing,content,filters,search}.ts`,
`components/services-catalog/**`, `app/book/BookPageClient.tsx`, `hooks/use-catalog.ts`,
`hooks/use-marketplace-sections.ts`, `lib/server-api.ts`, `types/backend.ts` (hand mirror of the public
contract).
**Customer mobile** (`homigo-mobile`): `lib/service-mapper.ts`, `lib/booking-quote.ts`, `app/book.tsx`,
`hooks/use-catalog.ts`, `types/backend.ts` (reduced mirror).
**Admin** (`apps/admin-panel`): `app/(console)/services/page.tsx`, `components/services/ServiceConfigEditor.tsx`,
`services/admin-api.ts` (`AdminServiceRow`, `ServiceCatalogConfig`, `ServiceInput` mirrors),
`hooks/use-admin-data.ts`.
**Partner** (`apps/partner-web`, `homigo-partner-mobile`): job cards / job detail read `service.name` and
`addons`; `work-hq/services` reads `/me/services`; onboarding reads `service-options`. Web and mobile
`PartnerBooking` mirrors have drifted (web has `addons`, mobile has `execution`).

## 5. Source of truth per domain object

| Object | Database | Backend | API | Frontend mirror | Classification |
|---|---|---|---|---|---|
| Service identity (id, slug, name) | `services` | catalog.service | `/api/services*` | web `ServiceDef.bind` (slug copy) | AUTHORITATIVE (DB); web bind = DERIVED binding |
| service_code | `services.service_code` (= slug for all 66 rows) | admin only | admin only | — | AUTHORITATIVE, but editable and nullable |
| Customer category taxonomy (13) | **none** | none | none | `taxonomy.ts CATEGORIES` | **DUPLICATE / UNKNOWN authority** — lives only in web code |
| Operational category (5) | `services.category` string | service-match, matching | `category` field | web `backendCategories` fallback | AUTHORITATIVE for matching |
| Subcategory | `services.subcategory` string (5 values) | — | `subcategory` field | web marketplace sections group by it; taxonomy subgroups (13) are a different set | **DUPLICATE** (two unrelated subcategory sets) |
| `service_categories` table | 5 rows | no reader | none | — | LEGACY (dead lookup) |
| Lifecycle | `lifecycle_status` + `is_active` | deriveLifecycleOnWrite | admin row | admin mirror (not rendered) | AUTHORITATIVE, but only ACTIVE/PAUSED/PUBLISHED reachable |
| Price | `base/min/max_price`, variant/add-on price | resolveSelection | quote | web `estimateSelection`, `tierOptions`, mobile `packageTiers` | AUTHORITATIVE server; clients DUPLICATE logic |
| Variants / add-ons | JSON **and** tables | hydrateCatalogConfig (tables win) | public config | web/mobile/admin mirrors | AUTHORITATIVE, with a **sync-integrity defect** (§7) |
| Shared add-ons (fridge/sofa/microwave) | none (code constant) | `BOOKING_ADDONS` | resolved into quote | web `pricing.ts BOOKING_ADDONS`, mobile `lib/services.ts ADDONS` (dead) | AUTHORITATIVE backend constant; web copy DUPLICATE |
| Quantity rule | `catalog_config.quantity` | resolveSelection | public config | web/mobile quantity bounds | AUTHORITATIVE |
| Duration | `estimated_duration` + `catalog_config.duration` + variant/add-on minutes | resolveSelection **and** `operationalSlotMinutes` (two calculators) | `estimatedDuration`, `durationRange` text | web `formatDuration`, mobile "60-120 mins" literal | AUTHORITATIVE, **duplicated calculator** |
| Reserved partner slot | trigger `bookings_sync_conflict_slots` (fixed ±30 min) | booking-validation | — | — | AUTHORITATIVE, deliberately ≠ service duration (owner decision D1 pending) |
| Content | columns + `catalog_config.content` | projections | detail | web `content.ts` (approved fallback copy only) | AUTHORITATIVE |
| Media | URL strings in columns + `catalog_config.video/media` | none (no validation) | detail | web `service-visuals.ts` curated art | AUTHORITATIVE, unvalidated |
| Ratings | derived from `ratings` | ratingsForServices | list/detail | — | DERIVED (never stored) |

## 6. Capability profiles

`ServiceCapabilityProfile` exists with all nine prompt profiles plus `GENERAL`. Live distribution:
CLEANING 59, GENERAL 3, REPAIR 3, BEAUTY 1. Profile-specific rules live in `service-domain.ts
profileIssues()` (BEAUTY needs audiences + variant; HOME_HELP needs HOUR; REPAIR needs inspection/quote
unless fixed; CARE needs HOUR unless fixed). This is already "common core + profile-specific checks";
it is reused, not replaced.

## 7. Defects found (duplicate authority, integrity, safety)

| ID | Severity | Defect | Evidence |
|---|---|---|---|
| D00-1 | P1 | Admin config editor rebuilds `catalogConfig` from `{}` on save; fields it does not model are silently wiped (coverage, materials[], equipment[], duration min/max/estimated, variant inclusions/quantity, add-on compatibility, payment timing …) | `ServiceConfigEditor.tsx extrasToInput` starts from `{}`; PUT replaces the whole document |
| D00-2 | P1 | Relational variant/add-on sync runs after the service write, outside its transaction, and swallows every error; reads prefer the tables, so a failed sync leaves a stale price authority that wins over the saved JSON | `service-catalog-store.ts syncRelationalCatalog` `catch {}`; `hydrateCatalogConfig` table-wins |
| D00-3 | P2 | Relational row id `sv_${serviceId.slice(0,10)}_${code}` can collide across services created in the same instant (PK clash → swallowed → options missing) | `optionId()` |
| D00-4 | P1 | Test DB lacks six CHECK constraints the migrations declare (variant/add-on price & code format, version positive, version status) and `check-test-db-invariants.ts` reports OK because it only parses `ADD CONSTRAINT … CHECK`, not inline `CONSTRAINT x CHECK` in `CREATE TABLE` | diff of `pg_constraint`; checker regex line 143 |
| D00-5 | P2 | `published_at` / `last_reviewed_at` are `timestamptz` in migrations but plain `timestamp` in the pushed test DB (schema.prisma lacks `@db.Timestamptz`) | information_schema diff |
| D00-6 | P2 | Version bumps only on config/activation; a price or duration change on a live service keeps the same version; version is read-modify-written (lost update) and the version row is `upsert … update: {}` (silently keeps the first writer); snapshot stores blank name/slug/price | `catalog.service.update`, `persistPublishedVersion` |
| D00-7 | P2 | Admin actor never recorded (`created_by`, `published_by`, audit userId all null) | routes do not pass the admin id |
| D00-8 | P2 | Lifecycle has no explicit transitions: DRAFT/READY_FOR_REVIEW/DEPRECATED/ARCHIVED are unreachable from the API, and an ARCHIVED row would be re-activated by `PATCH status` | `deriveLifecycleOnWrite` |
| D00-9 | P1 | Customer taxonomy (13 categories, 13 subgroups) exists only in web code; backend has 5 operational strings and a dead `service_categories` lookup; three unrelated "subcategory" sets | §5 |
| D00-10 | P1 | 17 active test-fixture services (`adv-service-*`, `rc*`, `phase2-*`) are returned by the public API; only the web's name regex hides them (mobile maps every row) | `CUSTOMER_CATALOG_WHERE` has no taxonomy requirement |
| D00-11 | P1 | Partners never receive the selected variant, audience, quantity, unit or booked duration | `provider.service.myBookings`, `booking.service.getById` partner branch |
| D00-12 | P2 | Two duration calculators (`resolveSelection` inline, `operationalSlotMinutes`); HOUR scaling multiplies preparation/cleanup; no min ≤ estimated ≤ max or sum-to-total validation | `service-catalog-config.ts`, `service-domain.ts` |
| D00-13 | P2 | Resolver returns only the first error; customers cannot be told every reason a selection is invalid; web shows incompatible add-ons as selectable and silently clamps quantity / swaps variant | `resolveSelection`, `ServiceDetail.tsx` |
| D00-14 | P2 | Client copies of pricing logic and data: web `estimateSelection`, `BOOKING_ADDONS`, `PACKAGE_TIERS`; mobile `packageTiers`, dead `ADDONS`; mobile discovery price fallback `199` and duration `"60-120 mins"` | customer consumer map |
| D00-15 | P2 | Media URLs unvalidated (`thumbnail`, `images`, `icon`, `media.gallery`); `video` accepts any URL scheme | admin body schema, zod `url()` |
| D00-16 | P3 | Variant `quantity` override has no max ≥ min check; add-on `quantityAllowed` has no consumer | zod, resolver |
| D00-17 | P2 | Partner catalogue leak guard does not know catalogue-internal keys | `privacy-policy.engine.ts collectForbiddenPartnerKeys` |
| D00-18 | P3 | `service_code` nullable, editable, no format check; no CHECK on price/duration columns | schema |

## 8. Catalogue integrity (measured, live `homigo_db`)

| Measure | Value |
|---|---|
| services | 66 (31 real, 35 test fixtures) |
| active / customer-visible / bookable | 48 / 48 / 48 (of which 17 are fixtures) |
| backend categories (distinct `category`) | 5 |
| backend subcategories (distinct) | 5 values on 15 rows |
| `service_categories` rows | 5, no children |
| customer taxonomy (web) | 13 categories, 13 subgroups, 113 definitions, 54 with a backend binding, 5 cross-listings |
| duplicate slug / service_code / name (case-insensitive) | 0 / 0 / 0 |
| orphan category (no lookup row) | 0 |
| bad slug or code format | 0 |
| non-positive duration, negative price, min > base, max < base | 0 each |
| services with `catalog_config` | 1 (`hourly-bookings`) |
| variant / add-on / config-version rows | 0 / 0 / 0 |
| bookings / payments / refund requests | 707 / 421 / 339 |

The request describes "129 services". No source in the repository has that number: the database has 66
(31 real), the web taxonomy has 113 definitions. This audit reports the measured figures.

## 9. Safe to reuse / extend / migrate / deprecate

- **Reuse:** `resolveSelection` (the only pricer), `bookingPricingService.quote`, `booking.service.create`
  snapshots, `CUSTOMER_CATALOG_WHERE` / `PARTNER_OPERATIONAL_WHERE`, capability profiles, config zod schema,
  `service_config_versions`, relational variant/add-on tables, the migration safety tooling.
- **Extend:** zod schema (content, media, duration validation, variantRequired), resolver (all issues,
  one duration calculator), `service_categories` (as the taxonomy tree), versioning (atomic, actor,
  selection-affecting fields), lifecycle (explicit transitions), partner job projection.
- **Needs migration:** `service_categories` tree + `services.category_id/subcategory_id`; identity and
  range CHECKs; `service_code NOT NULL`.
- **Needs deprecation:** client pricing copies (`estimateSelection`, web `BOOKING_ADDONS`, mobile `ADDONS`),
  `operationalSlotMinutes`, the dead `PATCH /api/admin/services/:id` permission rule.
- **Not changed (protected / owner decision):** the ±30 min slot trigger and exclusion constraints
  (`docs/business-decision-scheduling.md`, D1).

## 10. Migration impact

All planned schema changes are additive or constraint-tightening on data that already complies (verified
counts above are all 0). Protected objects (slot columns, exclusion constraints, money triggers,
sequences) are not touched. Test DB parity requires the invariant checker fix (D00-4) so the new CHECKs
reach `homigo_test`.

## Phase 00 gate

| Criterion | Result |
|---|---|
| Existing service architecture mapped | PASS (§1) |
| Existing schema mapped | PASS (§2) |
| Existing APIs mapped | PASS (§3) |
| Frontend / admin / partner consumers mapped | PASS (§4) |
| Capability profiles mapped | PASS (§6) |
| Duplicate authority identified | PASS (§5, §7) |
| Catalogue integrity measured | PASS (§8) |
| Migration impact documented | PASS (§10) |

**PHASE 00 = PASS** (audit complete; the defects above are the input to Phases 01–04).
