# Enterprise service domain map (Phases 00–06)

One service domain, projected three ways. Every arrow below is the same authoritative backend code.

```
service_categories (taxonomy tree: 13 categories → 13 subcategories)
        │  category_id / subcategory_id  (FK + trigger services_resolve_taxonomy)
        ▼
services (identity: id · service_code · internal_service_code · slug; lifecycle; version;
          content columns; media refs; price + duration columns with CHECKs)
   + catalog_config (zod serviceCatalogConfigSchema: quantity, variants, add-ons + dependencies,
                     content, media, duration, policies)
   + service_variants / service_addons (relational rows, written in the same transaction; win on read)
   + service_config_versions (one immutable row per published version, with actor)
   + service_requirements → service_requirement_items (Phase 06: materials / equipment / customer preconditions)
        │
        ▼  loadHydratedCatalog()
resolveServiceSelection()  ── the ONE resolver (variant · audience · add-ons · quantity · price)
   └─ resolveServiceDuration()  ── the ONE duration calculator
        │
        ├── POST /api/services/:id/resolve-selection   (customer preview: issues, availability, subtotal, duration)
        ├── bookingPricingService.quote                (integer paise: surge → fees → discounts → tax; signed quote)
        └── booking.service.create → re-prices; refuses PRICE_CHANGED / QUOTE_EXPIRED; stores selection,
                                      service_config_snapshot.pricing, slot_duration_minutes (D1)
                                          │
                                          └── payment.service.createOrder charges booking.finalAmount only
                                          │ (immutable)
                                          └── partnerJobBrief → partner job cards / detail
```

## Source of truth

| Object | Authority | Consumers (read the authority, never recompute) |
|---|---|---|
| Identity | `services` columns + unique/format CHECKs | admin row; customer gets id, slug, name only |
| Taxonomy | `service_categories` + FKs + trigger | `/api/services/categories`, list `taxonomy`, web adapter for unbound services, admin selects |
| Dispatch category | `services.category` (unchanged) | `service-match.ts`, matching |
| Lifecycle / visibility | `lifecycle_status` + `LIFECYCLE_TRANSITIONS` + `lifecycleFlags` | `CUSTOMER_CATALOG_WHERE`, `PARTNER_OPERATIONAL_WHERE`, `assertBookable` |
| Content | columns + `catalog_config.content` | detail `content` block, web sections |
| Media | URL refs (https or /path) | detail `content.media` |
| Variants / add-ons / dependencies | `catalog_config` ⇄ relational rows | resolver only |
| Price | resolver (line items, paise) + quote (surge/fees/discounts/tax, paise) — `lib/pricing-policy.ts` rounding | web detail (resolve-selection, quantityPrices), `/book`, mobile book, payment (booking.finalAmount) |
| Tax | `TAX_POLICY` (EXCLUSIVE, 1000 bps, tax.v1) | quote `tax`, booking pricing snapshot, `/book` + mobile labels |
| Fees | `PLATFORM_FEES` (none configured) | quote lines |
| Provenance | `services.data_origin` (DataOrigin) | customer catalogue / quotes / partner onboarding exclude non-real origins |
| Quantity | `catalog_config.quantity` | resolver only |
| Duration | `resolveServiceDuration` | booking `estimatedDuration`, detail `duration`, partner brief, admin |
| Requirements (materials, equipment, preconditions) | `service_requirement_items` + `service_requirements` ⇄ `catalog_config.requirements`; `resolveServiceRequirements` | detail `preparation`, quote `requirements`, booking attestation, `service_config_snapshot.requirements` → partner/customer booking projections |
| Partner calendar slot | trigger `bookings_sync_conflict_slots`: `[start−30, start+slot_duration_minutes+30)`; `services.partner_slot_policy` | `reservedWindow` pre-checks, admin `reservedSlotMinutes` (D1 decided) |

## Cross-phase resolved contract

`ResolvedServiceSelection` is the resolve endpoint response:
- `serviceId`, `serviceVersion`, `ok`, `issues[]`
- `normalized` (variantId, audience, quantity, addonIds, addonQuantities)
- `pricing` (servicePrice, addons with unitPrice × quantity = price, addonTotal, subtotal before tax)
- `selection` (variant, quantity, unitLabel, unitPrice, audience)
- `duration` (service / add-on / prep / cleanup / total + customer estimate)
- `addonAvailability[]`

It is derived only from server data; price and duration fields sent by a client are stripped by the route schemas and ignored.

## Invariants (database-enforced)

- services:
  - unique slug, service_code, internal_service_code; service_code `NOT NULL`
  - format CHECKs on slug, service_code, internal_service_code
  - `base ≥ 0`, `min ≤ base ≤ max`, `duration > 0`, `version > 0`
- taxonomy:
  - category must be top-level; subcategory must belong to its category
  - tree is exactly two levels deep
- variants / add-ons:
  - unique (service, code); code format; price ≥ 0; duration > 0
  - add-on max_quantity 1–100; no self-dependency
- versions: unique (service, version); version > 0; status ∈ {DRAFT, PUBLISHED}
- protected booking objects (slot exclusion, money triggers, sequences): untouched; `check-schema-drift` OK

## Test DB parity

`homigo_test` and a migrations-only database (`homigo_svc_proof_test`, since dropped) both carry every invariant. `check-test-db-invariants.ts` previously missed inline `CREATE TABLE` CHECKs and all but the first CHECK in a `DO` block, so 8 CHECKs were absent while it reported OK. That is fixed and covered by `test-db-invariant-parser.test.ts`. Both service migrations are in the `setup-test-db` replay list, so a `--reset` test DB gets the taxonomy rows.

## Migrations (hand-scoped, additive; no `db push`, no reset)

| Migration | Contents |
|---|---|
| `20260921150000_service_identity_taxonomy` | taxonomy columns + rows, identity columns, FKs, CHECKs, 3 triggers, backfill |
| `20260921160000_service_addon_dependencies` | add-on max_quantity / requires / conflicts columns + CHECKs |

Rehearsal: `certify-fresh-migrate.ts` (126 migrations, drift OK) on `homigo_cert_migrate` and on the proof DB. Applied to `homigo_test` (via `db:execute:test`) and to local `homigo_db` (`migrate deploy`), with your approval, after a verified backup (sha256 `336f55f5…`). Business data was unchanged.

## Phase 05 additions

- Migrations:
  - `20260921170000_service_pricing_integrity`: paise-precision + currency CHECKs, `services.data_origin`
  - `20260921180000_duration_aware_partner_slot`: D1
- Invariants added:
  - services / variants / add-ons prices are whole paise; currency is `^[A-Z]{3}$`;
  - `partner_slot_policy ∈ {DURATION, FIXED}`; `slot_duration_minutes` 0–10080.
- The quote contract is in `phase-05-pricing-quote.md`.

### Phase 05 closure additions (2026-09-22)

- Quote fingerprint: computed once, in `bookingPricingService.quote`, from the resolver's **normalized** selection plus coupon and address. The booking compares `uid`, `sid`, `sel` (→ `QUOTE_MISMATCH`), `pv` (→ `QUOTE_EXPIRED`), `sv` and `fp` (→ `PRICE_CHANGED`).
- Fail-closed pricing readiness:
  - `pricingReadiness()` in `lib/service-domain.ts` is used by `assertBookable`, list `bookable` and the publish gate (`PRICING_INCOMPLETE`).
  - Report: `scripts/pricing-readiness-report.ts --fail-on-incomplete`.
- Provenance guard reach. Every customer, partner and anonymous service read uses `CUSTOMER_CATALOG_WHERE` / `PARTNER_OPERATIONAL_WHERE`:
  - catalogue, quote, booking
  - AI chat suggestion, AI grounding
  - vision, coverage city page
  - provider search, public profile, partner `/me`
  - public stats, PUBLIC knowledge seed

  The shared `AND` array is frozen. Matching still accepts a fixture id (no data returned).
- Payment observability: `payment_amount_mismatch_attempt_total`.
- Client session and realtime:
  - WebSocket base follows an explicit API origin.
  - A 4401 refreshes at most once per 30 s.
  - Presence-session 401s never refresh the access token (partner web + mobile).
- Migration readiness: `scripts/release/phase05-migration-preflight.ts` (read-only `--pre` / `--post`) and `docs/operations/phase-05-production-migration-runbook.md`.

## Phase 06 additions (2026-09-22)

- Migration `20260922100000_service_requirements` (additive): two tables, 19 constraints, 7 indexes; no data seeded. Applied to local `homigo_db` on 2026-09-22 (owner approval, verified backup `07fb8fd6…`, preflight pre 12/12 / post 33/33).
- One resolver: `lib/service-requirements.ts` (`validateServiceRequirements` in the publish/bookability gate, `resolveServiceRequirements` in the quote, snapshot + three projections).
- Backend-enforced attestation: `REQUIREMENTS_NOT_CONFIRMED`.
- Booking snapshot `requirements.v1` (no internal notes; carries `professionalNeeds` for Phase 11 matching). It is written once and never updated.
- Readiness: `scripts/requirements-readiness-report.ts`. All 31 live services are OWNER_INPUT_REQUIRED; nothing was invented.
- Contract: `phase-06-materials-equipment-requirements.md`.
