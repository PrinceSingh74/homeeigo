# Observability Certification

**Date:** 2026-06-14 · **STATUS: PARTIAL.**

## Existing infra (PASS — present, reused)
- `apps/backend/monitoring/`: `prometheus.yml`, `alertmanager.yml`, `grafana/` dashboards, `rules/` (from prior P2 work).
- `src/lib/metrics.ts` + `src/lib/observability.ts` (Sentry) — API/DB/financial metrics + `/metrics` endpoint.
- Existing alerts: financial integrity, payment failures, DB/redis health.

## Gap (this objective's "add")
New Phase 16/17 features are **not yet individually instrumented**: heatmap latency, tracking throughput, ETA latency, WS latency, geofence eval rate. The generic API-latency histogram covers their HTTP routes, but feature-specific gauges/dashboards are not added.

**Verdict: base observability PASS (Prometheus+Grafana+Sentry live); feature-specific metrics/dashboards for maps/tracking/heatmap = PARTIAL.** Recommended: add `metrics.ts` counters in tracking.service.updateLocation, heatmap.service.generate, route-optimization.service.optimize + Grafana panels.
