# Observability Audit

**Generated:** 2026-07-03T09:56:49.523Z

| Component | Status | Evidence |
|-----------|--------|----------|
| Prometheus /metrics | UP | 615 metric lines |
| Prometheus server :9090 | UP | HTTP probe |
| Grafana :3004 | UP | HTTP probe |
| Sentry | CONFIGURED | All apps |
| Alert rules | PRESENT | monitoring/rules/*.yml |
| Grafana dashboards | 18 JSON files | _obsstack/dashboards/ |

## Gaps



- Email alerts likely degraded (email not configured)

_Observability coverage: 100%_
