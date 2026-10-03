# Service configuration guide

Admin path: **Admin panel → Services**. The editor is a 25-section builder (Identity through Operations). Completion marks come from the backend (`configSections`). Activate stays disabled while `publishBlocked` is non-empty.

Variants and add-ons are saved as `catalogConfig` JSON and dual-written to `service_variants` / `service_addons`. Quote/book hydrate those rows into `resolveSelection` — there is no second price engine.

## Rules

1. Customers never send prices. The server prices from this configuration.
2. Package tiers are the exact `minPrice` / `basePrice` / `maxPrice` values. Values between tiers are rejected.
3. Inactive variants and add-ons are hidden from customers and rejected if selected.
4. Add-on `compatibleVariantIds`, if set, must reference variants on the same service.
5. “Coming soon” keeps the SKU visible and sets `isBookable=false`. Quotes return `SERVICE_NOT_BOOKABLE`.
6. Professional gender preference is not offered (`PROFESSIONAL_PREFERENCE_SUPPORTED = false`).
7. Do not fill materials, equipment, certifications, or trust badges unless operations has confirmed them. Unset policy is shown as unconfirmed — never as “we provide everything”.
8. Required provider skills, if set, are an additional matching AND-filter. Empty means existing category/slug matching only.
9. Reviews shown to customers are aggregates of real `ratings` rows. Empty catalogue → no fabricated stars.

## Capability profiles

Profiles (`GENERAL`, `CLEANING`, `BEAUTY`, `REPAIR`, …) decide **advisory** required fields in admin. They do not invent data. Blocking activation still only requires a price, a duration, and a quantity rule when the pricing model needs one.

## Capability that is not implemented as a second engine

Lead time, blackout dates, and max advance days are **optional** `catalogConfig.availability` rules consumed by the existing `booking-validation.service`. Partner working hours, slot exclusion, and capacity remain the availability engine.
