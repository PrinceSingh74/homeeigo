# HOMIGO Radar v1 — Product Architecture Specification

**Status:** Specification (implementation deferred)  
**Date:** 2026-08-05  
**Audience:** Operations, support, city ops, leadership, incident coordinators

## Principle

> **RADAR tells operations WHAT is wrong.**  
> **GRAFANA helps engineers determine WHY.**

HOMIGO Radar is **not** Grafana. It is the business-facing operations command surface in the Admin Panel, backed by normalized health APIs — not raw PromQL in the browser.

## Responsibility split

| Concern | HOMIGO Radar (Operations) | Grafana (Engineering) |
|---------|---------------------------|------------------------|
| Audience | Ops, support, leadership | SRE, backend, platform |
| Data access | Backend health APIs | Prometheus datasource |
| Granularity | Domain health (Booking, Partner, Payment, Platform) | Metric-level PromQL |
| Alerts | Inbox with ACK/resolve | Alert annotations + deep dive |
| Maps / live ops | Command Center map, WS feed | Geo/intel dashboards |

## Four health domains

### 1. Booking Health
- **Sources:** `homigo_domain_event_total{event_type=~"booking.*"}`, assignment queue metrics, Command Center booking APIs
- **KPIs:** throughput/min, assignment latency, completion rate, active incidents
- **Existing UI:** `/command-center`, `homigo-command-center.json` (Grafana mirror)

### 2. Partner Health
- **Sources:** partner event rates, online provider counts, ops-map WS, dispatch metrics
- **KPIs:** online providers, dispatch success, ETA/arrival anomalies
- **Existing UI:** Command Center provider layer, `/api/admin/ops-map`

### 3. Payment Health
- **Sources:** `payment_success_total`, `payment_failed_total`, webhook failure alerts
- **KPIs:** success rate, failure rate, webhook health
- **Alerts:** `homigo_payments` rule group

### 4. Platform Health
- **Sources:** `homigo_outbox_pending`, `homigo_dlq_unresolved`, consumer failure rates, scheduled job lag
- **KPIs:** outbox backlog, DLQ count, consumer errors, job lag
- **Alerts:** `homigo_events` rule group (Stage F certified)

## Visual model

```
            BOOKINGS ●
                |
PARTNERS ● ── HOMIGO ◎ ── ● PAYMENTS
                |
             EVENTS ●
                |
         SCHEDULED JOBS ●
```

**Colors:** GREEN healthy | AMBER degraded | RED critical | GRAY no telemetry

Node click → status, KPIs, active alerts, duration, recommended action, deep links:
- Open in Grafana (`homigo-operations` dashboard)
- Open logs (Cloud Logging query by `traceId`/`correlationId`)
- Open incident / Alert Center entry

## Normalized API contract (Radar backend)

Browser MUST NOT query Prometheus directly.

```json
{
  "domain": "PLATFORM",
  "status": "DEGRADED",
  "environment": "staging",
  "kpis": {
    "outboxPending": 0,
    "dlqUnresolved": 0,
    "consumerFailureRatePerMin": 0.2,
    "scheduledJobLagSeconds": 68400
  },
  "activeAlerts": [
    {
      "name": "ScheduledJobLagHigh",
      "severity": "warning",
      "startedAt": "2026-08-05T06:34:12Z",
      "summary": "Scheduled automation jobs lagging more than 1 hour"
    }
  ],
  "deepLinks": {
    "grafana": "/d/homigo-operations",
    "logs": "cloudlogging query template",
    "alertCenter": "/alerts"
  }
}
```

## Reuse map (do not duplicate)

| Radar feature | Reuse |
|---------------|-------|
| Live ops map | `apps/admin-panel/.../command-center/page.tsx` |
| Alert inbox | `/alerts` (WS) + `/observability/alerts` (DB) |
| Health APIs | Extend `observabilityService.getHealthDashboard()` |
| Metrics source | Permanent Prometheus → future `/api/admin/observability/radar` aggregator |

## Implementation phases (post-spec)

1. **Radar v0:** Platform health only from existing observability health API
2. **Radar v1:** Four domains + alert inbox unification
3. **Radar v2:** Animated sweep UI + region drill-down

**This remediation task delivers the specification only.** Visual product build requires separate authorization.

## Known telemetry gaps

| Gap | Classification |
|-----|----------------|
| Scheduled job execution engine | `MISSING_TELEMETRY` / Phase 6 — jobs created, not executed |
| Per-booking assignment latency histogram | PARTIAL — use assignment queue + events |
| Partner online count as Prometheus gauge | PARTIAL — Command Center API, not yet `homigo_*` gauge |
