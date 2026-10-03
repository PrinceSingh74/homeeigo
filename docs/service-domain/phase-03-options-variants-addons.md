# Phase 03 — Options, variants, add-ons

Status: **PASS** (2026-09-21).

## Model (existing, extended; no parallel model)

| Concept | Implementation |
|---|---|
| Variant | `catalog_config.variants[]` + `service_variants` rows (existing). Fields: code, name, price, duration, audiences, inclusions, exclusions, requirements, quantity override, sort order, active. 1 BHK / Basic / Women etc. are **data**, never code. |
| Variant required | `catalog_config.variantRequired` (**new**). When variants exist, one must be chosen: `VARIANT_REQUIRED`, no silent base-price fallback. No default variant is invented; the customer page preselects only when a service has exactly one variant. |
| Add-on | `catalog_config.addons[]` + `service_addons` rows (existing). Fields: code, name, price, duration, compatibility, active. |
| Add-on units | `maxQuantity` (**new**, 1–100; unset = exactly one). This finally gives `quantity_allowed` a consumer. |
| Dependencies | `requiresAddonIds`, `conflictsWithAddonIds` (**new**). Conflicts are symmetric. Admin validation rejects unknown references, self references, circular requirement chains, and an add-on whose transitive requirements conflict. |
| Compatibility | `compatibleVariantIds` (existing, now also editable in the admin UI). |

**Option groups (SINGLE / MULTI / …):** not added as a generic model. The catalogue's selection groups are already typed: variant (single), audience (single), add-ons (multi), quantity. A generic option-group engine would duplicate them and has no data that needs it. This is the rule-engine the brief warns against.

**Relational rows carry the new fields.** Migration `20260921160000_service_addon_dependencies` adds `max_quantity`, `requires_addon_codes` and `conflicts_with_addon_codes`, plus range, self-dependency and positive-duration CHECKs. This matters because hydrate lets the rows win over the JSON; a field the table could not hold would have been silently dropped at quote time.

**Sync integrity fixed:**
- Row sync now runs inside the service write transaction and no longer swallows errors.
- Row ids are hashes of (service, code), which removes the prefix-collision risk.
- `loadRelationalCatalog` throws on real DB errors; only a missing table falls back to JSON.

## One resolver

`resolveServiceSelection()` in `lib/service-catalog-config.ts` is the only implementation. Quote, booking, the public resolve endpoint and the admin preview all call it. It returns:

- `issues[]`: **every** problem found, each `{ code, field, id?, message }`. Codes:
  - `VARIANT_REQUIRED`, `VARIANT_UNAVAILABLE`, `INVALID_VARIANT`
  - `ADDON_UNKNOWN`, `ADDON_DUPLICATE`, `ADDON_INCOMPATIBLE`, `ADDON_CONFLICT`, `ADDON_REQUIRES`, `ADDON_QUANTITY`
  - `QUANTITY_*`, `INVALID_AUDIENCE`, `INVALID_PREFERENCE`, `INVALID_PACKAGE_PRICE`, `INVALID_SELECTION`
- `normalized`: ids in catalogue order; no client prices accepted.
- `addonAvailability`: available / incompatible / conflict for every offered add-on under the current selection.
- priced lines, the snapshot and the duration (Phase 04).

`resolveSelection()` remains as the first-error *view* with the exact legacy `{ ok, error }` shape, so existing callers and error codes are unchanged. Each specific code maps to one legacy family (e.g. `ADDON_CONFLICT` → `INVALID_ADDON`).

**Contract tightening (intentional):** a repeated add-on id is now `ADDON_DUPLICATE` instead of being silently de-duplicated. Every client builds `addonIds` from a Set (mobile de-duplicates explicitly), so only a tampered request can repeat an id.

## API

- `POST /api/services/:id/resolve-selection` (public, read-only, not cached).
  - Body: variantId, quantity, audience, addonIds (≤ 20), addonQuantities, packagePrice, serviceVersion.
  - Returns issues, availability, price lines *before tax*, and duration.
  - `404` when the service is not customer-visible; `409 SERVICE_NOT_BOOKABLE` / `SERVICE_VERSION_CHANGED`.
- `POST /api/bookings/price-quote` and `POST /api/bookings` accept `addonQuantities` and `serviceVersion`.
  - A selection error keeps its legacy `code` and adds `issues[]`.
  - A stale version is `409 SERVICE_VERSION_CHANGED` with `currentVersion`.
- `bookings.addons` keeps the historical `{ id, name, price }` shape for single units. Multi-unit add-ons add `quantity` and `unitPrice`, and `price` stays the line total, so every existing sum (partner earnings cards, admin, invoices) remains correct.

## Customer UX

The web detail page renders the server's verdict:
- **Price:** the booking summary uses `pricing.subtotal`. The client estimate is only a fallback while the server has not answered.
- **Add-ons:** unavailable ones are disabled with the reason. An add-on that becomes unavailable while selected stays selected with a warning; it is never removed silently.
- **Variants:** a variant that stops fitting (e.g. the audience changed) is kept and explained, not swapped for another.
- **Issues:** multiple issues are listed together.

The add-on names and prices shown come from the server. Which shared add-ons a service offers stays the catalogue's curation, verified in the browser (Fridge Cleaning does not offer the fridge add-on).

## Admin UX

- Variants: add, edit and reorder by list order; activate/deactivate; a "customers must choose a variant" toggle.
- Add-ons: compatibility, requires, conflicts and max units per row.
- Validation (duplicate codes, orphan compatibility, circular dependencies) comes back as `400 INVALID_CONFIG` with the failing path.

## Partner projection

`job` on `/me/bookings` and `/bookings/:id` (partner branch) comes from `partnerJobBrief(serviceSelection, addons, estimatedDuration)`. It contains the variant name, audience label, quantity + unit, add-on names × units and the duration. There are no prices or configuration. It reads the booking's immutable snapshot, never the live catalogue, and a test proves a later admin edit does not change a booked selection. Rendered on partner web (`JobBrief`) and partner mobile ("What was booked" card).

## Tests

- `service-selection-resolver.test.ts` (32): valid, invalid, missing-required and disabled variants; compatible and incompatible add-ons; duplicates; conflicts; requires; units; all-issues reporting; availability; normalization; admin dependency validation.
- `service-domain-foundation.integration.test.ts`:
  - the admin save writes dependency rows;
  - resolve-selection over HTTP;
  - **frontend bypass**: quote and booking with an incompatible add-on, a missing variant or an absurd quantity are rejected;
  - a stale version is refused;
  - booking snapshot immutability;
  - the partner brief.
- Reintroduction proof P3: disabling the compatibility check fails 4 tests (2 unit + 2 HTTP bypass), and restoring passes.
