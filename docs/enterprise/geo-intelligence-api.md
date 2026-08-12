# HOMIGO Geo-Intelligence API — Core Intelligence Layer

**Date:** 2026-06-20 · Runtime-verified on real data. The unified intelligence layer consumed by
the **Customer app, Partner app, Admin command center, and Grafana**.

> **Status: PASS.** 8 production endpoints live, every response carries **confidence + freshness +
> source + cached**, backed only by real PostgreSQL / BigQuery / Vertex / Weather / Google Maps data.
> Caching (L1+L2), Prometheus telemetry (bounded labels), and RBAC all verified.

---

## Architecture
```
                         ┌───────────────────────── GeoIntelligenceService ─────────────────────────┐
 Customer / Partner /    │  intel() wrapper: L1+L2 cache · telemetry · {confidence,freshness,source} │
 Admin / Grafana ──HTTP──▶  /api/geo-intel/*  (authPlugin + requireRole RBAC)                         │
                         │                                                                            │
                         │  demand-forecast ─▶ BigQuery ML.FORECAST(model_demand_forecast, ARIMA)     │
                         │  surge           ─▶ Postgres zones + Weather API + demand/supply pressure  │
                         │  zone-scoring    ─▶ Postgres zone snapshot (earning/service/risk composite)│
                         │  provider-density─▶ Postgres provider locations ÷ geofence area            │
                         │  revenue-forecast─▶ Postgres realized revenue run-rate (24h+7d blend)      │
                         │  eta             ─▶ BQML model_eta → Google Distance Matrix fallback       │
                         │  fraud           ─▶ BigQuery vw_fake_gps_signals (teleport detection)      │
                         │  exec-kpis       ─▶ Postgres live aggregates                               │
                         └────────────────────────────────────────────────────────────────────────────┘
   Shared `buildZoneSnapshot()` loads geofences + online-provider locations + 24h/active bookings
   ONCE per cache window and is reused by surge/scoring/density → O(zones), not O(providers).
```

Files: `src/services/geo-intelligence.service.ts`, `src/routes/geo-intelligence.ts`,
`src/services/vertex-ai.service.ts`, `src/services/analytics-etl.service.ts`, `analytics/bigquery/*.sql`.

---

## API contracts
Base: `/api/geo-intel` · Auth: Bearer JWT · Envelope: `{ success, data, confidence, freshness, source, cached, generatedAt }`

| Endpoint | Method | RBAC | Params | Source | TTL | Confidence basis |
|----------|--------|------|--------|--------|----:|------------------|
| `/demand-forecast` | GET | ADMIN, VENDOR | `horizon` (1–168h) | bigquery:arima_plus | 300s | inverse mean CI width |
| `/surge` | GET | ADMIN, VENDOR | — | postgres+weather | 120s | weather-data presence |
| `/eta` | GET | any authed | `fromLat,fromLng,toLat,toLng` | bqml→google | 60s | google 0.92 / haversine 0.6 |
| `/zone-scoring` | GET | ADMIN | — | postgres+computed | 180s | heuristic composite 0.82 |
| `/provider-density` | GET | ADMIN | — | postgres | 60s | direct count 0.95 |
| `/revenue-forecast` | GET | ADMIN | — | postgres | 300s | sample-size scaled |
| `/fraud` | GET | ADMIN | `limit` | bigquery:vw_fake_gps_signals | 120s | signal strength 0.95 |
| `/exec-kpis` | GET | ADMIN | — | postgres | 30s | direct aggregation 0.99 |

---

## Runtime evidence (real data, this run)
| Endpoint | Live result | conf | source |
|----------|-------------|-----:|--------|
| demand-forecast | ARIMA points e.g. `2026-06-20 06:00 → 2.02 [1.21,2.84]` | 0.50 | bigquery:arima_plus |
| surge | `NCR Gurugram Polygon supply=1 active=5 → surge ×3 (demand +400%)` | 0.70 | postgres+weather+computed |
| zone-scoring | ranked zones w/ earning/service/risk composites | 0.82 | postgres+computed |
| provider-density | `Delhi CP: 1 provider / 78.5 km² = 0.01/km²` | 0.95 | postgres |
| revenue-forecast | `realized24h ₹2471 → daily ₹2013 / monthly ₹60,390` | 0.54 | postgres |
| eta | `Delhi→Gurugram 55 min / 31.4 km, withTraffic` | 0.92 | google:distance_matrix |
| fraud | `3 suspicious, risk 100 (1465 km/h teleport)` | 0.95 | bigquery:vw_fake_gps_signals |
| exec-kpis | `GMV ₹19,396 · completion 46.3% · 6 online · 172 customers` | 0.99 | postgres |

**Cross-cutting (verified):**
- **Caching:** 2nd `exec-kpis` call returned `cached=true` (L1+L2 via `cacheService.getOrFetch`).
- **RBAC:** VENDOR→`/demand-forecast` 200, VENDOR→`/exec-kpis` 403, VENDOR→`/fraud` 403, no-auth→`/surge` 401, ADMIN→`/exec-kpis` 200.
- **Telemetry:** `geo_intel_requests_total{endpoint}` + `geo_intel_latency_seconds{endpoint}` with **bounded labels** (8 endpoints, seeded to 0 at boot — no NO-DATA, no coordinate-cardinality leak).

---

## Scale design (1M customers / 100k providers / 50 cities)
- All heavy geo math runs over the **geofence set** (tens–hundreds), never per-provider; the shared
  `buildZoneSnapshot()` is computed once per cache window.
- Forecasts/fraud run in **BigQuery** (separates analytics load from the operational DB); ETL is batch.
- Per-endpoint TTLs (30–300s) + L1 micro-cache absorb dashboard/app fan-out; Redis L2 shares cache
  across instances. Telemetry labels are bounded → Prometheus stays cheap at scale.
- Recommended next: precompute zone snapshot on a 30s sampler (already the pattern in `geo-metrics.ts`)
  and a Cloud Scheduler trigger for the ETL.

---

## Consumers (wiring)
- **Customer app:** `/eta` (booking ETA), `/surge` (price transparency).
- **Partner app:** `/demand-forecast`, `/surge`, `/zone-scoring` (best-earning zones), `/eta` (nav).
- **Admin command center:** all admin endpoints power the map layers + KPI ribbon + fraud panel.
- **Grafana:** `geo_intel_*` metrics; KPI/forecast values can be scraped or panel-queried.

---

## Blocked dependencies + exact enablement (honest)
1. **ETA BQML model (`model_eta`)** — needs a realised-travel label (`actual_duration_min` = first-GPS
   dispatch → ARRIVED). The view/table/model-SQL exist; `/eta` already degrades to Google Distance
   Matrix (conf 0.92) until the model is trained. **Enable:** capture dispatch→arrival timing into
   `fact_bookings.actual_duration_min`, run `03_models.sql` model_eta.
2. **Vertex Gemini narrative** — SDK + ADC auth verified, but `gemini-*` returns `NOT_FOUND` for the
   project. **Enable:** turn on Generative AI / accept terms in the Vertex console; set
   `VERTEX_LOCATION`/`VERTEX_MODEL`. (Not required by any endpoint above — numeric AI is independent.)
3. **External-feed features** (crime/accident zones, lane guidance, voice nav) — no data source yet;
   service interfaces + telemetry hooks documented, wire when a provider/feed is selected.
