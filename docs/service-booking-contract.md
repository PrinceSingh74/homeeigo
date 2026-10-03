# Service booking contract

## Quote

`POST /api/bookings/price-quote`

Success: server breakdown (`selection`, add-ons, surge, discounts, tax, `finalAmount`).

Failure codes include: `SERVICE_NOT_BOOKABLE`, `SERVICE_NOT_AVAILABLE`, `INVALID_VARIANT`, `INVALID_QUANTITY`, `INVALID_ADDON`, `INVALID_AUDIENCE`, `INVALID_PACKAGE_PRICE`, `UPGRADE_REQUIRED`.

## Create

`POST /api/bookings`

Re-runs the same quote. Persists:

- `service_selection` — priced selection (existing)
- `addons` — priced add-on snapshot (existing)
- `service_config_version` — catalogue version
- `service_config_snapshot` — inclusions, material/equipment policy, duration, variant/quantity identity
- `estimated_duration` — selection duration (operational minutes), not a client field
- `service_config_snapshot.requirements` (Phase 06, `requirements.v1`) — the resolved materials, equipment and preconditions of this selection, which ones the customer confirmed, and the service version. Written once; partner and customer booking views read it, never the live service.

Historical rows remain readable if the live `services` row later changes.

## Availability (existing engine + optional service rules)

Always: future slot, overlap exclusion, provider working window when a provider is chosen.

If configured on the service:

- `availability.minimumLeadTimeMinutes`
- `availability.maximumAdvanceDays` (cannot exceed the global 30-day cap)
- `availability.sameDay === false` or explicit `sameDayAvailable === false` rejects same-calendar-day
- `availability.blackoutDates` (`YYYY-MM-DD`)

If `availableCities` or `coverage.cityIds` / `pincodes` are set, the booking address must match. Empty lists mean unspecified (not “nowhere”).

## Matching

Existing `service-match.ts` filters remain. If `providerRequirements.requiredSkills` is set, candidates must have **all** of those values in `provider.serviceCategories`.

## Requirements (Phase 06)

- `POST /api/bookings/price-quote` returns `quote.requirements`, the customer view of this selection: `weBring`, `youProvide`, `shared`, `beforeArrival`, `beforeBooking`, `optional`, `empty`.
- `POST /api/bookings` accepts `requirementAttestations: string[]`. Every `beforeBooking` code must be present, otherwise **400 `REQUIREMENTS_NOT_CONFIRMED`** with `requirements:[{code,label}]` and the quote. The backend enforces this; the checkbox is UX only.
- An invalid or conflicting requirement configuration refuses the quote: `REQUIREMENTS_CONFIG_INVALID` / `REQUIREMENT_CONFLICT`.
- A service with no requirements books exactly as before. Details: `service-domain/phase-06-materials-equipment-requirements.md`.
