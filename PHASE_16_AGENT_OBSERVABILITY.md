# PHASE 16 — AGENT OBSERVABILITY

**Implementation:** `apps/backend/src/agents/observability/agent-metrics.ts`

---

## Series

| Metric | Type | Labels |
|---|---|---|
| `homigo_agent_runs_total` | counter | agent_id, mode, trigger |
| `homigo_agent_run_outcome_total` | counter | agent_id, mode, status |
| `homigo_agent_admission_refused_total` | counter | agent_id, code |
| `homigo_agent_plan_rejected_total` | counter | agent_id, code |
| `homigo_agent_plan_accepted_total` | counter | agent_id, risk_tier |
| `homigo_agent_plan_steps_total` | counter | agent_id |
| `homigo_agent_step_disposition_total` | counter | agent_id, action, risk_tier |
| `homigo_agent_tool_calls_total` | counter | agent_id, status |
| `homigo_agent_verification_total` | counter | agent_id, verdict |
| `homigo_agent_escalation_total` | counter | agent_id, reason |
| `homigo_agent_bound_hit_total` | counter | agent_id, bound |
| `homigo_agent_loop_prevented_total` | counter | agent_id, kind |
| `homigo_agent_duplicate_suppressed_total` | counter | agent_id, trigger |
| `homigo_agent_run_latency_seconds` | histogram | agent_id, mode |
| `homigo_agent_cost_usd_total` | counter | agent_id |
| `homigo_agent_tokens_total` | counter | agent_id, kind |
| `homigo_agent_recovered_total` | counter | agent_id, action |
| `homigo_agent_live` | gauge | agent_id |

## Bounded cardinality by construction (§55)

Every label is an agent id (five values), a mode (two), a risk tier (three), or a closed
reason/verdict code. **No run id, no actor id, no ticket id, no free text, and no model-authored
string ever becomes a label.** An unbounded label is both a PII leak and a way to take Prometheus
down.

> **Certified — forensic F11a.** Static scan for any label built from an identity-shaped variable:
> zero hits.

## Two unit bugs found and fixed in my own metrics

`observeHist` buckets against `DURATION_BUCKETS`, expressed in **seconds**.

**Latency** was being passed in milliseconds, which would have filed every run in the overflow
bucket and made the histogram read "everything is slow" regardless of reality. Fixed to
`ms / 1000`, and the metric renamed `..._seconds` so the unit is in the name.

**Plan step count** was being passed to `observeHist` as well — a 3-step plan filed as "3 seconds",
piling every plan into the same bucket. Replaced with a counter pair
(`homigo_agent_plan_steps_total` / `homigo_agent_plan_accepted_total`), whose ratio is the mean
plan length, which is the question actually being asked.

Both were caught by reading the metrics implementation rather than by a test — a metric with wrong
units still emits, still scrapes, and still looks healthy on a dashboard.

## Zero-seeding, and its limit (§64)

`initAgentMetricsAtZero()` publishes the series that would be **misread by their absence**: run
counts, plan rejections, loop preventions, verification failures, escalations. Without it a
dashboard shows `NO DATA` for an agent that has simply not run yet, and `NO DATA` is
indistinguishable from "the exporter is broken".

Only those are seeded. Seeding everything would assert activity that has not happened, which is the
inverse failure.

## `homigo_agent_live` is the effective mode, not the flag

The gauge is set from the same computation the control center renders, which folds in four
conditions: layer enabled, kill switch, environment allowlist, and the feature flag. A gauge that
reported the flag alone would read `1` for an agent that the kill switch had stopped — telling an
operator something untrue at exactly the moment it matters.

## Health is not "the process is alive" (§73)

`checkAgentReadiness()` resolves every capability tool against `ai_tool_registry` and reports
`{ready, reasons, registrySeeded, missingTools}`.

This exists because of a real observed failure: on a fresh staging database the agents reported
`LIVE`, planned correctly, and could execute nothing — every tool call died on a foreign-key
violation at the audit write, before the handler, with an opaque `EXECUTION_ERROR`. It fails
closed, which is right, but "silently broken" and "correctly refusing" must not look the same.

## Traceability

Every run carries `traceId`, `runId`, `causationId`, `parentRunId` and `depth`. The trace id is
threaded into `invokeAiGateway` (so the planning call appears in the AI timeline under the same
trace) and into `executeTool` as `correlationId: runId` (so a tool execution resolves back to its
agent run).

## What is NOT claimed

No Grafana dashboard JSON was authored for Phase 16. The metrics are emitted, scraped and
queryable, and the admin control center renders the operational view — but the 18 existing
dashboards were not extended. Recorded as a follow-up rather than described as delivered.
