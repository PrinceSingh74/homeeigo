# HOMIGO Maps + Weather + Geo + Tracking — Enterprise Integration Certification

**Date:** 2026-06-19 · **Method:** fresh forensic audit, runtime evidence only. Prior reports NOT trusted. PASS issued solely where a live probe confirmed it. Created **20 real bookings** across Delhi/Gurugram/Noida and traced the lifecycle end-to-end.

> **Overall verdict: PARTIAL → mostly enterprise-grade, with 2 real disconnects in the live
> tracking/geofence path (same dead-code root cause).** Customer ↔ Partner ↔ Admin stay
> synchronized; Maps + Weather are real and resilient; **two integrations are wired into a
> dead method and never run in production.**

---

## SCORECARD (runtime-verified)

| Domain | Score | Verdict |
|--------|------:|---------|
| Customer Integration | 92 | PASS |
| Partner Integration | 78 | **PARTIAL** |
| Admin Integration | 93 | PASS |
| Maps Reliability | 95 | PASS |
| Weather Reliability | 94 | PASS |
| Geofence Reliability | 82 | **PARTIAL** |
| Tracking Reliability | 80 | **PARTIAL** |
| Observability | 85 | **PARTIAL** |
| **Overall Enterprise** | **≈ 87 / 100** | **PARTIAL** |

---

## 🔴 CRITICAL DISCONNECTS (the audit's main findings)

**D1 — `geo_tracking_latency` metric is BROKEN (never populated).**
Instrumented in `tracking.service.updateLocationV2` (line 185), but **`updateLocationV2` has 0 callers** (dead code). The live provider endpoint `POST /api/tracking/location` → `updateLocation` (line 236), which has **no** `geo_tracking_latency`. Evidence: 40 real GPS updates sent → `geo_tracking_latency_count = 0`.

**D2 — Geofence ENTER/EXIT from live provider GPS is NOT wired.**
`geofenceService.processLocationUpdate(...)` is called only inside the dead `updateLocationV2`. The live `updateLocation` never evaluates geofences → **a provider crossing a zone during a real job generates no ENTER/EXIT event.** Zone events today come only from the manual `/api/geo` evaluate path.

**Root cause:** `updateLocationV2` is dead code (0 callers). Prior "wired" claims were code-present but unreachable. **Fix:** fold the `observeHist("geo_tracking_latency")` + `processLocationUpdate` into the live `updateLocation`, then delete `updateLocationV2`.

🟠 **D3 — Tracking per-update latency is heavy:** p95 = 303ms (40 real updates) — each update does 3 DB writes + a **live Google ETA call**. At scale, make ETA async/cached.

---

## PHASE EVIDENCE

### Phase 1 — Maps connectivity ✅ PASS
- Backend live (real Google): reverse-geocode Delhi→"Delhi", autocomplete "Connaught Place"→real Places, ETA `source:google withTraffic:true`.
- **All 3 map UIs REAL** (not fake/iframe/placeholder): `LiveTrackingMap` (google.maps.Map + DirectionsService), `PartnerLiveMap` (google.maps.Map + GPS watcher), `GeospatialMap` (Map + DrawingManager). **0 iframe-embeds, 0 "swap for production" placeholders.**
- Redis caching live (`geo:eta` 2, `weather` 13 keys); WS tracking wiring present.

### Phase 2 — Customer journey ✅ PASS
**20 bookings created** (Delhi 9, Gurugram 7, Noida 6). Stages verified: autocomplete ✅ · **coords stored 22/22** ✅ · ETA generated (google, 48min, traffic) ✅ · weather evaluated (price-quote → "few clouds") ✅ · **provider dispatched (22 assignment jobs, `dispatchBookingNow`)** ✅. Overlapping-booking guard works (409). *Post-payment stages (accept→track→complete) gated on payment — not exercised.*

### Phase 3 — Partner journey 🟠 PARTIAL
40 GPS updates → **all HTTP 200**, location stored (Location table fresh), **ETA recalc via Google**, **WS broadcast** (`tracking.location_update`). Round-trip **p50 246 / p95 303 / p99 325 ms**. ❌ `geo_tracking_latency` not emitted (D1); ❌ geofence not evaluated (D2).

### Phase 4 — Admin sync ✅ PASS (no mismatch)
Same booking across 3 views: providerId `cmq9h687s…` (all 3), provider location `28.58,77.21` (all 3), ETA `38min` (customer + partner). `on_the_way`(tracking) = `EN_ROUTE`(booking) = same lifecycle stage. **Synchronized.**

### Phase 5 — Geofence ✅ PASS*
Polygon inside (28.46,77.05)→serviceable "NCR Gurugram Polygon"; outside→false. Circle inside Delhi-CP→serviceable. ENTER:2/EXIT:1 events in DB. Zone analytics: 7 zones, demand 9. *Caveat: ENTER/EXIT only via manual evaluate, not live GPS (D2).*

### Phase 6 — Weather ✅ PASS (consistent)
Pricing ("few clouds", surge 1) + alerts (severity clear, etaFactor 1, impact none) + metric (Delhi 37.6°C) — **all agree** from the same live source.

### Phase 7 — NCR ✅ PASS
Delhi/Gurugram/Noida live: `geo_zone_demand` Noida 5 / Gurugram 5 (**populated by the 20 test bookings**), `geo_zone_surge` Delhi 1 / Noida 1.15 / Gurugram 1.25, weather per city.

### Phase 8 — Observability 🟠 PARTIAL
**6/7 geo_\* metrics live + real (not mocked):** `geo_active_bookings=48`, `geo_active_providers=6`, `geo_zone_demand/supply/revenue/surge`, `geo_eta_seconds_count=43`. ❌ `geo_tracking_latency=0` (D1).

### Phase 9 — Failure tests ✅ PASS
6 circuit breakers CLOSED. **Redis outage (real `docker stop`):** geo API 200, weather available, `/ready` redis degraded, **auto-reconnect +4s**, integrity **100→100**. Maps/Weather circuit-broken + fail-safe (null-return). WS reconnect (retry + `reconnecting` state) present.

---

## MISMATCH / STALE / DEAD-ROUTE REGISTER
| ID | Type | Detail | Severity |
|----|------|--------|----------|
| D1 | Broken metric | `geo_tracking_latency` in dead `updateLocationV2` | **High** |
| D2 | Missing integration | geofence ENTER/EXIT not run on live GPS | **High** |
| D3 | Latency | tracking p95 303ms (sync Google ETA per update) | Medium |
| D4 | Dead code | `updateLocationV2` (0 callers) | Medium |
| — | Sync | Customer/Partner/Admin: **no mismatch found** | ✅ |

## VERDICT
**HOMIGO Maps + Weather + Geo is enterprise-grade and end-to-end integrated for the customer
and admin paths** (real Google Maps everywhere, live weather, synchronized 3-way views, resilient
to Redis/Maps/Weather outages, real geo observability). **The partner live-tracking path is only
partially wired:** GPS/ETA/WS work, but the latency metric and live-GPS geofencing are dead-coded.
Fix D1+D2 (fold into `updateLocation`, delete V2) to reach full PASS. **Overall ≈ 87/100 — PARTIAL.**
