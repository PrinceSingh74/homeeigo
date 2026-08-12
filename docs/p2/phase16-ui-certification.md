# Phase 16.2 — Geolocation UI Wiring Certification

**Date:** 2026-06-13 · **App:** `apps/web`. Pure frontend wiring over the **already-certified** 16.1 endpoints. **No new backend systems, no duplicate matching/location logic, Google key never client-side** (all calls go through the backend proxy).

## Deliverables (all built + type-safe)

**API client (`coreApi.geo`, `src/services/core/api.ts`):** `config`, `autocomplete`, `reverse`, `place`, `eta`, `nearbyProviders` — typed wrappers over `/api/geo/*`. Exports `GeoPrediction`, `GeoAddress`, `NearbyProvider`.

**Hooks:**
- `use-geo-autocomplete.ts` — 300 ms debounce, min-3-char, React-Query cached; exposes `available` so the UI falls back to manual entry when Google is unconfigured.
- `use-current-location.ts` — browser GPS → backend reverse-geocode; explicit `denied / timeout / unavailable / out_of_area / failed` states (never fakes a fix).
- `use-nearby-providers.ts` — reuses `/api/geo/nearby-providers`; sorts **ETA → distance → rating**.

**Components:**
- `geo/AddressSearchInput.tsx` — debounced autocomplete, keyboard nav (↑/↓/Enter/Esc), click-outside close, loading/empty/unavailable states, resolves coords via `/place` on select.
- `geo/CurrentLocationButton.tsx` — GPS button with accuracy display + retry + every failure mode.
- `geo/ProviderETA.tsx` — provider cards (name, ⭐ rating, distance, ETA, availability), loading/error/empty states.

**Live integration:** wired into `profile/AddAddressModal.tsx` — which previously hardcoded `lat 19.076, lng 72.8777`. Now address search + "use current location" pin **real coordinates**; manual entry remains a fallback. This modal is used by the existing `SavedAddresses` (FEATURE 4 reused, not duplicated).

**Test:** `e2e/geolocation-ui.spec.ts` — 7 Playwright tests exercising config / ETA-fallback / reverse(+out-of-area 400) / autocomplete / nearby-providers(+out-of-area 400) through an authenticated session.

## RULE / certification status (honest)
- **TypeScript clean:** ✅ `tsc --noEmit` (web) — 0 errors in the new/changed files.
- **No duplicate systems:** ✅ reuses `Address` model (`coreApi.users.*Address`), `matchingService` (via `/nearby-providers`), `maps.service`; existing `SavedAddresses` component reused.
- **Google key never client-side:** ✅ every geo call hits the backend proxy.
- **Backend endpoints (the chain these screens drive):** ✅ execution-verified — live `POST /api/geo/nearby-providers` → 200, top match Rahul Sharma 8.5 km / 20 min / 4.8★ (see `geolocation-certification.md`); `maps.service` unit checks (India bounds, haversine ETA, null-on-no-key).
- **Playwright spec:** ✅ **compiles & lists 7 tests** (`playwright test --list`). ⏳ **Full run pending the E2E harness** against a **test DB** — not executed here to avoid registering test users into the live `homigo_db` (no fabricated pass).

## Success criteria
A customer can: search an address (autocomplete) · use GPS location · view nearby providers · see ETA — all through existing backend logic, **zero duplicate systems**. Booking-page mount of `ProviderETA` (pre-booking pro list) is the natural next wiring step (FEATURE 5 deepening).

**Verdict: 16.2 UI implemented, type-safe, live in the address flow, backed by certified endpoints. Playwright run pending test-DB harness.**
