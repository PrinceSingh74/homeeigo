# PHASE 13 — Metric Inventory

Every metric the Intelligence Operations Center queries, traced from producer to panel and verified
against the live exposition on 2026-09-04.

**Verification method.** The backend was started on `:3010` (the port Prometheus scrapes) against the
isolated `homigo_p39` database, and every one of the 95 panel expressions was executed **through
Grafana's own datasource proxy** — the path a panel actually uses. Result: **95 queries, 0 errors,
93 returning data.** The two empty ones are the unknown-cost counter, which is authoritatively zero.

Live exposition: **314 distinct metric names**.

Status vocabulary: `OPERATIONAL` (producer → scrape → query → panel all verified) ·
`MEASUREMENT_ONLY` (real metric, no alert policy) · `NOT_AVAILABLE` (no source exists; not drawn).

---

## EVENTS

| Metric | Source | Producer | Storage | Query | Dashboard | Freshness | Zero | Error | Test | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| `homigo_consumer_processed_total` | event consumers | `incCounter` per handled event | Prometheus | `rate(...[5m])` | Events, Overview | 10s scrape | measured | NO DATA | ✓ | `OPERATIONAL` |
| `homigo_outbox_publish_total` | outbox publisher | counter | Prometheus | `rate(...[5m])` | Events | 10s | measured | NO DATA | ✓ | `OPERATIONAL` |
| `homigo_consumer_failed_total` | consumers | counter | Prometheus | `sum`, `rate` | Events, Overview | 10s | measured | NO DATA | ✓ | `OPERATIONAL` |
| `homigo_consumer_retry_total` | consumers | counter | Prometheus | `rate` by consumer | Events | 10s | measured | NO DATA | ✓ | `OPERATIONAL` |
| `homigo_consumer_skipped_total` | consumers | counter | Prometheus | `rate` by consumer | Events | 10s | measured | NO DATA | ✓ | `OPERATIONAL` |
| `homigo_consumer_metrics_duration_seconds` | consumer wrapper | histogram | Prometheus | `histogram_quantile` p50/p95/p99 | Events | 10s | measured | NO DATA | ✓ | `OPERATIONAL` |
| `homigo_outbox_pending` | `events/core/retention.ts` sampler | gauge from outbox table | Prometheus | direct | Events, Overview | scrape-time | **authoritative 0** | NO DATA | ✓ | `OPERATIONAL` |
| `homigo_outbox_oldest_pending_age_seconds` | same sampler | gauge, oldest `createdAt` | Prometheus | direct | Events | scrape-time | authoritative 0 | NO DATA | ✓ | `MEASUREMENT_ONLY` |
| `homigo_dlq_unresolved` | same sampler | gauge from dead-letter store | Prometheus | direct | Events, Overview | scrape-time | authoritative 0 | NO DATA | ✓ | `OPERATIONAL` |
| `homigo_dlq_total` | dead-letter writer | counter by consumer/event type | Prometheus | `sum by` | Events | 10s | measured | NO DATA | ✓ | `OPERATIONAL` |
| `homigo_dlq_persist_failed_total` | dead-letter writer | counter | Prometheus | `sum` | Events | 10s | measured | NO DATA | ✓ | `OPERATIONAL` |
| `homigo_event_by_domain_total` | outbox publisher | counter by domain | Prometheus | `sum by (domain)` | Events | 10s | measured | NO DATA | ✓ | `OPERATIONAL` |

**Semantics kept apart.** `events/sec` is `rate(homigo_consumer_processed_total)` — *processing*
throughput, where one event handled by three consumers counts three times. Publication is
`homigo_outbox_publish_total`. Live proof of the distinction: **1.01 published/s vs 3.04 processed/s**
— exactly the 3-consumer fan-out, visible rather than averaged away.

**The DLQ is real.** `homigo_dlq_unresolved = 1` is a genuine parked event in `homigo_p39`, not a
seeded fixture.

---

## AUTOMATION

| Metric | Source | Producer | Query | Dashboard | Zero | Test | Status |
|---|---|---|---|---|---|---|---|
| `homigo_workflow_definitions{status,mode}` | `WorkflowDefinition` | **new** sampler | `sum by (status, mode)` | Automation, Overview | authoritative | ✓ | `OPERATIONAL` |
| `homigo_workflow_definitions_total` | `WorkflowDefinition` | **new** sampler | direct | Automation | authoritative | ✓ | `OPERATIONAL` |
| `homigo_workflow_instances{status}` | `WorkflowInstance` | **new** sampler | `sum by (status)` | Automation, Overview | authoritative | ✓ | `OPERATIONAL` |
| `homigo_workflow_step_runs_total` | `WorkflowStepRun` | **new** sampler | direct | Automation | authoritative | ✓ | `OPERATIONAL` |
| `homigo_workflow_step_retries_total` | `WorkflowStepRun.attempt > 1` | **new** sampler | direct | Automation, Overview | authoritative | ✓ | `OPERATIONAL` |
| `homigo_workflow_instances_running_age_seconds` | oldest RUNNING instance | **new** sampler | direct | Automation | authoritative | ✓ | `MEASUREMENT_ONLY` |
| `homigo_scheduled_jobs_pending` | `events/core/retention.ts` | existing gauge | direct | Automation, Overview | authoritative | ✓ | `OPERATIONAL` |
| `homigo_scheduled_job_lag_seconds` | same | existing gauge | direct | Automation, Overview | authoritative | ✓ | `MEASUREMENT_ONLY` |

**Why new samplers were needed.** The `automation_*` counters were already wired into the engine
(`instance-manager`, `step-executor`, the trigger consumer, shadow evidence) and **none appeared in
the exposition** — a counter that has never incremented has no series, so an Automation dashboard
queried nothing and could not distinguish "no workflow ran" from "nothing is instrumented".

**Executions come from state, not counters.** Instance counts are read from the instance table, so
the number survives a process restart. Retries come from `WorkflowStepRun.attempt > 1`, which is the
durable record of the same fact.

**Distinctions preserved.** A definition is not an execution. LIVE is not SHADOW — live proof:
**LIVE = 0, SHADOW = 25**. WAITING is parked by design and is not a failure. CANCELLED is a decision,
not a failure.

**Stuck jobs: `STUCK_JOB_THRESHOLD_UNSET`.** No canonical threshold exists in this project — searched
the scheduler, maintenance, alert rules and config. Age is exposed
(`homigo_workflow_instances_running_age_seconds`, `homigo_scheduled_job_lag_seconds`); what counts as
too old is a human decision.

---

## AI

| Metric | Producer | Query | Dashboard | Zero | Status |
|---|---|---|---|---|---|
| `homigo_ai_requests_total{role,endpoint}` | gateway, once per logical request | `rate` | AI, Overview | seeded 0 | `OPERATIONAL` |
| `homigo_ai_provider_usage{provider,status}` | gateway, per provider attempt | `rate` | AI | seeded 0 | `OPERATIONAL` |
| `homigo_ai_success_total{role,provider}` | gateway | — | (available) | measured | `OPERATIONAL` |
| `homigo_ai_failures_total{role,reason}` | gateway | `rate`, `sum by (reason)` | AI, Overview | seeded 0 | `OPERATIONAL` |
| `homigo_ai_fallback_total{from,to}` | router | `rate` | AI, Overview | measured | `OPERATIONAL` |
| `homigo_ai_latency` (histogram) | gateway | `histogram_quantile` p50/95/99, by provider | AI, Overview | NO DATA | `OPERATIONAL` |
| `homigo_ai_tokens_total{provider,direction}` | gateway | `rate` by direction | AI | measured | `OPERATIONAL` |
| `homigo_ai_cost` (histogram) | gateway ← pricing table | `rate(_sum)` by provider | AI | measured | `OPERATIONAL` |
| `homigo_ai_daily_cost_usd` | cost service | direct | AI, Overview | measured | `OPERATIONAL` |
| `homigo_ai_cost_unknown_total{provider,role}` | **new** | `sum` | AI, Overview | **authoritative 0** | `OPERATIONAL` |
| `homigo_ai_provider_failures_total{provider,reason}` | router, closed taxonomy | `sum by` | AI | measured | `OPERATIONAL` |
| `homigo_ai_provider_rate_limited_total` / `_quota_exhausted_total` / `_cooldown_total` | router | `rate` by provider | AI | measured | `OPERATIONAL` |
| `homigo_ai_prompt_blocked{category,role}` | prompt firewall | `sum by (category)` | AI | measured | `OPERATIONAL` |
| `homigo_ai_degraded_total{endpoint,reason}` | gateway | `rate by (reason)` | AI | measured | `OPERATIONAL` |
| `homigo_ai_tool_requests_total` / `_failure_total` / `_denied` / `_pending_approvals` | tool executor | `rate`, `sum` | AI | measured | `OPERATIONAL` |
| `homigo_ai_tool_execution_time` (histogram) | tool executor | `histogram_quantile` p95 | AI | NO DATA | `OPERATIONAL` |

**Requests are not attempts.** `homigo_ai_requests_total` counts what the user asked for, once.
`homigo_ai_provider_usage` counts calls made, including fallbacks. Both are shown; they are never
added together, because a request that falls through GROQ → GEMINI → OPENAI is one request and three
attempts.

**Cost is authoritative, and says how complete it is.** Cost comes from the per-provider pricing
table in `aiConfig.pricing`, not an estimate. All four providers are priced, so today's figure is
complete — and `homigo_ai_cost_unknown_total` reports any request excluded for want of pricing.

**Errors are categorised**, not collapsed: failure reason, provider error code (closed taxonomy),
prompt-block category, degraded reason and tool denial are five separate series.

**User feedback: `NOT_AVAILABLE`.** No thumbs-up/down, acceptance or override signal is captured
anywhere in this platform. No panel is drawn. A rate inferred from "the user closed the screen" would
not be feedback, and a panel reading 0 would claim a measurement never taken.

---

## ML

| Metric | Producer | Query | Dashboard | Status |
|---|---|---|---|---|
| `ml_models_total` | BigQuery `model_registry` sampler | direct | ML, Overview | `OPERATIONAL` |
| `ml_models_by_status{status}` | same | `sum by (status)` | ML | `OPERATIONAL` |
| `ml_models_production` | same | direct | ML | `OPERATIONAL` |
| `ml_platform_serviceable` | **now-registered** health sampler | direct | ML, Overview | `OPERATIONAL` |
| `ml_platform_check_state{check}` | same — 4 checks | direct per check | ML, Overview | `OPERATIONAL` |
| `model_inference_total{model}` | BQML inference wrapper | `rate by (model)` | ML | `OPERATIONAL` |
| `model_inference_errors_total{model}` | same | `rate by (model)` | ML | `OPERATIONAL` |

**Registry presence ≠ operational health**, and the board is ordered to say so: serviceability first,
inventory second. Live values: `ml_platform_serviceable = 0`, `etl_pipeline = FAIL`,
`warehouse_freshness = FAIL`, `forecast_horizon = FAIL`, `registry_reconciliation = WARN`, against a
registry reporting 8 models with 4 "production".

**Data freshness** is `CURRENT TIME − newest warehouse observation`, computed in the health service —
not a row's `updatedAt`.

**Last trained: `NOT_AVAILABLE` as a time series.** The warehouse registry holds `created_at` per
model version, but it is a BigQuery table and not a Prometheus series; the ML board reports registry
composition and the governed history is read through `/api/admin/ml/models/:name/versions`.

**Prediction accuracy: `NOT_AVAILABLE`.** Production accuracy needs a prediction paired with the
outcome that later occurred. This platform captures that only for shadow predictions, and no model
serves in production. A panel showing 100%, 0%, or a training score relabelled as accuracy would each
be a fabrication, so none is drawn.

**Drift: `MEASUREMENT_ONLY`.** Freshness and horizon expiry are measured and are the drift signals
this platform supports today. Distribution drift (PSI/KL) has no defined threshold → `ALERT_POLICY_UNSET`.

**Feature health: partial.** Measured per model by the readiness assessment
(`/api/admin/ml/readiness` — row counts, missingness, leakage), which is a point-in-time API result
rather than a time series, so it is referenced rather than charted.

---

## Telemetry health (observability of observability)

| Metric | Query | Meaning |
|---|---|---|
| `up{job="homigo-backend"}` | direct | Whether Prometheus can reach the exporter at all |
| `time() - timestamp(up{...})` | direct | Age of the newest sample — a stale IOC is detectable from the IOC |

Every panel reads NO DATA rather than 0 when the target is down, so a dead exporter cannot look like
a quiet platform.
