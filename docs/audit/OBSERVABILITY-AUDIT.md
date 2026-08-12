# Observability Audit

**Score: 72%** · **HEAD:** `b582ead` · Audit-only

## Summary

Instrumentation and alert rules exist for every phase. The gap is **deployment**: four of the five new-phase dashboards are authored but not loaded by any running Grafana, so four phases have no runtime visibility despite the JSON existing in the repo. This is the specific failure mode of "observability that looks complete on disk."

## Metrics — IMPLEMENTED across all phases

| Phase | Module | Verified |
|---|---|---|
| 0 — Events | `homigo_outbox_publish_total`, `homigo_outbox_processing_duration_seconds` | Emitted in `outbox-processor.ts:79,94,107,116` |
| 1 — ETL | `lib/etl-metrics.ts` — `recordSchedulerMetrics` | Called on every run, success and failure |
| 2 — ETA | `lib/eta-metrics.ts` — label created/failure, collection latency, Google latency, distance buckets, training-ready gauge | Called throughout `eta-intelligence.service.ts` |
| 3 — AI Core | `lib/ai-metrics.ts` | Present |
| 4 — AI Brain | `lib/ai-brain-metrics.ts` | Present |
| 5 — AI Tools | `lib/ai-tools-metrics.ts` — request/success/denied/requires-approval | `initAiToolsMetricsAtZero()` at boot (`index.ts:310`) |

`initAiToolsMetricsAtZero()` is worth calling out: initialising counters at zero prevents the NO-DATA gaps that otherwise make Grafana panels and alerts unreliable before first traffic. Good practice.

## Alert Rules — IMPLEMENTED

`apps/backend/monitoring/rules/homigo-alerts.yml` — distinct metric references per subsystem:

| Subsystem | Distinct metric refs | Assessment |
|---|---:|---|
| `ai_tool` | 6 | Best coverage |
| `homigo_eta` | 5 | Good |
| `outbox` | 3 | Adequate |
| `ai_brain` | 3 | Adequate |
| `homigo_etl` | 2 | Thin |
| `scheduled_job` | 1 | Present — notably, an alert exists for the very backlog that is currently 4.7 days deep |
| `ai_gateway` | 1 | **Too thin** for a component serving 1,626 requests |

## Dashboards — PARTIAL (the main gap)

Authored dashboards for the new phases:

| Dashboard | Location | Mounted by running Grafana? |
|---|---|---|
| `homigo-ai-tools.json` | `_obsstack/dashboards/` **and** `monitoring/grafana/dashboards/` | ✅ **Yes** |
| `homigo-ai-core.json` | `monitoring/grafana/dashboards/` only | ❌ No |
| `homigo-ai-brain.json` | `monitoring/grafana/dashboards/` only | ❌ No |
| `homigo-eta-intelligence.json` | `monitoring/grafana/dashboards/` only | ❌ No |
| `homigo-analytics-pipeline.json` | `monitoring/grafana/dashboards/` only | ❌ No |

Evidence — the running `homigo-grafana` (port 3004) mounts `./dashboards`, i.e. `_obsstack/dashboards/`:

```yaml
volumes:
  - ./grafana/datasources:/etc/grafana/provisioning/datasources:ro
  - ./grafana/dashboards-provider:/etc/grafana/provisioning/dashboards:ro
  - ./dashboards:/var/lib/grafana/dashboards:ro
ports: ["3004:3000"]
```

`_obsstack/dashboards/` contains 19 dashboards, of which only `homigo-ai-tools.json` covers Phases 1–5. **Phases 1, 2, 3 and 4 therefore have zero deployed dashboards.**

## Runtime Verification Performed

| Check | Result |
|---|---|
| Backend `/health` | **200** — `{"status":"ok","services":{"database":"ok","redis":"ok"}}` |
| Login end-to-end | **200 + token** (customer / partner / admin, direct and via Next proxy) |
| Outbox processing | Live: fresh event `PENDING → PUBLISHED` in 1 attempt, <5s |
| Retry storm | Measured before/after: attempt delta **+36/30s → +0/30s** |
| Prometheus | Running (`homigo-prometheus` :9090) |
| Alertmanager | Running (`homigo-am-staging` :9093) |
| Grafana | Running (`homigo-grafana` :3004, `homigo-stage-f-grafana` :3005) |

## Findings

**OBS-1 · Four phases have undeployed dashboards — P1.** Authored ≠ deployed. Mount the correct directory or provision the four JSONs into `_obsstack/dashboards/`.

**OBS-2 · Gateway alert coverage too thin — P2.** One metric for a component handling 1,626 requests, versus six for tools. Gateway incidents (provider outage, breaker open, fallback storm) may go unalerted.

**OBS-3 · Usage/cost metrics have no data source — P1 (see Phase 3).** Even a perfect dashboard cannot show AI spend, because `AiGatewayUsage` is never written.

**OBS-4 · Three Grafana stacks caused a real outage — P2.** The staging stack published Grafana on port 3000, hijacking the backend's port via IPv6 `::1` and breaking all login platform-wide. Fixed in `b582ead` by moving it to 3006. Root cause was observability infrastructure colliding with the application — worth a port-allocation convention (now documented in-file).

**OBS-5 · Grafana anonymous admin — P1.** See `SECURITY-AUDIT.md` SEC-1.

## Not Assessed

- Log aggregation pipeline end-to-end delivery
- Alert notification delivery (Slack/email) — rules exist; delivery not exercised
- Distributed tracing completeness across gateway → tools → services
- Dashboard panel correctness (queries not executed against live Prometheus)

Recorded `NOT_VERIFIED`.

## Verdict

Instrumentation is genuinely good and boot-time zero-initialisation shows maturity. The deduction is that a large share of it is **not visible to an operator today** — undeployed dashboards, one thinly-alerted component, and a metric table with no writer.
