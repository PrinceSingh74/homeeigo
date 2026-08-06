# ADR-008: Observability Architecture

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-06 |
| **Owner** | SRE / Platform Engineering |
| **Review Date** | 2027-02-06 |
| **Certified RC** | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |

---

## Context

Phase 0 required end-to-end observability of the event platform, booking/partner/payment domains, and infrastructure health. Stage F Steps 17–18 initially certified via temporary Docker obsstack; Stage F remediation deployed a permanent staging platform and re-certified metrics and dashboards.

Production observability is **not deployed**. Staging platform is certified with documented gaps (OpenTelemetry export, log correlation links, Slack delivery).

---

## Problem

Operating a distributed event platform without observability leads to:

1. Undetected outbox backlog growth and consumer failures.
2. Inability to correlate API requests with async event processing.
3. Alert fatigue or silent failures without evaluated Prometheus rules.
4. Engineering-only tooling inaccessible to operations (addressed in `homigo-radar-v1.md` spec — UI deferred).

---

## Decision

Deploy **self-managed Prometheus + Grafana + Alertmanager on GCE VM** for staging, reusing repository monitoring artifacts:

### Architecture (staging certified)

```
homigo-backend-staging (Cloud Run)
  GET /health, /ready, /metrics (OPS Bearer auth)
        ↓
homigo-obs-staging (GCE VM, asia-south1-b)
  Prometheus :9090
  Grafana :3000 (v11.3.0, auth required)
  Alertmanager :9093
        ↓
Dashboard UID: homigo-operations
  42+ alert rules (promtool validated)
```

**Not selected for Phase 0:** Google Managed Prometheus (GMP) + managed Grafana — IAM and collector complexity without existing GMP tooling; no GKE cluster in project.

### Application instrumentation (@ RC `c31f154`)

| Component | Status |
|-----------|--------|
| Prometheus `/metrics` exposition | CERTIFIED |
| Structured JSON logging (traceId, correlationId) | CERTIFIED |
| W3C traceparent parse/format (`tracing.ts`) | EXISTING |
| In-memory span buffer | EXISTING |
| Sentry integration | EXISTS in codebase; not Stage F certified |
| OpenTelemetry SDK export | **NOT IMPLEMENTED** |

### Metric contract

Required `homigo_*` metrics verified in Step 17 permanent scrape proof:
- `homigo_outbox_pending`
- `homigo_outbox_oldest_pending_age_seconds`
- `homigo_dlq_unresolved`
- `homigo_consumer_failed_rate`
- `homigo_scheduled_job_lag_seconds`
- Domain event counters (`homigo_domain_event_total`, payment counters)

### Environment isolation

| Resource | Staging | Production |
|----------|---------|------------|
| Obs VM | `homigo-obs-staging` | Not deployed |
| OPS token | `STAGING_OPS_AUTH_TOKEN` | Separate prod secret required |
| Grafana admin | `STAGING_GRAFANA_ADMIN_PASSWORD` | Future prod secret |

### Known gaps (certified limitations)

1. **OpenTelemetry export** — spans lost on instance recycle (`opentelemetry-gap-analysis.md`).
2. **Grafana ↔ Cloud Logging** — manual traceId query; no Loki datasource.
3. **HOMIGO Radar UI** — specification only (`homigo-radar-v1.md`).
4. **Admin Alert Center bridge** — endpoint exists; Alertmanager not wired on RC `c31f154`.

Historical detail: [adr-001-staging-observability-platform.md](./adr-001-staging-observability-platform.md) (superseded by this ADR for index purposes).

---

## Alternatives Considered

| Alternative | Reason Not Selected |
|-------------|---------------------|
| **GMP + Cloud Monitoring only** | Existing PromQL dashboards and 42 rules in repo; migration cost |
| **Datadog / New Relic SaaS** | Not provisioned in homigo-497619; vendor lock-in |
| **Temporary Docker obsstack (Stage F initial)** | Superseded by permanent GCE VM in remediation |
| **Loki for logs** | Not deployed; Cloud Logging sufficient for Phase 0 |
| **No permanent staging obs** | Stage F Step 17 limitation unacceptable for soak (Stage G) |

---

## Tradeoffs

| Benefit | Cost |
|---------|------|
| Reuses 24 dashboard JSON files + alert rules | VM patching and backup responsibility |
| Permanent scrape URL for soak | Single VM — not HA |
| promtool-validated rules | CPU not exported in /metrics (Cloud Run limitation) |
| Engineering Grafana access | Operations need Radar UI (deferred) |

---

## Consequences

**Positive:**
- Stage F remediation: permanent scrape `up=1`; Step 17 re-cert PASS.
- Stage G: 5-min Prometheus snapshots T0..T_FINAL; observability coverage PASS.
- Counter movement verified after cert activity (publish 301→329).

**Negative:**
- Cloud Run CPU saturation not directly metricized — INCONCLUSIVE by metric, PASS by alert absence.
- 30s raw sampling limited by gcloud context in background collector job.

---

## Evidence References

| Artifact | Location |
|----------|----------|
| Stage F remediation report | `docs/evidence/stage-f-remediation/STAGE-F-REMEDIATION-CERTIFICATION-REPORT.md` |
| Permanent scrape proof | `docs/evidence/stage-f-remediation/permanent-scrape-proof.json` |
| Step 17 permanent pass | `docs/evidence/stage-f-remediation/step-17-permanent-pass.json` |
| Metric contract | `docs/evidence/stage-f-step-17/step-17-metric-contract.json` |
| OTel gap analysis | `docs/architecture/opentelemetry-gap-analysis.md` |
| Stage G observability health | `docs/evidence/stage-g-soak/stage-g-observability-health.json` |
| Cloud inventory | `docs/evidence/stage-f-remediation/cloud-inventory.json` |

---

## Future Evolution

| Item | Phase | Notes |
|------|-------|-------|
| OTel SDK + Cloud Trace export | Post-Phase 0 RC | OTel-1 through OTel-5 plan in gap analysis |
| GMP migration evaluation | Platform | When GKE or managed collectors adopted |
| Loki or Cloud Logging datasource in Grafana | SRE | Automated log correlation |
| HOMIGO Radar UI | Product | `homigo-radar-v1.md` |
| Production obs stack | Pre-prod | Mirror staging pattern or adopt GMP |

---

## Related ADRs

ADR-009 (Alerting Strategy) · ADR-010 (Deployment Strategy) · ADR-011 (Staging Certification)
