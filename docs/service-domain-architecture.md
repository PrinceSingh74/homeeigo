# Service domain architecture

This document describes the **implemented** HOMEEIGO service domain. It does not describe planned work that is not in the tree.

## Existing architecture reused

The live catalogue is still a single Prisma `Service` row (`services`) plus validated JSON `catalog_config`. Queryable options also live in `service_variants` and `service_addons`. Those rows **hydrate into** `resolveSelection` — they are not a second price calculator.

JSON remains the admin write payload. After save, rows are dual-written. If tables are empty (pre-migrate), JSON is used as-is.

Server price calculation is still `resolveSelection` in `apps/backend/src/lib/service-catalog-config.ts`. Quotes still go through `bookingPricingService.quote`. Bookings still go through `booking.service.create`. Matching still goes through `matching.service` + `service-match.ts`.

There is **no** second pricing engine, booking engine, availability engine, or duplicate catalogue.

## Hybrid model

| Kind | Owner | Why |
|------|--------|-----|
| Relational columns on `services` | Identity, lifecycle, visibility, version, capability profile | Query, index, RBAC-gated admin writes |
| Typed JSON `catalog_config` | Quantity, content, policies, coverage/availability **rules**, matching weights; JSON fallback for options | Zod-validated; dual-written to variant/addon tables |
| `service_variants` / `service_addons` | Queryable options. `code` is the customer `variantId` / addon id | Hydrate into `resolveSelection`; empty tables fall back to JSON |
| `service_categories` | Lookup of existing `services.category` strings | Public URLs still use the string column |
| `service_config_versions` | Immutable published JSON | Later admin edits must not rewrite what was sold |
| `bookings.service_selection` | Priced selection (variant, quantity, duration) | Existing snapshot, unchanged shape |
| `bookings.service_config_snapshot` | Policy/content slice at book time | Historical bookings stay explainable |
| Derived at read | Rating, review count | SQL aggregate from `ratings` → `bookings` → `service_id`. Never a stored “4.8” |

## Field mapping (Phase 0)

| Target field | Existing owner | Proposed owner | Migration | Consumers | Risk |
|--------------|----------------|----------------|-----------|-----------|------|
| service_id | `Service.id` | same | no | all | none |
| slug / name | `Service.slug`, `name` | same + `displayName` | additive | web/mobile/admin | slug is the public URL — still only changes when admin edits it |
| variants / add-ons | `catalogConfig` JSON | JSON + `service_variants` / `service_addons` (hydrate) | additive backfill | quote, book, admin | tables override JSON when rows exist |
| category / subcategory | string columns | same + `service_categories` lookup | additive | catalogue, matching | URL taxonomy unchanged |
| pricing_model, base/min/max | `Service` columns | same | no | quote | client still cannot send `finalAmount` |
| quantity | `catalogConfig.quantity` | same, extra unit types | no | quote | server enforces min/max/step |
| duration | `estimatedDuration` | + optional `catalogConfig.duration` slot times | no | booking `estimatedDuration` from selection | slot time ≠ marketing estimate when configured |
| coming soon | `catalogConfig.comingSoon` | same + `isBookable=false` | backfill | web/mobile | quote now returns `SERVICE_NOT_BOOKABLE` |
| lifecycle | `isActive` boolean | `lifecycleStatus` + `isActive` kept in sync | backfill | public list | existing `isActive` filters still work |
| coverage | `availableCities[]` + coverage engine | + `catalogConfig.coverage` + booking-time city/pincode check | no | list/search/book | empty lists mean unspecified, not “nowhere” |
| availability | partner slots + booking validation | + optional lead time / blackout / max advance on config | no | booking-validation | only enforced when configured |
| matching | `service-match.ts` category/slug maps | + optional `requiredSkills` AND-filter | no | matching.service | empty skills = previous behaviour |
| reviews | `Rating` aggregate | same | no | catalogue | never fabricated |
| SEO | `seoTitle` / description / keywords | + `catalogConfig.seo.noindex`; coming soon not indexable | no | web metadata | |
| analytics | `bookingCount`, popularity | still derived; not admin-editable truth | no | admin | |

## Views

- **PUBLIC** (`GET /api/services*`) — customer-safe projection. Matching weights, required skill lists, KYC flags, internal codes and operations notes are not serialized.
- **ADMIN** (`GET /api/admin/services`) — full config, gaps, section completion, publish blockers.
- **PARTNER** (`GET /api/providers/me/services`) — id, name, slug, category, duration, required skills, inspection/material/equipment policies. No matching weights.

## Lifecycle

`isActive` remains the customer-visibility switch used by existing clients.

| State | `isActive` | `isBookable` |
|-------|------------|--------------|
| ACTIVE | true | true |
| PUBLISHED + coming soon | true | false |
| PAUSED / ARCHIVED / DRAFT | false | false |

Activation is rejected only for **blocking** gaps (missing price, duration, or a quantity rule the pricing model needs). Advisory gaps (materials policy, beauty audiences) stay visible in admin and do not silently un-publish grandfathered SKUs.

## Price and booking

1. Client sends ids + quantity + audience.
2. `assertBookable` rejects paused / coming-soon / inactive.
3. `resolveSelection` prices from server catalogue (exact package tiers, variant, quantity step, add-on compatibility).
4. Booking stores `serviceSelection` (existing) and `serviceConfigSnapshot` (new). Live catalogue edits do not rewrite those columns.

Payment flags, matching weights, and quality rules are consumed by the **existing** wallet, matching, and complete paths (`service-runtime-policy.ts`). Unset flags keep historical allow / additive-score behaviour.

## Analytics

Browse counters (`service_view_total`, `service_search_total`, `service_quote_generated_total`) increment on the authoritative catalog/quote APIs. Booking created/completed remain Homigo domain events. Conversion, revenue, and rating are derived — they are not editable SKU fields.
