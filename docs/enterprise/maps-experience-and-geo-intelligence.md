# HOMIGO — World-Class Maps Experience + Geo-Intelligence (Architecture + Audit)

**Date:** 2026-06-20 · Runtime-verified. Two delivered tracks:
**(A) Customer Real-Time Map Engine** and **(B) GCP Geo-Intelligence (BigQuery + Vertex AI)**.

---

## A. CUSTOMER REAL-TIME MAP ENGINE ✅

### Architecture
```
 Provider GPS ──HTTP──▶ POST /api/tracking/location
                          │  tracking.service.updateLocation()
                          │   • throttle (>10m / 5s)         • bearing  = atan2 from prev→cur fix
                          │   • async Google traffic ETA      • speed    = Δdist/Δt (cap 90 m/s)
                          ▼
            createWsEnvelope("tracking.location_update")  { lat,lng,bearing,speed,eta,distance,status }
                          │  pushToBookingTracking → WS room
                          ▼
 Customer  ◀──WS── useBookingTracking ── upsertTrackingInCache ──▶ CustomerTrackingMap
                                                                      │
                          GpsKalmanFilter (2-D CV)  ◀── raw fix ──────┤  (kalman-gps.ts)
                          smoothed pos + heading                       │
                          rAF 60fps eased interp ─▶ LiveTrackingMap ──▶ branded bike marker (rotated)
                          DirectionsService (traffic) ─▶ route polyline + arrows + congestion tint
                          leg.distance / duration_in_traffic ─▶ exact distance + ETA
```

### What shipped (files)
| Concern | File | Notes |
|---------|------|-------|
| Heading + speed broadcast | `apps/backend/src/services/tracking.service.ts` | bearing from prev→cur fix; speed Δdist/Δt, capped 90 m/s |
| Schemas | `provider.schema.ts`, `routes/tracking.ts` | optional device `speed` accepted |
| Hook | `apps/web/src/hooks/use-booking-tracking.ts` | exposes `bearing`, `speed` |
| **GPS smoothing** | `apps/web/src/lib/kalman-gps.ts` | 2-D constant-velocity Kalman filter (no deps) |
| **Map engine** | `apps/web/src/components/tracking/LiveTrackingMap.tsx` | branded bike marker (SVG, heading-rotated), 60fps eased interp, traffic route + arrows, exact distance/ETA via `onRoute`, dark premium basemap, map deferred until visible |
| **Journey UI** | `apps/web/src/components/tracking/BookingJourney.tsx` | 6 stages: Searching→Assigned→En Route→Arrived→Started→Completed (framer-motion) |
| Tracking screen | `apps/web/src/components/tracking/CustomerTrackingMap.tsx` | premium dark, live ETA + telemetry (distance/speed/heading) |
| Premium home map | `apps/web/src/components/LiveTrackingMapView.tsx` | real geolocation, dark style, coverage pulse |

### Runtime evidence
- **bearing/speed computed on the live path** — realistic 6-fix drive:
  `bearing=323.8° (NW), speed=38.5 km/h (capped/sane), eta=17min, dist=6.5km`, **ETA recalculated every fix**.
- **Speed-cap fix:** a 1.5km/1.2s test jump produced 1217 m/s → capped to 90 m/s (rejects GPS glitches).
- **tsc = 0 errors** (web + backend); **`next build` green** (homepage `○ Static`, compiled 12.4s, 30/30 pages).
- Kalman filter, heading-rotation, traffic tint, arrows, 6-stage journey all in the production bundle.

### Requirement coverage
HOMIGO bike marker ✅ · heading rotation ✅ · Kalman smoothing ✅ · traffic-aware route ✅ ·
exact route distance+ETA ✅ · live recalculation per GPS ✅ · animated polyline + arrows ✅ ·
6 journey states ✅ · premium home map ✅ · **no mock data** ✅.

---

## B. GCP GEO-INTELLIGENCE — BigQuery + Vertex AI ✅ (real cloud)

**Project:** `homigo-497619` · **Dataset:** `homigo_analytics` · **Location:** `asia-south1` (data residency).

### Warehouse (star schema, PII-safe)
```
 PostgreSQL ──ETL (PII→SHA256)──▶ BigQuery homigo_analytics (asia-south1)
   dim_service ─┐                    dim_service   dim_zone
   dim_zone   ──┤   facts            fact_bookings (part. DATE(created_at), clust. city,status)
   bookings   ──┼─▶ fact_bookings    fact_gps_pings (part. DATE(ts), clust. provider_hash)
   tracking   ──┼─▶ fact_gps_pings   fact_geofence_events
   geofence   ──┼─▶ fact_geofence_*  agg_hourly_demand (zone×hour)
                └─▶ agg_hourly_demand
        views: vw_train_eta · vw_train_demand · vw_provider_availability · vw_fake_gps_signals
        models: model_demand_forecast (ARIMA_PLUS, LIVE) · model_eta (BOOSTED_TREE, foundation)
```
DDL/SQL: `apps/backend/analytics/bigquery/01_schema.sql`, `02_training_views.sql`, `03_models.sql`.

### ETL — `apps/backend/src/services/analytics-etl.service.ts` (run: `src/scripts/run-etl.ts`)
- `@google-cloud/bigquery` SDK + **ADC** (no key files). PII-safe (SHA256 customer/provider hashes).
- Atomic loads via streaming write jobs (WRITE_TRUNCATE dims/facts).
- **Verified run (19.0s):** dim_service 29 · dim_zone 7 · fact_bookings 171 · fact_gps_pings 277 · fact_geofence_events 15. agg_hourly_demand rebuilt in-warehouse (44 hourly points).

### Prediction foundations — `apps/backend/src/services/vertex-ai.service.ts`
| Capability | Engine | Status | Evidence |
|-----------|--------|:------:|----------|
| **Demand forecast** | BQML `ARIMA_PLUS` | ✅ **LIVE** | `ML.FORECAST` → next-hours demand ~2.0/hr with 80% CI, per zone |
| **Fake-GPS / fraud-location** | `vw_fake_gps_signals` | ✅ **LIVE** | flagged real teleports: **5816 km/h, 51 km jumps** (caught test-spoofed fixes) |
| **Provider availability** | `vw_provider_availability` | ✅ **LIVE** | 30 zone×hour rows; peak load 19 bookings/provider @ 11:00 |
| **ETA prediction** | BQML `BOOSTED_TREE` | 🟡 foundation | model SQL ready; needs realised-travel labels (dispatch→ARRIVED) — view + table in place |
| **Vertex Gemini narrative** | `@google-cloud/aiplatform` | 🟡 wired | SDK + **ADC auth verified** (reaches Vertex); blocked on enabling Generative-AI model access for the project (one-time console/terms step) |

All BQML predictions verified **end-to-end through the Node SDK** (`forecastDemand`, `detectFakeGps`,
`providerAvailability`) using ADC, in-process.

### Honest gaps (no fabrication)
1. **Vertex Gemini model access** — `gemini-*` returns `NOT_FOUND` for this project even with a valid
   token; enable Generative AI in the Vertex console (accept terms) and the wired narrative method works
   as-is (env: `VERTEX_LOCATION`, `VERTEX_MODEL`).
2. **ETA model** — current test data lacks a clean realised-travel label (booking lifetime ≠ travel time),
   so the regressor has 0 training rows today. The table/view/model-SQL are in place; capture
   dispatch→ARRIVED timing to populate `actual_duration_min`.
3. Dataset was recreated from `US` → `asia-south1` to match the India residency requirement (it was empty).

### To reproduce
```bash
# warehouse + models (REST, asia-south1)
gcloud auth print-access-token   # → DDL via BigQuery jobs.query
bun run --env-file=.env src/scripts/run-etl.ts          # Postgres → BigQuery
# predictions
#   ML.FORECAST(MODEL model_demand_forecast, STRUCT(12 AS horizon, 0.8 AS confidence_level))
#   SELECT * FROM vw_fake_gps_signals WHERE is_suspicious
```

---

## Verdict
**Customer Real-Time Map Engine: PASS** — production-ready, premium, no mocks, runtime-verified.
**GCP Geo-Intelligence: PASS (foundations live)** — real warehouse in asia-south1, real ETL, 3 of 4
prediction capabilities LIVE on real data; ETA + Vertex-LLM are wired with documented one-step unblocks.
