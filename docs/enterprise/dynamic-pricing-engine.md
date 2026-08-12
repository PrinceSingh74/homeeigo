# HOMIGO Dynamic Pricing Engine (Phase-4 Track 2)

**Date:** 2026-06-20 · Runtime-verified on real data. Extends (does not replace) the
checkout-authoritative `booking-pricing.service`. `tsc` 0 errors.

> **Status: PASS.** Live multiplier stack + **revenue-optimal** price + expected conversion/revenue
> + surge forecast + A/B assignment. All signals real (Google Maps, Weather, Geo-Intelligence).
> Every response carries confidence + freshness. Telemetry + caching + RBAC in place.

---

## Boundary (no rebuild)
`booking-pricing.service` stays the **checkout authority** (base/package/addons/discounts/coupons/
tax). The Dynamic Pricing Engine is a **recommendation layer** — it computes the intelligent
multipliers + the revenue-optimal price; it does not mutate checkout pricing.

## Price formula (all inputs real)
```
subtotal = baseFare + (distanceKm × ₹/km) + (durationMin × ₹/min)         ← Google Maps eta
combined = traffic × weather × demand × scarcity × event   (clamped 1–3)
   traffic   ← Google traffic ETA ÷ free-flow baseline
   weather   ← weatherService.surgeMultiplier (real OpenWeather)
   demand    ← nearest-zone demand/supply pressure (geo-intel surge)
   scarcity  ← nearest-zone provider density (geo-intel provider-density)
   event     ← ops-set PRICING_EVENT_MULTIPLIER (no fabricated event feed)
recommendedPrice = argmax over m∈[1, combined] of  subtotal·m · conversion(m)
   conversion(m) = baseConv · e^(−effElasticity·(m−1))
   baseConv      = realized completed÷created (7d, Postgres)
   effElasticity = ELASTICITY ÷ (demand×scarcity)   ← scarce supply ⇒ inelastic demand
```
The key economics: surge is applied **only up to the revenue-maximizing point**. Scarcity lowers
effective elasticity, so surge is charged when (and only when) the market bears it.

## API (`/api/pricing/*`, authed — customer/partner/admin)
| Endpoint | Returns |
|----------|---------|
| `GET /quote?baseFare&fromLat&fromLng&toLat&toLng` | full breakdown, multipliers, recommendedPrice, optimal{multiplier,price,expectedConversion,expectedRevenue}, context |
| `GET /surge-forecast?lat&lng` | current vs predicted surge, trend, expected duration, confidence |
| `GET /experiment` | sticky A/B variant + price multiplier (deterministic per customer) |

## Runtime evidence (Delhi CP → Gurugram, base ₹499)
```
subtotal ₹834  (base 499 + dist 251 [31.4km×₹8] + time 83 [55min×₹1.5])
raw demand signal ×2.32  (demand ×1.8 — NCR Gurugram +400% pressure, scarcity ×1.29)
RECOMMENDED ₹1543 at ×1.85 → 15% conversion, expected revenue ₹236   (conf 0.90, google traffic)
   vs naive ×2.32 → ₹96 rev   ·   vs flat ×1 → ₹200 rev   → engine beats both
surge-forecast: current ×2.33 → predicted ×2.34 (stable, ~30min), conf 0.45
experiment: variant=control (sticky, deterministic)
```

## Observability / security
- Telemetry: `pricing_quote_total`, `pricing_quote_latency_seconds`,
  `pricing_experiment_exposure_total{experiment,variant}`, `pricing_experiment_conversion_total`,
  `pricing_experiment_revenue` — all seeded to 0 at boot (no NO-DATA).
- Caching: 60s L2 + 5s L1 via `cacheService` (key by route + rounded coords).
- RBAC: authenticated users only; A/B is stateless + sticky (no PII, no schema change).
- Scale: per-quote work is O(zones) via the cached geo-intel snapshots → flat as providers grow.

## A/B analysis (no schema change)
Exposure + conversion + revenue are Prometheus series by `{experiment,variant}`. Revenue/conversion
lift = `rate(pricing_experiment_conversion_total{variant="treatment"}) / exposure` vs control;
`pricing_experiment_revenue` histogram gives per-variant revenue distribution. (Persisted cohort
tables are a future enhancement if long-horizon attribution is needed.)

## Honest notes
- **Special-event multiplier** has no live event feed → defaults to 1.0 with an ops env override
  (`PRICING_EVENT_MULTIPLIER`). Documented hook; not fabricated.
- **Rates/elasticity** are env-configurable (`PRICING_RATE_PER_KM`, `_PER_MIN`, `_ELASTICITY`); tune
  per city. Defaults: ₹8/km, ₹1.5/min, elasticity 1.2.
- Phase-4 tracks 1/3/4/5 (partner live-nav port, customer intelligence, city digital twin, Vertex
  enterprise models) are **not** in this slice — documented for follow-up.
