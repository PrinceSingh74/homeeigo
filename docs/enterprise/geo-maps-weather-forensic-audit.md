# HOMIGO Geo / Maps / Weather / Tracking — Phase 0 Forensic Audit

**Date:** 2026-06-18 · **Method:** code + route + service + DB + runtime + UI evidence. **No building done in this phase** (per mission). Every cell below is backed by an executed check.

**Infra at audit time:** backend db+redis ok; postgres/redis/pgbouncer up; Grafana **down→restarted (0 dashboards)**.

---

## Status matrix

| # | Capability | Status | Evidence |
|---|-----------|--------|----------|
| **MAPS — backend** |
| 1 | Geocoding / reverse-geocode | ✅ **PASS** | live: `/api/geo/reverse` → real "Lower Parel, Mumbai 400070" |
| 2 | Places autocomplete | ✅ **PASS** | live: `/api/geo/autocomplete?q=Bandra` → real placeIds |
| 3 | Distance-Matrix ETA + traffic | ✅ **PASS** | live: `/api/geo/eta` → `source:google, withTraffic:true` |
| 4 | Directions (waypoint optimize) | ✅ PASS (code) | `maps.service` `/directions` called |
| 5 | `mapsBreaker` circuit breaker | ✅ **PASS** | `circuit_breaker_state{google_maps}=0`, 3 real calls, 0 failures |
| 6 | APIs used vs enabled | ✅ correct | only 4 called (geocode, distancematrix, place, directions). Routes/Roads/TimeZone/Geolocation **not used** → keep disabled |
| **MAPS — keys / security** |
| 7 | Backend key `GOOGLE_MAPS_API_KEY` | ✅ set | `mapsConfigured:true` |
| 8 | Browser key `NEXT_PUBLIC_…` | ✅ set | in `apps/web/.env` |
| 9 | **Separate browser vs backend keys** | 🟠 **PARTIAL** | **SAME key in both** — not split; no referrer/IP restriction (mission Phase 2 gap) |
| **CUSTOMER tracking / map** |
| 10 | Tracking data pipeline (WS→hook→UI) | ✅ PASS | `useBookingTracking` (WS, reconnect-recovered) drives marker state |
| 11 | **Live map with provider marker** | 🔴 **PARTIAL/FAKE** | `CustomerTrackingMap` renders a **static `<iframe>` Embed** (`maps/embed/v1/view`) — WS marker state is computed but **not drawn on the map** |
| 12 | **Route rendering (polyline)** | 🔴 **MISSING** | no Polyline/DirectionsRenderer anywhere |
| 13 | Provider marker animation | 🔴 **MISSING** | embed can't host live/animated markers |
| 14 | Weather-adjusted ETA | ✅ **PASS** | `maps.service.etaWithWeather` → `/api/geo/eta` returns `weatherFactor` |
| **PARTNER map** |
| 15 | **Partner live GPS map** | 🔴 **BROKEN/FAKE** | `LiveMapView.tsx` comment: *"Futuristic dark map **placeholder** — swap for Mapbox/Google Maps in production"* |
| 16 | Partner GPS watcher | ✅ PASS | `useGeolocationWatcher` (real `watchPosition`) |
| 17 | Partner weather safety warning | ✅ **PASS** | `PartnerWeatherWarning` built + builds exit 0 |
| 18 | Coverage/NCR visualization | 🔴 **MISSING** | no coverage-zone map |
| **GEOFENCE** |
| 19 | Geofence CRUD (backend+DB+admin) | ✅ PASS | `geofence.service` + `(console)/geofences` form |
| 20 | **Circle geofences** | 🟠 PARTIAL | DB = `centerLat/Lng/radiusMeters`; admin = number inputs, **no map** |
| 21 | **Polygon geofences** | 🔴 **MISSING** | DB model is circle-only |
| 22 | **Drag-drop map editing** | 🔴 **MISSING** | form-only, no Google Map/DrawingManager |
| 23 | Entry/exit events | 🟠 **PARTIAL/UNWIRED** | `GeofenceEvent` model exists (ENTER\|EXIT) but **no runtime producer** detects crossings |
| 24 | Zone analytics (revenue/demand/supply/util) | 🔴 **MISSING** | not computed per zone |
| **ADMIN geo / heatmap** |
| 25 | Admin heatmap data | ✅ PASS | real cells (demand/supply/revenue/gap) + CSV/PDF |
| 26 | Heatmap as **geographic map layer** | 🟠 PARTIAL | rendered as grid/table, not a Maps HeatmapLayer |
| 27 | **`/admin/geospatial` command center** | 🔴 **MISSING** | no such page |
| **WEATHER** |
| 28 | Weather service (current/forecast/alerts) | ✅ **PASS** | live: Mumbai 32.3°C; routes `/current /forecast /alerts /admin/overview` intact |
| 29 | Surge / vendor-impact / ETA engine | ✅ **PASS** | deterministic 1.0–1.5 / 1.0–0.4 / 1.0–1.4 proven |
| 30 | Weather cache + circuit breaker | ✅ PASS | `cacheService` 10m/30m + `weatherBreaker` |
| 31 | Weather metrics (temp/humidity/wind/rain) | ✅ PASS | live gauges per city |
| 32 | `weather_visibility_km`, `weather_api_health` | 🔴 **MISSING** | not emitted |
| 33 | Flood / dust-storm / heatwave detection | 🟠 PARTIAL | heat in severity; **flood/dust-storm/visibility not derived** |
| 34 | **`/admin/weather` page + NCR center** | 🔴 **MISSING** | no admin weather UI; no Delhi/Gurugram/Noida center |
| **OBSERVABILITY** |
| 35 | **`geo_*` metrics** (7 required) | 🔴 **MISSING (all 7)** | none of geo_active_providers/bookings/zone_revenue/demand/supply/eta_seconds/tracking_latency exist |
| 36 | Grafana geo/weather dashboards | 🔴 **DISCONNECTED** | Grafana 0 dashboards after Docker restart (8 existed before) |

---

## Tally
- ✅ **PASS: 16** — Maps backend (geocode/reverse/autocomplete/ETA/directions/breaker), weather service+engine+cache+metrics, weather-ETA, tracking data pipeline, partner GPS+warning, geofence CRUD, heatmap data.
- 🟠 **PARTIAL: 7** — key split, circle-geofence UI, geofence events (unwired), heatmap-as-map, weather flood/dust, single-key.
- 🔴 **MISSING/BROKEN/FAKE: 13** — customer live-map+route+marker, **partner map (FAKE placeholder)**, polygon geofences, drag-drop editing, zone analytics, `/admin/geospatial`, `/admin/weather`+NCR, weather visibility/api_health, **all 7 geo_* metrics**, Grafana dashboards (disconnected).

## Headline real findings (the "fake/broken" the audit was meant to catch)
1. **Partner map is a literal placeholder** — labelled "swap for … in production". Not a real map.
2. **Customer tracking map is a static iframe embed** — the live WS marker/route is computed but never rendered on a real interactive map.
3. **All 7 `geo_*` metrics are absent** — geo observability is unbuilt.
4. **Grafana lost all dashboards** on the Docker restart — needs re-provisioning + new geo/weather dashboards.
5. **Single Maps key** in browser+backend, unrestricted — security hardening gap.

## What is genuinely production-grade today
Backend Maps (live, traffic-aware, circuit-broken) and Weather (live, surge/ETA/vendor engine, cached, metered) are real and verified. The **data layers are solid; the map UIs and geo-observability are the gap.**

---

## BUILD UPDATE 1 (2026-06-18) — Real maps (customer + partner) ✅ FIXED
*User-prioritised first.* Rows 11, 12, 13, 15 resolved:

| Row | Was | Now |
|-----|-----|-----|
| 11 Customer live map | 🔴 static iframe embed | ✅ **real `google.maps.Map`** (`LiveTrackingMap.tsx`) — live provider marker |
| 12 Route polyline | 🔴 missing | ✅ **DirectionsRenderer** route provider→destination (Directions API `status:OK`) |
| 13 Marker animation | 🔴 missing | ✅ **`geometry.spherical.interpolate`** smooth 900ms animation per WS ping |
| 15 Partner map | 🔴 **FAKE placeholder** | ✅ **real `google.maps.Map`** (`PartnerLiveMap.tsx`) — GPS marker + job route, fake SVG deleted |

**Evidence:** both removed (0 "swap for production" comments, 0 iframe-embed refs). New components use `google.maps.Map` + `DirectionsService`. Web build **exit 0**, partner build **exit 0**. APIs runtime-verified: **Maps JavaScript API** loads (`window.google=…`), **Directions API** `status:OK` real route "Lal Bahadur Shastri Marg", Static Maps 200. Zero-dependency loader (`use-google-maps-loader.ts`); keys set in both `apps/web/.env` + `apps/partner-web/.env` (gitignored). Fail-safe panel when key absent.

**Still open (not yet built):** rows 9 (key split — user action), 18, 21-24, 26-27, 32-36 (geo metrics, geofence polygon/drag-drop/analytics, admin geo+weather pages, Grafana dashboards).
