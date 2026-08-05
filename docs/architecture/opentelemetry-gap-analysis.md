# OpenTelemetry Gap Analysis — HOMIGO Backend

**Date:** 2026-08-05  
**Certified RC:** c31f154 (no tracing changes in this remediation)

## Current state

| Component | Path | Status |
|-----------|------|--------|
| W3C traceparent parse/format | `apps/backend/src/lib/tracing.ts` | EXISTING |
| Request trace injection | `request-context.middleware.ts` | EXISTING |
| Request logging | `request-logger.middleware.ts` — `traceId`, `requestId` | EXISTING |
| Event correlationId | `events/core/homigo-event.ts`, `event-context.ts` | EXISTING |
| In-memory span buffer | `tracing.ts` — `getRecentSpans()` | EXISTING |
| Sentry | `lib/observability.ts` | EXISTING |
| OTel SDK export | — | **MISSING** |
| Cloud Trace / Tempo | — | **MISSING** |

## Desired async pipeline correlation

```
HTTP request (traceId A)
  → business service
  → transactional outbox (link: correlationId + aggregateId)
  → outbox processor (child span or linked span B)
  → event consumer (linked span C)
  → external dependency
```

## Gap summary

1. **No exporter** — spans buffered in-process only; lost on Cloud Run instance recycle
2. **No outbox/consumer spans** — event pipeline invisible in distributed trace
3. **Async boundary** — booking event correlationId exists but not linked to W3C trace context across outbox delay
4. **Grafana trace view** — not configured

## Recommended implementation plan (future RC)

| Phase | Work | RC impact |
|-------|------|-----------|
| OTel-1 | Add `@opentelemetry/sdk-node` behind `OTEL_ENABLED=false` default | New RC required |
| OTel-2 | Instrument HTTP + Prisma + Redis | New RC |
| OTel-3 | Propagate trace context into outbox payload metadata | Schema-safe JSON metadata |
| OTel-4 | Consumer extracts parent context from event envelope | New RC |
| OTel-5 | Export to Cloud Trace; Grafana datasource | Infra only |

## Decision for Stage F remediation

**Do NOT implement OTel on c31f154.** Document gap; implement in separately versioned follow-up with own certification cycle.

## Log correlation (near-term, no RC change)

Cloud Logging already receives JSON stdout from Cloud Run. Operator workflow:

1. Grafana panel anomaly at time T
2. Cloud Logging query: `jsonPayload.traceId="<id>"` OR `jsonPayload.correlationId="<id>"`
3. Link template in Grafana dashboard annotation (future)

Certified in remediation evidence as **PARTIAL** — fields exist; Grafana link not yet provisioned.
