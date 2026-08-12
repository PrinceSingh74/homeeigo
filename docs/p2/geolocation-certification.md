# Phase 16 — Geolocation Engine (incremental, on existing stack)

**Approach:** the spec's PostGIS + 9 new geo models (`UserLocation`, `SavedAddress`, `Geofence`, `ServiceZone`, …) **duplicate** HOMIGO's existing `Address` / `Location` / `LocationHistory` and require a heavy `CREATE EXTENSION postgis` migration. Per the agreed decision (**keep Float + haversine**) and RULE #1/#2 (no duplicate location systems), Phase 16 is built on the existing schema + a server-side Google proxy. No PostGIS, no duplicate tables.

## Increment 1 — Google Maps proxy + customer nearby-providers ✅ DONE

**Files:** `src/services/maps.service.ts`, `src/routes/geo.ts`, registered in `index.ts`.

**`mapsService` (key stays server-side, never shipped to client):**
- `reverseGeocode(lat,lng)` · `geocode(address)` · `autocomplete(input)` · `placeDetails(placeId)` — Google Geocoding/Places, **Redis-cached** (24 h / 7 d) to cap cost.
- `eta(from,to)` — Distance Matrix (traffic-aware) with **haversine fallback** (always returns a value).
- `isWithinIndia(lat,lng)` — national bounding-box guard.
- **Graceful degradation:** with no `GOOGLE_MAPS_API_KEY`, geocoding/autocomplete return `null`/`[]` (UI shows manual entry — **no fake data**, per the coming-soon convention); ETA still works via haversine.

**Routes (`/api/geo`, auth-gated + per-user rate-limited on Google-cost endpoints):**
- `GET /config` → `{ mapsConfigured }` (UI decides autocomplete vs manual)
- `GET /reverse?lat=&lng=` · `GET /autocomplete?q=` · `GET /place/:placeId` · `GET /eta?fromLat=…`
- `POST /nearby-providers { serviceId, latitude, longitude }` → **reuses the certified `matchingService.findBestProviders`** (distance + rating + availability + membership), no duplicate matching.

## Execution evidence
| Check | Result |
|---|---|
| `isConfigured` (no key) | `false` ✅ |
| `isWithinIndia(19.07,72.87)` / `(40.7,-74)` | `true` / `false` ✅ |
| ETA fallback (Mumbai pts) | `{etaMinutes:9, distanceKm:3.6, source:"haversine"}` ✅ |
| reverseGeocode / autocomplete (no key) | `null` / `[]` — no fake data ✅ |
| Routes live | `/config` 200, `/eta` & `/nearby` 401 (auth-gated) ✅ |
| **`POST /nearby-providers` (live, real token)** | **HTTP 200, 2 providers; top = Rahul Sharma 8.5 km, 20 min ETA, 4.8★** ✅ |

TypeScript build: ✅ clean. Backend live (`--watch` reload).

## To activate live geocoding/autocomplete
Add `GOOGLE_MAPS_API_KEY=…` to `apps/backend/.env` (enable Geocoding API, Places API, Distance Matrix API; restrict to server IP). ETA + nearby already work without it (haversine + matching). **Do not paste the key in chat.**

## Remaining Phase 16 increments (planned)
- **16.2** Wire geo into the web address-entry / booking UI (autocomplete dropdown, "use current location" via browser GPS → reverse-geocode, ETA on provider cards).
- **16.3** Geofencing — lightweight **Float/haversine circular zones** (new `Geofence` + `GeofenceEvent` models, NO PostGIS) with entry/exit detection.
- **16.4** Demand/supply heatmap — Float-grid aggregation over `Location`/`LocationHistory` + bookings (no materialized view), admin analytics.

**Verdict (increment 1): customer geolocation API PRODUCTION-READY on the existing stack; live Google features pending the API key.**
