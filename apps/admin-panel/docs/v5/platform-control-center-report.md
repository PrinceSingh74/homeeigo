# Platform Control Center Report — HOMIGO V5

**Scope:** Phase 4 — internal platform tooling. Real-data only.

## Implemented (real data, wired in `PlatformHqDashboard`)

| Feature | Backend source | Status |
|---|---|---|
| Your role | `GET /api/admin/rbac/me` → `role` | ✅ live |
| Your permissions | `rbac/me` → `permissions[]` | ✅ live |
| Roles registry | `GET /api/admin/rbac/roles` | ✅ live |
| Admin users | `GET /api/admin/rbac/admins` | ✅ live |
| Reports & exports | finance reports/exports, invoices export, membership export, observability log CSV | ✅ available |

## Missing backend → proposed APIs

| Feature | Why missing | Proposed API | Integration path |
|---|---|---|---|
| **Feature Flags (registry, enable/disable, rollout %)** | No flag model or service | `GET/POST/PATCH /api/admin/flags` → `{ key, enabled, rolloutPct, environment }` + `GET /api/flags/eval?key=` | Add `FeatureFlag` model (migration, additive); server-side eval with % bucketing by userId hash; client SDK reads `/api/flags/eval` |
| **A/B Experiments (beyond pricing surge_v1) + results** | Only `surge_v1` assignment; results are Prometheus counters | `GET /api/admin/experiments` + `GET /api/admin/experiments/:key/results` | Generalize `dynamic-pricing` A/B into an `Experiment` model; expose exposure/conversion/revenue from `pricing_experiment_*` counters as JSON |
| **Conversion Impact** | Counters exist, no REST readout | included in experiment results API | Read `pricing_experiment_conversion_total` / `_exposure_total` per variant |
| **Release Timeline / Deployment History** | No deployment records in DB | `GET /api/admin/releases` | Emit a `Deployment` row from CI/CD (git sha, env, timestamp, actor); or ingest from GitHub deployments API |
| **Rollback Center** | Rollback exists only as recovery scripts | `POST /api/admin/releases/:id/rollback` (guarded) | Wrap existing recovery/rollback scripts behind an audited admin action |

## Note on existing A/B capability
`GET /api/pricing/experiment` returns a real `surge_v1` variant assignment, and Prometheus tracks `pricing_experiment_exposure_total`, `pricing_experiment_conversion_total`, `pricing_experiment_revenue`. The Experiment Center can be built on this foundation without new infra — it needs a REST results endpoint + a registry model.

## Runtime evidence
Type-check clean; `PlatformHqDashboard` code-split on `/hq/platform`; RBAC queries `retry:false` so missing-permission environments degrade gracefully to `DataUnavailable`.
