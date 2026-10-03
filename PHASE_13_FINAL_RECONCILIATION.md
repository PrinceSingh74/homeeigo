# PHASE 13 — Intelligence Operations Center — Final Reconciliation

## A. Executive verdict

### `PHASE_13_COMPLETE_WITH_FOLLOWUPS`

The Intelligence Operations Center is operational: five dashboards extending the existing Grafana,
**95 panel queries executing through Grafana's own datasource proxy with 0 errors**, every metric
traced from a real producer to a rendered panel.

The audit found the platform in an unusual state: **the telemetry was almost all there and almost
none of it was visualised.** 314 metrics were being exposed and scraped, with rich event, AI and tool
instrumentation — and no dashboard anywhere showed outbox backlog, dead letters, consumer latency or
workflow state. Three real defects were found, one of them a producer written in Phase 12 that was
never registered and therefore never reached Prometheus at all.

Followups are alert thresholds, ownership and retention — all human decisions — plus one security
posture finding on the dev Grafana that I deliberately did not change.

Measured 2026-09-04. Every figure came from a command run in this pass.

---

## B. Previous claim vs current reality

| Claim | Reality |
|---|---|
| "Grafana already has this" (18 dashboards, prior phases) | 19 dashboards existed and **none** covered Events or Automation. AI coverage was tools-only; ML coverage was registry counts. |
| Phase 12: "platform health publishes gauges" | `registerMlPlatformHealthSamplers` **was never called**. `ml_platform_serviceable` existed in code and in **no time series**. My own Phase-12 miss. |
| Phase 12: cost service is careful about unknown pricing | The service was; the **call site threw the care away**. `costStatus` was computed and discarded. |
| Automation is instrumented | The counters were wired into the engine and **not one appeared in the exposition** — no series until first increment, so a dashboard could not tell "nothing ran" from "not instrumented". |

---

## C. Existing Grafana foundation — audited, reused, not replaced

| Component | Finding |
|---|---|
| Live Grafana | `homigo-grafana` :3004, provisioned from `apps/backend/monitoring/_obsstack` — confirmed from the container's own mount table, not assumed |
| Prometheus | :9090, 10s scrape, `host.docker.internal:3010/metrics`, 20 alert rules |
| Datasource | one, `prometheus`, provisioned as code |
| Dashboards-as-code | file provider → folder `HOMIGO Enterprise` |
| Second dashboard tree | `monitoring/grafana/dashboards` (11 files) is **mounted by no running container** — left alone |
| Staging stack | `deploy/observability/staging` :3006 — **byte-for-byte untouched** |

No new datasource, no second deployment mechanism, no alternative UI. Slot 19 was free; the IOC hub
took it and the deep dives took 21–24.

---

## D. Metric inventory

Full detail in [`PHASE_13_METRIC_INVENTORY.md`](PHASE_13_METRIC_INVENTORY.md).

**314 distinct metric names** exposed. Every one the IOC queries has a producer in this codebase —
asserted by a test that scans `src/` and `analytics/` for each referenced metric name, which is
precisely the check the Phase-12 miss would have failed.

---

## E. Events

`OPERATIONAL` — 12 metrics, all pre-existing, none previously dashboarded.

**events/sec is real**: `rate(homigo_consumer_processed_total[5m])`, from consumer handling. Live at
audit time: **3.04 events/s over 315 processed**.

**Publication and processing are not conflated.** Measured simultaneously: **1.01 published/s vs
3.04 processed/s** — exactly the 3-consumer fan-out, visible rather than averaged away.

**Backlog is live outbox state**, not a count of historical rows, and is paired with oldest-pending
age because depth alone cannot distinguish a busy dispatcher from a stalled one.

**The DLQ is real.** `homigo_dlq_unresolved = 1` at audit time — a genuine parked event, not a
fixture. `homigo_dlq_persist_failed_total` is separate, because failing to park an event is worse
than parking it.

**Consumer latency** is handler processing duration (p50/p95/p99 from a real histogram), not request
timestamp difference. Failures, retries and skips are three distinct series.

---

## F. Automation

`OPERATIONAL` — six new gauges over existing state; the biggest gap closed this phase.

The `automation_*` counters were already wired into `instance-manager`, `step-executor`, the trigger
consumer and shadow evidence, and **not one had a series**. The fix seeds a closed label space at
zero and samples the definition/instance/step tables, so:

- **Definitions vs executions stay separate.** Live: **LIVE = 0, SHADOW = 25** — 25 definitions that
  record and cannot act. A dashboard that showed "25 workflows" without the mode column would report
  a healthy automation estate that can do nothing.
- **Executions come from state**, so counts survive a restart.
- **Retries come from `WorkflowStepRun.attempt > 1`** — the durable record, rather than a counter
  that only exists if this process happened to increment it.
- **WAITING is labelled parked-by-design.** CANCELLED is a decision, not a failure.

**Stuck jobs: `STUCK_JOB_THRESHOLD_UNSET`.** Searched the scheduler, maintenance, config and alert
rules — no canonical threshold exists. Age is exposed; what counts as too old is a human decision.

A sampler failure leaves the last value rather than writing zeros — asserted by a test that the catch
block contains no `setGauge`, because a database hiccup is not "there are no workflows".

---

## G. AI

`OPERATIONAL` — the richest existing instrumentation, now visualised, plus one defect fixed.

**Requests are not attempts.** `homigo_ai_requests_total` counts logical requests once;
`homigo_ai_provider_usage` counts provider calls. Both shown, never summed — a request falling
through GROQ → GEMINI → OPENAI is one request and three attempts.

**Cost is authoritative and reports its own completeness.** Priced from `aiConfig.pricing` per
provider. All four providers are priced, so today's figure (`$0.0402`) is complete.

**Defect fixed — unknown cost read as free.** `recordAiCost` took only the number, so a provider with
no pricing entry contributed `0` to the cost histogram — indistinguishable from a free request, and
exactly what the cost service's own comment warns against. It now counts unpriced requests into
`homigo_ai_cost_unknown_total` and never observes them as zero spend, with the counter surfaced beside
the cost figure on two boards.

**Errors are categorised** into five separate series: failure reason, provider error code (closed
taxonomy), prompt-block category, degraded reason, tool denial. **Latency** is gateway-observed
provider latency, not total backend time. **Tokens** are split by direction because input and output
are priced differently.

**User feedback: `NOT_AVAILABLE`.** No feedback signal exists anywhere in the platform. A text panel
says so; no chart is drawn.

---

## H. ML

`OPERATIONAL` — after registering the sampler that was never registered.

**Defect fixed — a producer that never produced.** `registerMlPlatformHealthSamplers()` was written in
Phase 12 and absent from the boot list, so `ml_platform_serviceable` and `ml_platform_check_state`
had no series. Registered; both now scrape.

Live values, which are the point:

```
ml_platform_serviceable                              0   NOT SERVICEABLE
ml_platform_check_state{check="etl_pipeline"}        0   FAIL
ml_platform_check_state{check="warehouse_freshness"} 0   FAIL
ml_platform_check_state{check="forecast_horizon"}    0   FAIL
ml_platform_check_state{check="registry_reconciliation"} 0.5  WARN
ml_models_total 8 · trained 3 · partial 2 · blocked 3 · "production" 4
```

A registry reporting 8 models and 4 production, beside a platform that cannot answer a question about
now. **Registry presence is not operational health**, and the board is ordered to say so.

**Data freshness** is `now − newest observation`, not a row's `updatedAt`.
**Prediction accuracy: `NOT_AVAILABLE`** — needs a prediction paired with the outcome that later
occurred; only shadow predictions carry that and nothing serves in production.
**Drift: `MEASUREMENT_ONLY`** — freshness and horizon expiry are measured; PSI/KL has no threshold.
**Feature health: partial** — measured by `/api/admin/ml/readiness`, a point-in-time API result.

---

## I. Executive Overview

Board **19**, 29 panels across five rows — Events, Automation, AI, ML, and **Telemetry health**.

The telemetry-health row is the one to read first when the platform looks quiet: `up{job=...}` and
seconds-since-last-scrape, so a dead exporter cannot be mistaken for a calm platform. A dashboard that
is itself stale is detectable from the dashboard.

---

## J. Dashboard inventory

Full detail in [`PHASE_13_DASHBOARD_INVENTORY.md`](PHASE_13_DASHBOARD_INVENTORY.md).

| Dashboard | uid | Panels |
|---|---|---|
| 19 · Intelligence Operations Center | `homigo-ioc-overview` | 29 |
| 21 · IOC — Events | `homigo-ioc-events` | 16 |
| 22 · IOC — Automation | `homigo-ioc-automation` | 18 |
| 23 · IOC — AI | `homigo-ioc-ai` | 27 |
| 24 · IOC — ML | `homigo-ioc-ml` | 17 |

Cross-linked by the `ioc` tag with `keepTime`; drill-down is by link, not duplicated panels.
**No variables** — every dimension a variable would filter is already a rendered series label, and
one Grafana serves one environment.

---

## K. Alert inventory

**No new alerts.** The 20 existing rules are unchanged.

| Domain | Metric | Threshold | Status |
|---|---|---|---|
| Outbox backlog / age | exists | none defined | `ALERT_POLICY_UNSET` |
| DLQ unresolved | exists | none defined | `ALERT_POLICY_UNSET` |
| Scheduled-job lag | exists | none defined | `ALERT_POLICY_UNSET` |
| Workflow failures | exists | none defined | `ALERT_POLICY_UNSET` |
| AI provider failure / fallback | exists | none defined | `ALERT_POLICY_UNSET` |
| ML drift / staleness | exists | none defined | `MEASUREMENT_ONLY` |
| Stuck jobs | age exposed | none exists | `STUCK_JOB_THRESHOLD_UNSET` |

An alert needs a metric, a threshold, an owner and a runbook action. The metrics now exist; the rest
are human decisions, and "5 failures = alert" would be noise nobody agreed to answer.

---

## L. RBAC / Security

| Property | State |
|---|---|
| Sensitive labels in any query | **None** — asserted by extracting label keys from selectors and `by()` clauses |
| Label cardinality | Bounded — every grouping label from a closed set; asserted by test |
| Raw prompts / tool arguments | Never queried |
| PII / per-user cost | Absent; AI cost is aggregate per provider |
| Staging Grafana | Anonymous **disabled**, password from env, HTTPS scrape with authorization |

**Finding — dev Grafana is open.** `GF_AUTH_ANONYMOUS_ENABLED=true` with
`GF_AUTH_ANONYMOUS_ORG_ROLE=Admin`: anyone reaching :3004 has Admin, including edit and delete.

**Not changed.** This is the running environment's access configuration, and silently altering it
could lock someone out of their own tooling. The remediation is two lines and is in the runbook, §8.
Data exposure is bounded regardless — the IOC series carry no PII, no prompts and no per-user cost.

Two test defects of my own, found and fixed while writing the security check: it first scanned whole
dashboard JSON and failed on a *description* saying prompts are never labels, then substring-matched
query text and failed on the metric name `homigo_ai_prompt_blocked` — the very design it should
approve. It now extracts label keys, which is the property that was always meant.

---

## M. Data freshness

Every scrape-time gauge is computed at scrape, not cached. The overview carries
`time() - timestamp(up{job="homigo-backend"})` — measured at **1–2 s** during the audit. Panels whose
underlying data can go stale (warehouse freshness, forecast horizon, oldest-pending age, job lag)
render the age itself rather than a boolean.

## N. Zero / unknown / error semantics

| Display | Meaning |
|---|---|
| a number | measured |
| `NO DATA` | no series — nothing collected |
| `NaN` | percentile over a window with no observations |
| Grafana error state | query or datasource failed |

Enforced structurally: **every** stat, timeseries and table panel sets `noValue` explicitly (0
missing, asserted by test); no expression uses `or vector(0)`; the only panels showing `0` for an
absent series are the unknown-cost counters, where absence *is* the observation, and a test asserts
the exceptions contain "cost".

Verified live: `homigo_outbox_pending = 0` (measured) vs a nonexistent metric returning **no series**
— the two are distinguishable end to end.

## O. End-to-end proof

**12 / 12 E2E checks**, queries routed **through Grafana's datasource proxy** — the path a panel
actually uses, not a hand-checked PromQL string:

```
PASS  1 producer exposes /metrics          314 distinct metric names
PASS  2 Prometheus target healthy          health=up
PASS  3 Grafana datasource present         uid=prometheus
PASS  4 five IOC dashboards provisioned    5 found
PASS  5 EVENTS reach Grafana               4.83 events/s
PASS  6 AUTOMATION reaches Grafana         25 SHADOW definitions
PASS  7 AI reaches Grafana                 series returned
PASS  8 ML reaches Grafana                 ml_platform_serviceable=0
PASS  9 every panel query executes         95 queries, 0 errors
PASS 10 single canonical datasource        0 foreign references
PASS 11 absent series never render as 0    0 panels without noValue
PASS 12 no sensitive or unbounded label    0 matches
```

**12 / 12 fault probes** — the dashboards reflect real conditions, not just render:

```
PASS  1 stale ML platform reads NOT SERVICEABLE
PASS  2 dead ETL reads FAIL
PASS  3 stale warehouse reads FAIL
PASS  4 expired forecast horizon reads FAIL
PASS  5 ungoverned production models read WARN
PASS  6 shadow workflows are not counted as live    LIVE=0 SHADOW=25
PASS  7 real dead letter is visible                 dlq_unresolved=1
PASS  8 measured zero differs from absent series
PASS  9 IOC observes its own scrape health          sample 2s old
PASS 10 events/sec derives from real processing     3.04/s over 315
PASS 11 publication not conflated with processing   1.01/s vs 3.04/s
PASS 12 cost carries its own completeness           $0.0402, 0 unknown
```

## P. Performance

95 queries, all instant or `[5m]` rate against Prometheus. No SQL datasource, no business-table scan,
no business logic recreated in a dashboard query. The full 95-query sweep through the Grafana proxy
completes in seconds. Automation sampling uses grouped counts and one ordered lookup, not row scans.

## Q. Cross-phase integration

| Phase | Surfaced through | Duplicated? |
|---|---|---|
| 7–9 intelligence | existing boards 01–18 | No — untouched |
| 10 support | existing AI/tool telemetry | No |
| 11 RAG | `knowledge_*` metrics exist and are emitted; **not yet dashboarded** — see §V | No |
| 12 ML/MLOps | boards 24 and 19, via the now-registered health sampler | No — the registry stays canonical |

No executive, support, RAG or model-registry calculation was recreated in a dashboard query.

## R. Regression

| Check | Result |
|---|---|
| Backend typecheck | **exit 0** |
| IOC observability suite | **17 pass / 0 fail / 341 assertions** |
| E2E through Grafana | **12 / 12** |
| Fault probes | **12 / 12** |
| Panel query sweep | **95 queries, 0 errors** |
| Full backend suite, 130 files | **1882 pass / 16 fail** |

Admin and partner-web were not modified in this phase, so their typechecks and builds are unchanged
from the Phase-12 closure run (both exit 0).

**The 16 failures are pre-existing and unrelated** — the same Postgres-deadlock concurrency and chaos
suites classified in Phases 11 and 12: `chaos-certification`,
`enterprise-scalability-certification`, `money-matrix-certification`, `release-blocker-elimination`,
`failure-recovery-certification`, `adversarial-integration`. **Zero** observability, IOC, metric or
dashboard failures.

Attribution verified rather than assumed: none of those suites imports any file this phase changed
(`ai-metrics`, `automation-metrics`, `ml-platform-health`, `ai-gateway`) — checked by grep, all zero.
Phase 12 additionally proved this class pre-existing by clean-tree comparison, and by two runs on an
identical tree producing 36 and 15 failures.

## S. Production safety

| Question | Answer |
|---|---|
| Production dashboards changed | **No** — staging tree byte-for-byte untouched |
| Production alerting enabled | **No** — no alert rule added or modified |
| Production business state | **No writes.** The backend ran against `homigo_p39`, never `homigo_db` |
| Grafana auth changed | **No** — reported, not altered |
| New infrastructure | **None** — existing containers, existing provisioning |
| Grafana restart | Yes, `homigo-grafana` restarted to reload provisioning. Dev observability container only; no business state. |

## T. Human decisions

| Decision | Why it cannot be inferred |
|---|---|
| `ALERT_THRESHOLDS_HUMAN_DECISION_REQUIRED` | Metrics exist for backlog, DLQ, lag, failures, drift. What magnitude warrants waking someone is a policy with an operational cost. |
| `STUCK_JOB_THRESHOLD_UNSET` | No canonical threshold exists in the project. Age is exposed. |
| `OWNER_UNASSIGNED` | No ownership register exists. Inventing a name would put a person on the hook for something nobody agreed to. |
| `RETENTION_HUMAN_DECISION_REQUIRED` | Prometheus runs on its image default; no policy in the repo. Retention decides how long an incident stays investigable. |
| `GRAFANA_AUTH_HUMAN_DECISION_REQUIRED` | Dev anonymous-Admin is convenient locally and unsafe shared. Remediation supplied, not applied. |
| `SLO_HUMAN_DECISION_REQUIRED` | Board 08 has SLOs for API latency; none exist for events, automation, AI or ML, and inventing them would create commitments nobody made. |

## U. External artifacts

| Artifact | State |
|---|---|
| BigQuery billing | `EXTERNAL_ARTIFACT_REQUIRED` — the ML board reads all-red because of this; the telemetry is correct |
| `OPS_AUTH_TOKEN` in a production scrape config | `EXTERNAL_ARTIFACT_REQUIRED` — `/metrics` is open only when `NODE_ENV !== production` |
| Feedback capture | `EXTERNAL_ARTIFACT_REQUIRED` — nothing to instrument yet |
| Ground-truth outcome capture | `EXTERNAL_ARTIFACT_REQUIRED` — blocks production accuracy |

## V. Known limitations

1. **RAG (Phase 11) is not dashboarded.** `knowledge_*` metrics are emitted and scrapeable, but the
   phase scope named Events, Automation, AI and ML, and adding a fifth domain unasked would be scope
   invention. The metrics are ready when it is wanted.
2. **User feedback, production accuracy and PSI/KL drift are not measurable** — no source exists.
3. **Last-trained and feature health live behind APIs**, not Prometheus series.
4. **Percentiles over small samples are unstable**; latency panels should be read beside rate panels.
5. **`NaN` appears** in percentile panels when a window has no observations. It is not zero and not
   NO DATA; documented in the runbook.
6. **A second, unmounted dashboard tree** (11 files) exists and was left alone.
7. **Dashboards need a Grafana restart** to reload; the file provisioner did not pick up new files
   on its own in this deployment.

## W. Final scope closure

Events, Automation, AI and ML are each observable through one unified center that extends the
existing Grafana. Three real defects were found and fixed — a producer that never produced, a cost
metric that reported unknown as free, and an automation estate with no series at all. Two defects in
my own test code were found and fixed while writing it.

Nothing was fabricated: no invented events/sec, no synthetic backlog, no hardcoded cost, no accuracy
without ground truth, no drift threshold, no alert nobody agreed to answer. Where a measurement does
not exist it is named — `NOT_AVAILABLE`, `MEASUREMENT_ONLY`, `ALERT_POLICY_UNSET`,
`STUCK_JOB_THRESHOLD_UNSET`, `OWNER_UNASSIGNED` — rather than drawn as a zero.

No Capability 13. No Phase 13.1. No second observability stack.

**Verdict: `PHASE_13_COMPLETE_WITH_FOLLOWUPS`.**

---

*Reconciled 2026-09-04. The prior assumption that "Grafana already has this" did not survive: 19
dashboards existed and none showed an outbox backlog, a dead letter, a consumer latency or a workflow
state. The telemetry was there; the operations center was not. Every metric in this report was traced
producer → scrape → query → panel, and every panel query was executed through Grafana's own proxy.*
