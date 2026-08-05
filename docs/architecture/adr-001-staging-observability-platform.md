# ADR-001: Staging Observability Platform Architecture

**Status:** Accepted  
**Date:** 2026-08-05  
**Context:** Stage F Steps 17–18 certified metrics/alerts via temporary Docker stack. No permanent hosted Prometheus/Grafana exists in GCP.

## Decision

Deploy **Option B (variant): Self-managed Prometheus + Grafana + Alertmanager** on a dedicated **GCE VM** in `asia-south1`, reusing existing `apps/backend/monitoring/` artifacts.

**Not selected:** Option A (GMP + managed Grafana) for initial staging deployment because:
- Cloud Run `/metrics` requires authenticated HTTPS scrape with bearer token — works with Prometheus but GMP collector setup adds IAM complexity without existing GMP tooling in repo
- No GKE cluster exists in project; GMP pod monitoring not applicable
- Repository already has production-ready Prom/Grafana/AM configs and 24 dashboard JSON files
- GCE + Docker matches `_obsstack` pattern; lowest migration risk from Stage F cert stack

**Future path:** Evaluate GMP migration when GKE or managed collectors are adopted.

## Architecture

```
homigo-backend-staging (Cloud Run)
  GET /metrics (OPS Bearer)
        ↓
homigo-obs-staging (GCE e2-small, asia-south1)
  Prometheus :9090 (persistent disk)
  Grafana :3000 (auth required, no anonymous admin)
  Alertmanager :9093 (staging receivers only)
        ↓
Grafana folder: HOMIGO Engineering / Staging
  UID homigo-operations (evolved from homigo-observability)
        ↓
Alertmanager → STAGING Slack webhook (Secret Manager)
            → (future) Admin Alert Center dedicated webhook endpoint
```

## Environment isolation

| Resource | Staging | Production |
|----------|---------|------------|
| VM / stack | `homigo-obs-staging` | Not deployed |
| OPS token secret | `STAGING_OPS_AUTH_TOKEN` | Separate prod secret |
| Grafana admin | `STAGING_GRAFANA_ADMIN_PASSWORD` | Future prod secret |
| Slack webhook | `STAGING_SLACK_WEBHOOK_URL` | Future prod secret |
| Alertmanager config | `alertmanager-staging.yml` | Future prod file |
| Dashboard folder | HOMIGO Engineering / Staging | Future prod folder |

## Consequences

**Positive:** Reuses 42+18 alert rules, existing dashboards, promtool validation; permanent URL; persistent TSDB; Stage F re-cert without temp Docker.

**Negative:** VM ops burden (patching, backups); not fully managed HA; Alertmanager → Admin `/evaluate` endpoint requires admin auth (bridge gap on certified RC c31f154).

## Related gaps (not resolved by this ADR)

1. Scheduled job **execution engine** deferred to Phase 6 — lag metric reflects real backlog
2. Admin Alert Center webhook requires dedicated token-gated endpoint (future RC)
3. Full OpenTelemetry export not in scope for c31f154
