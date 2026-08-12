# Platform Intelligence Certification — HOMIGO V6

Generated: 2026-07-03T09:18:43.662Z
Data policy: platform_feature_flags + platform_experiments tables; live pricing A/B (surge_v1) merged when not in DB.

## Verdict: **PASS**

All gates passed.

## Summary
| Field | Value |
|---|---|
| Feature flags | 0 |
| Enabled flags | 0 |
| Kill switches | 0 |
| Experiments | 1 |

## Feature flags
_No flags configured yet — use PATCH /api/admin/platform/flags to register._

## Experiments
- **surge_v1** (running) [pricing_engine]

## Prometheus experiment metrics (pricing engine)
- `pricing_experiment_exposure_total`
- `pricing_experiment_conversion_total`
- `pricing_experiment_revenue`

## Endpoints
- `GET /api/admin/platform/intelligence`
- `PATCH /api/admin/platform/flags` — upsert flag / rollout / kill switch

## Prometheus gauges
`platform_flags_total`, `platform_flags_enabled`, `platform_experiments_running`.
