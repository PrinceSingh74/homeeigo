# PHASE 13 — Final Metric Audit

Every metric traced **producer → boot registration → emission → scrape → datasource → query → panel**
on 2026-09-04. Nothing below is carried forward from the previous Phase-13 report; each row was
re-established in this pass.

**Method.** Backend on `:3010` against `homigo_p39`. Emission read from the live `/metrics`
exposition (314 distinct names). Scrape confirmed from the Prometheus targets API. Every query
executed **through Grafana's datasource proxy** — 95 queries, 0 errors.

**Boot registration was audited exhaustively**, not spot-checked: a script enumerated every module
exporting `register*Sampler*` or `init*MetricsAtZero` and checked the boot path calls it. **24 of 24
registered**; `registerScrapeSampler` is the primitive itself, called 17 times.

Legend — `EMITS`: `SEEDED` (series exists at zero traffic) · `ON_USE` (series appears on first real
observation) · `SAMPLED` (gauge written each scrape).

---

## EVENTS

| ID | Metric | Producer | Boot | Emits | Scraped | Panel | Freshness | Zero | Error | Test | E2E | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| E1 | `homigo_consumer_processed_total` | consumers | ✓ | SEEDED | ✓ | Events, Overview | 10s | measured | NO DATA | ✓ | ✓ | `OPERATIONAL` |
| E2 | `homigo_outbox_publish_total` | outbox publisher | ✓ | ON_USE | ✓ | Events | 10s | measured | NO DATA | ✓ | ✓ | `OPERATIONAL` |
| E3 | `homigo_consumer_failed_total` | consumers | ✓ | SEEDED | ✓ | Events, Overview | 10s | measured | NO DATA | ✓ | ✓ | `OPERATIONAL` |
| E4 | `homigo_consumer_retry_total` | consumers | ✓ | ON_USE | ✓ | Events | 10s | measured | NO DATA | ✓ | ✓ | `OPERATIONAL` |
| E5 | `homigo_consumer_skipped_total` | consumers | ✓ | ON_USE | ✓ | Events | 10s | measured | NO DATA | ✓ | ✓ | `OPERATIONAL` |
| E6 | `homigo_consumer_metrics_duration_seconds` | consumer wrapper | ✓ | ON_USE | ✓ | Events (p50/95/99) | 10s | measured | NO DATA | ✓ | ✓ | `OPERATIONAL` |
| E7 | `homigo_outbox_pending` | `events/core/retention.ts` | ✓ | SAMPLED | ✓ | Events, Overview | scrape | **authoritative 0** | NO DATA | ✓ | ✓ | `OPERATIONAL` |
| E8 | `homigo_outbox_oldest_pending_age_seconds` | same | ✓ | SAMPLED | ✓ | Events | scrape | authoritative 0 | NO DATA | ✓ | ✓ | `MEASUREMENT_ONLY` |
| E9 | `homigo_dlq_unresolved` | same | ✓ | SAMPLED | ✓ | Events, Overview | scrape | authoritative 0 | NO DATA | ✓ | ✓ | `OPERATIONAL` |
| E10 | `homigo_dlq_total` | dead-letter writer | ✓ | SEEDED | ✓ | Events | 10s | measured | NO DATA | ✓ | ✓ | `OPERATIONAL` |
| E11 | `homigo_dlq_persist_failed_total` | dead-letter writer | ✓ | SEEDED | ✓ | Events | 10s | measured | NO DATA | ✓ | ✓ | `OPERATIONAL` |
| E12 | `homigo_event_by_domain_total` | outbox publisher | ✓ | SEEDED | ✓ | Events | 10s | measured | NO DATA | ✓ | ✓ | `OPERATIONAL` |

**Semantic separation, verified live.** `events/sec` is `rate(E1)` — *processing*, where one event
handled by three consumers counts three times. Publication is `rate(E2)`. Measured simultaneously:
**0.67 published/s vs 2.02 processed/s** — the 3-consumer fan-out is visible, not averaged away.

**The DLQ is real**, not a placeholder: `homigo_dlq_unresolved = 1` is a genuinely parked event.

---

## AUTOMATION

| ID | Metric | Producer | Boot | Emits | Scraped | Panel | Zero | Test | E2E | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | `homigo_workflow_definitions{status,mode}` | **new** sampler over `WorkflowDefinition` | ✓ | SEEDED+SAMPLED | ✓ | Automation, Overview | authoritative | ✓ | ✓ | `OPERATIONAL` |
| A2 | `homigo_workflow_definitions_total` | same | ✓ | SEEDED+SAMPLED | ✓ | Automation | authoritative | ✓ | ✓ | `OPERATIONAL` |
| A3 | `homigo_workflow_instances{status}` | same, over `WorkflowInstance` | ✓ | SEEDED+SAMPLED | ✓ | Automation, Overview | authoritative | ✓ | ✓ | `OPERATIONAL` |
| A4 | `homigo_workflow_step_runs_total` | same, over `WorkflowStepRun` | ✓ | SEEDED+SAMPLED | ✓ | Automation | authoritative | ✓ | ✓ | `OPERATIONAL` |
| A5 | `homigo_workflow_step_retries_total` | same, `attempt > 1` | ✓ | SEEDED+SAMPLED | ✓ | Automation, Overview | authoritative | ✓ | ✓ | `OPERATIONAL` |
| A6 | `homigo_workflow_instances_running_age_seconds` | same, oldest RUNNING | ✓ | SEEDED+SAMPLED | ✓ | Automation | authoritative | ✓ | ✓ | `MEASUREMENT_ONLY` |
| A7 | `homigo_scheduled_jobs_pending` | `events/core/retention.ts` | ✓ | SAMPLED | ✓ | Automation, Overview | authoritative | ✓ | ✓ | `OPERATIONAL` |
| A8 | `homigo_scheduled_job_lag_seconds` | same | ✓ | SAMPLED | ✓ | Automation, Overview | authoritative | ✓ | ✓ | `MEASUREMENT_ONLY` |

**Live values:** `LIVE = 0`, `SHADOW = 25`. 25 definitions that record and cannot act — a panel
showing "25 workflows" without the mode column would report a healthy automation estate that does
nothing.

**Executions read from state, not counters**, so they survive a process restart. Retries come from
`WorkflowStepRun.attempt > 1` — the durable record rather than a counter that only exists if this
process happened to increment it.

**Stuck jobs: `STUCK_JOB_THRESHOLD_UNSET`.** Searched scheduler, maintenance, config and the 20
existing alert rules — no canonical threshold exists. Age is exposed (A6, A8).

**Sampler failure leaves the last value**, never zeros — asserted by a test that the catch block
contains no `setGauge`.

---

## AI

| ID | Metric | Producer | Boot | Emits | Panel | Test | Status |
|---|---|---|---|---|---|---|---|
| AI1 | `homigo_ai_requests_total{role,endpoint}` | gateway, once per logical request | ✓ | SEEDED (24 series) | AI, Overview | ✓ | `OPERATIONAL` |
| AI2 | `homigo_ai_provider_usage{provider,status}` | gateway, per attempt | ✓ | SEEDED (8) | AI | ✓ | `OPERATIONAL` |
| AI3 | `homigo_ai_success_total{role,provider}` | gateway | ✓ | SEEDED (24) | available | ✓ | `OPERATIONAL` |
| AI4 | `homigo_ai_failures_total{role,reason}` | gateway | ✓ | SEEDED (6) | AI, Overview | ✓ | `OPERATIONAL` |
| AI5 | `homigo_ai_fallback_total{from,to}` | router | ✓ | SEEDED (12) | AI, Overview | ✓ | `OPERATIONAL` |
| AI6 | `homigo_ai_latency` histogram | gateway | ✓ | **ON_USE** | AI, Overview | ✓ | `OPERATIONAL` |
| AI7 | `homigo_ai_tokens_total{provider,direction}` | gateway | ✓ | SEEDED (8) | AI | ✓ | `OPERATIONAL` |
| AI8 | `homigo_ai_cost` histogram | gateway ← pricing table | ✓ | **ON_USE** | AI | ✓ | `OPERATIONAL` |
| AI9 | `homigo_ai_daily_cost_usd` | cost service | ✓ | SAMPLED | AI, Overview | ✓ | `OPERATIONAL` |
| AI10 | `homigo_ai_cost_unknown_total{provider,role}` | **new**, gateway | ✓ | **SEEDED** | AI, Overview | ✓ | `OPERATIONAL` |
| AI11 | `homigo_ai_provider_failures_total{provider,reason}` | router, closed taxonomy | ✓ | SEEDED | AI | ✓ | `OPERATIONAL` |
| AI12 | `homigo_ai_provider_rate_limited_total` / `_quota_exhausted_total` / `_cooldown_total` | router | ✓ | SEEDED | AI | ✓ | `OPERATIONAL` |
| AI13 | `homigo_ai_prompt_blocked{category,role}` | prompt firewall | ✓ | SEEDED | AI | ✓ | `OPERATIONAL` |
| AI14 | `homigo_ai_degraded_total{endpoint,reason}` | gateway | ✓ | SEEDED | AI | ✓ | `OPERATIONAL` |
| AI15 | `homigo_ai_tool_requests_total` / `_failure_total` / `_denied` / `_pending_approvals` | tool executor | ✓ | SEEDED | AI | ✓ | `OPERATIONAL` |
| AI16 | `homigo_ai_tool_execution_time` histogram | `recordToolLatency` ← `execution-engine.ts:510` | ✓ | **ON_USE** | AI | ✓ | `OPERATIONAL` |
| — | User feedback | **no producer exists** | — | — | text panel | ✓ | `NOT_AVAILABLE` |

**AI6/AI8/AI16 changed to ON_USE in this pass** — see defect D2. They previously emitted at zero
traffic because the boot seed *observed a zero into the histogram*, which fabricates a measurement.

**Verified with real traffic** (three requests through the running backend):
`homigo_ai_latency_count{GROQ} = 3`, `sum = 3.826s`, `bucket{le="0.005"} = 0` — no fabricated
sub-5ms sample. p50 **1.75s**, p95 **2.425s** through the proxy.

**Requests are not attempts** — AI1 counts a logical request once; AI2 counts provider calls
including fallbacks. Never summed.

**Cost is authoritative and reports its own completeness.** Priced from `aiConfig.pricing`; AI10
counts requests excluded for want of pricing. Live: `$0.046` with **0** unknown-cost requests.

---

## ML

| ID | Metric | Producer | Boot | Emits | Panel | Test | Status |
|---|---|---|---|---|---|---|---|
| M1 | `ml_models_total` | BigQuery registry sampler | ✓ | SAMPLED | ML, Overview | ✓ | `OPERATIONAL` |
| M2 | `ml_models_by_status{status}` | same | ✓ | SAMPLED | ML | ✓ | `OPERATIONAL` |
| M3 | `ml_models_production` | same | ✓ | SAMPLED | ML | ✓ | `OPERATIONAL` |
| M4 | `ml_platform_serviceable` | health sampler — **registered in this phase** | ✓ | SAMPLED | ML, Overview | ✓ | `OPERATIONAL` |
| M5 | `ml_platform_check_state{check}` × 4 | same | ✓ | SAMPLED | ML, Overview | ✓ | `OPERATIONAL` |
| M6 | `model_inference_total{model}` | BQML wrapper | ✓ | SEEDED | ML | ✓ | `OPERATIONAL` |
| M7 | `model_inference_errors_total{model}` | same | ✓ | SEEDED | ML | ✓ | `OPERATIONAL` |
| — | Last trained | BigQuery `model_registry.created_at` | — | — | API only | — | `NOT_AVAILABLE` as a series |
| — | Prediction accuracy | no ground-truth pairing | — | — | text panel | ✓ | `NOT_AVAILABLE` |
| — | Distribution drift (PSI/KL) | not computed | — | — | text panel | ✓ | `MEASUREMENT_ONLY` |
| — | Feature health | `/api/admin/ml/readiness` | — | — | referenced | — | Partial |

**Live values:** `ml_platform_serviceable = 0`; `etl_pipeline`, `warehouse_freshness`,
`forecast_horizon` all **FAIL**; `registry_reconciliation` **WARN (0.5)** — against a registry
reporting 8 models with 4 "production". Registry presence is not operational health, and the board is
ordered to say so.

**Data freshness** is `now − newest observation`, computed in the health service, not a row's
`updatedAt`.

---

## Telemetry health

| ID | Metric | Query | Meaning | Status |
|---|---|---|---|---|
| T1 | `up{job="homigo-backend"}` | direct | Can Prometheus reach the exporter | `OPERATIONAL` |
| T2 | Telemetry data age | `time() - timestamp(homigo_outbox_pending)` | Age of the newest **real** sample | `OPERATIONAL` |

**T2 was rebuilt in this pass** — see defect D1. It previously used `timestamp(up{...})`, which stays
fresh through an outage because Prometheus keeps recording failed scrape attempts. Measured: it read
**4.9 s** while every real series had been stale-marked and removed.

---

## Provenance summary

| Question | Answer |
|---|---|
| Metrics referenced by IOC panels | every one has a producer in `src/` or `analytics/` — asserted by a test that scans for each name |
| Boot registration | 24 / 24 samplers and initialisers called |
| Fabricated observations | **0** — nine removed in this pass, asserted by test |
| Panels rendering absence as a number | **0** — asserted by test, no exceptions |
| Duplicate metric concepts | none introduced; `events/sec` and publication deliberately distinct |
| Business logic recreated in a query | none — no revenue, fraud, accuracy or workflow-state computation in any expression |
