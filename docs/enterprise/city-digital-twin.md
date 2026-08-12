# HOMIGO City Digital Twin (Phase-4 Track 4)

**Date:** 2026-06-20 · Runtime-verified on real data. An aggregation + simulation layer over the
verified services (geo-intelligence, weather, pricing) — rebuilds nothing. `tsc` 0 errors (backend +
admin), admin `next build` green.

> **Status: PASS.** Live per-city 10-layer twin + a real "what-if" Scenario Engine + AI executive
> insights (each with confidence). 7 cities (Tier-0 Delhi/Gurugram/Noida + Tier-1
> Mumbai/Bangalore/Hyderabad/Pune), unlimited-city architecture. Telemetry + Grafana #16 + admin screen.

---

## API (`/api/digital-twin/*`, ADMIN)
| Endpoint | Returns |
|----------|---------|
| `GET /cities` | supported tiers + live one-line summary per city |
| `GET /:city` | full 10-layer twin (demand/supply/traffic/weather/revenue/eta/pricing/fraud) |
| `GET /:city/insights` | AI executive insights, each with confidence + severity |
| `POST /:city/simulate` | scenario engine — perturb live state, return operational impact |

Service: `src/services/digital-twin.service.ts`. Layers are composed from
`geoIntelligenceService` (surge/density/zone-scoring/fraud/demand/revenue) + `weatherService`,
joined by `zoneId`, filtered by `city`. Cached 45s.

## Runtime evidence (Gurugram, real data)
```
DEMAND now 0 → 1h 2 · 6h 12.2 · 24h 48.7      (BigQuery ARIMA forecast)
SUPPLY online 1 · busy 1 · available 0 · shortageRisk 98
TRAFFIC heavy (80)   PRICING surge ×3→×3   REVENUE projDaily ₹2,041
WEATHER Clouds (mild, impact 20, flood low)   ETA inflation 38%   FRAUD 1 event (risk 100)
cities: Delhi ×1.93 · Gurugram ×3 · Noida ×1.61 · Mumbai/Bangalore/Hyderabad/Pune ×1
```

## Scenario Engine (real economics)
Perturbs the live twin through the actual demand/supply/elasticity relationships:
```
Scenario: rain + providers −20% + demand +60%  (Gurugram)
→ Revenue −20% · ETA +20% · supply-gap · surge shift
```
**Key modeling fix:** revenue is capped by **supply fulfilment** (you only earn from bookings you can
serve). The naive model showed +100%; the corrected model shows **−20%** — cutting providers while
demand surges in rain *loses* revenue because the extra demand can't be fulfilled. Also fixed a
divide-by-near-zero in the revenue insight (was reporting "204000%").

## Observability + dashboards
- Metrics (per city): `digital_twin_demand`, `digital_twin_supply`, `digital_twin_revenue`,
  `digital_twin_eta`, `digital_twin_pricing`, `digital_twin_fraud` (gauges) +
  `digital_twin_scenarios_total{city}` (counter, seeded at boot) + `digital_twin_insights` (hist).
- **Grafana #16 "City Digital Twin"** — demand/supply/revenue/surge/ETA/fraud by city + scenario
  rate. Verified serving (16 dashboards total).

## Admin screen — `/digital-twin` (sidebar "City Digital Twin")
City selector (Tier badges) · 8 live layer cards · Executive Intelligence feed (severity + confidence)
· **Scenario Engine** (demand/provider/traffic sliders + rain/festival toggles → revenue/ETA/supply/
surge impact). Dark enterprise theme, 30s live refresh. `next build` green (6.62 kB).

## Honest notes
- **AQI** — WeatherSnapshot has no AQI (separate OpenWeather air-pollution endpoint); flood risk +
  weather-impact are derived from rain/severity. AQI field present as `null` with a documented hook.
- **Traffic layer** is an ops congestion proxy (demand/supply pressure + weather); live per-road
  traffic is the Google `TrafficLayer` on the Admin Command Center map.
- **WebGL/clustering** — the twin renders aggregate layer cards; the heavy WebGL map is the Command
  Center (Track-2 admin). Per-city map overlay is a future merge.
- Scenario outputs are most meaningful for cities with non-trivial live demand; sparse test data
  yields conservative numbers (correct, not fabricated).
