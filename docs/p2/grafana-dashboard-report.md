# HOMIGO — Grafana Dashboard Report

**Date:** 2026-06-17 · `monitoring/grafana/dashboards/` (provisioned).

## Dashboards
| UID | Title | Panels | Status |
|---|---|---|---|
| `homigo-command-center` | Enterprise Command Center | 20 (5 sections) | NEW · JSON validated |
| `homigo-features` | Feature Observability (Maps/Tracking/Finance/Geofence) | 7 | runtime-validated 7/7 (Grafana v13 + Prometheus, earlier) |
| `homigo-observability` | Platform Observability | — | existing |

## Command Center — sections & panels (all consume real metric names)
**1 · CEO** — payments today (`payment_success_total`), active bookings (`booking_created/completed/cancelled`), payment-success-rate gauge, provider-acceptance gauge (`provider_acceptance_rate`), booking lifecycle rate timeseries.
**2 · Operations** — dispatch attempts/success/timeout (`dispatch_*`), dispatch-failure-% stat, tracking updates vs throttled (`homigo_feature_events_total{feature=tracking}`).
**3 · Financial** — integrity-score gauge (`financial_integrity_score`, green@100), payment success/failed/refund, wallet deduction/refund.
**4 · Technology** — API p95/p99 (`http_request_duration_seconds`), error-rate stat (5xx), DB connections (`db_connections_active/idle`), Redis up/hit-rate, Google Maps calls vs failures (`google_api_*`), RSS/heap.
**5 · Security** — failed logins (`http_requests_total{route=/api/auth/login,status=401}`), RBAC denials (admin 403), rate-limit 429s.

## Validation
- JSON parsed OK (uid `homigo-command-center`, 20 panels, 5 rows).
- All referenced metrics confirmed live in `/metrics` (see observability-audit.md).
- PromQL uses `histogram_quantile`, `rate`, `increase`, `clamp_min` — standard Grafana/Prometheus.

## Gap
- Command-center not re-rendered in a live Grafana this cycle (the features dashboard was, 7/7). Recommend provisioning into the deployed Grafana + adding SLO burn-rate panels.

**Status:** PASS (built + validated); live-render PARTIAL.
