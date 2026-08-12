# Observability Hardening

**Generated:** 2026-07-03T10:36:40.616Z

## Stack Status (runtime probes)

| Component | Status | Evidence |
|-----------|--------|----------|
| Prometheus :9090 | UP | HTTP /-/healthy |
| Grafana :3004 | UP | HTTP /api/health |
| /metrics | UP | Backend scrape |
| Sentry | CONFIGURED | All apps + @sentry/bun |

## Alert Coverage

Total alert rules loaded: **55**

| Required Alert | Present |
|----------------|---------|
| EmailCircuitOpen | ✓ |
| PaymentFailureSpike | ✓ |
| WebhookFailureSpike | ✓ |
| RedisDown | ✓ |
| DatabaseDown | ✓ |
| AssignmentQueueFailureHigh | ✓ |

## Per-Surface Coverage

| Surface | Prometheus | Sentry | Grafana | Alerts |
|---------|------------|--------|---------|--------|
| Backend | ✓ /metrics | ✓ | ✓ 18 dashboards | ✓ |
| Admin | ✓ vitals | ✓ | ✓ | partial |
| Customer | ✓ vitals | ✓ | — | — |
| Partner | ✓ nav telemetry | ✓ | ✓ partner-nav | — |
| Mobile | ✓ startup metrics | ✓ native | — | MobileStartup* |

## New Alerts Added (this certification)

- `EmailCircuitOpen` — circuit_breaker_state{breaker="email"} == 2
- `WebSocketFanoutDegraded` — ws message drops
- `AssignmentQueueFailureHigh` — assignment_failed_total

## Email Health Dashboard

`GET /api/admin/observability/email-health` — added for Monitoring HQ integration.
