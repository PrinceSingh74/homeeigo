# Service pricing rules

Source of truth: `apps/backend/src/lib/service-catalog-config.ts` (`resolveSelection`) called from `bookingPricingService.quote`. Relational `service_variants` / `service_addons` rows hydrate into that function when present; empty tables fall back to `catalog_config` JSON.

## Models (existing `Service.pricingModel`)

`fixed` | `hourly` | `per-unit` | `per-seat` | `area` | `package` | `inspection` | `quote`

## What the client may send

`serviceId`, `variantId`, `quantity`, `packagePrice` (tier amount only), `audience`, `addonIds`, `couponCode`, location.

Not accepted: `finalAmount`, unit prices, tax, duration, commission.

## Resolution

1. Service must be bookable (active, not coming soon, not paused).
2. Variant must exist and be `active`. Variant + `packagePrice` together is `INVALID_SELECTION`.
3. Audience must be in the variant’s or service’s audience list when audiences are configured.
4. Quantity must be an integer in `[min, max]` on the configured step. Type `NONE` behaves like “no quantity rule”.
5. Hourly duration scales with hours. Other quantity types use `durationPerUnitMin` when set. Otherwise operational slot time is `catalogConfig.duration.totalSlotMin` if configured, else `estimatedDuration`.
6. Package price must equal one of `{minPrice, basePrice, maxPrice}`.
7. Add-ons come from the service’s own catalogue if present, else the shared `BOOKING_ADDONS` fallback. Unknown, inactive, or variant-incompatible ids are `INVALID_ADDON`.
8. Membership, coupon, weather surge, and 10% tax are applied **after** the catalogue line — still server-side, still the existing payment/pricing services.

## Tests

- `apps/backend/src/__tests__/service-catalog-config.test.ts`
- `apps/backend/src/__tests__/service-domain.test.ts`
- `apps/backend/src/__tests__/service-domain-concurrency.test.ts`
- `apps/backend/src/__tests__/service-selection-booking.test.ts`
