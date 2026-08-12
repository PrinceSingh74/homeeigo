# Google Maps Enterprise Audit

**Date:** 2026-06-14 · **STATUS: PARTIAL — BLOCKED on API key.**

## Integration code (audited, present)
| API | Code | Status |
|---|---|---|
| Geocoding (reverse/forward) | `maps.service.reverseGeocode/geocode` | ✅ implemented |
| Places Autocomplete | `maps.service.autocomplete` | ✅ |
| Place Details | `maps.service.placeDetails` | ✅ |
| Distance Matrix (traffic ETA) | `maps.service.eta` (`departure_time=now`) | ✅ |
| Directions (waypoint optimize) | `maps.service.optimizeWaypoints` (`optimize:true`) | ✅ |
| Maps JS / embed (client) | `CustomerTrackingMap` iframe (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) | ✅ |

## Security (verified)
- **No key in source** (`grep AIza/sk_live/rzp_live` → none). Server key read only in `maps.service` (server-side); never shipped to client.
- Client uses a **separate** `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (map embed only) — must be **referrer-restricted** in GCP.
- All Google calls **proxied server-side**, **Redis-cached** (geo 24h / place 7d / eta 2m) and **per-user rate-limited** (cost control).

## Fallback (verified live, no key)
`isConfigured=false` · reverseGeocode→null · autocomplete→[] · **ETA→haversine** · route-opt→nearest-neighbour. No fake data.

## Activation checklist (operator action — key not provided)
1. Set `GOOGLE_MAPS_API_KEY` (backend `.env`) + `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (web/admin).
2. Enable: Geocoding, Places, Distance Matrix, Directions, Maps JS API.
3. Restrict backend key by **server IP**; restrict client key by **HTTP referrer**.
4. Set per-API **quota caps** + **billing budget alerts** in GCP.
5. Re-run `maps.service` execution checks → expect `source:"google"` ETAs + non-null geocode.

**Cannot certify live Google PASS without the key.** Code + security + fallback = PASS; live activation = BLOCKED.
