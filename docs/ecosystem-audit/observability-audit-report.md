# Observability Audit Report

**Audit date:** 2026-06-10

---

## Live Endpoints

| Endpoint | Result |
|----------|--------|
| `GET /health` | ✅ 200 — db ok, redis ok |
| `GET /ready` | ✅ 200 — db 78ms, redis 103ms, memory healthy |
| `GET /metrics` | ✅ exists (Prometheus format) — not scraped live |
| `GET /api/v1/status` | ✅ endpoint catalog |

---

## Logs

| Source | Status |
|--------|--------|
| Structured app logs (`app_log_entries`) | ✅ INSERT observed during finance smoke |
| Activity logs | ✅ account lifecycle + finance ops |
| Enterprise audit logs | ✅ finance smoke triggers writes |
| Request tracing | `trace_id` fields in schema — not live-traced |

**Centralized log aggregation (ELK/Loki):** NOT DEPLOYED — admin `/observability/logs` API exists, UI page built.

---

## Metrics

| Check | Result |
|-------|--------|
| HTTP metrics middleware | code present (`metrics.middleware.ts`) |
| Financial metrics | `financial-metrics.ts` |
| Grafana coverage script | **100%** (9/9 metrics dashboarded + alerted) |
| Live Prometheus scrape | ❌ Prometheus container not running |

---

## Alerts

| Check | Result |
|-------|--------|
| `homigo-alerts.yml` rules | HighErrorRate, RedisDown, PaymentFailureSpike, etc. |
| Alertmanager routing | slack + email + pager + escalation flags true in config |
| `p2:alerts` script | **9/9 required alerts covered** |
| Alert firing (synthetic) | ❌ NOT EXECUTED |

---

## Tracing

- OpenTelemetry/tracing lib: `apps/backend/src/lib/tracing.ts`
- Sentry: `observability.ts` — DSN-dependent
- `p2:sentry` script exists — **NOT RUN** in this audit

---

## Dashboards

- `monitoring/grafana/dashboards/homigo-observability.json` — panels for HTTP rate, 5xx, Redis up
- **Grafana instance:** NOT RUNNING in audit environment

---

## Domain-Specific Alerts (config)

| Domain | Alerted (config) | Fired (live) |
|--------|-----------------|--------------|
| Financial integrity | ✅ | ❌ |
| Booking failures | ✅ rules exist | ❌ |
| Refund spikes | ✅ | ❌ |
| Payment failures | ✅ PaymentFailureSpike | ❌ |
| Redis down | ✅ | ❌ |

---

## Issues

### ISSUE-OBS-001 — Monitoring stack not live
- **Severity:** HIGH (for production)
- **Impact:** No real-time incident detection despite config completeness
- **Fix:** Deploy Prometheus + Grafana + Alertmanager per `monitoring/` configs
- **Confidence:** HIGH

### ISSUE-OBS-002 — Sentry synthetic not run
- **Severity:** LOW
- **Fix:** `bun run p2:sentry` with DSN
- **Confidence:** HIGH

---

## Observability Score: 68/100

Instrumentation and config are mature; runtime observability stack not operational in audit env.
