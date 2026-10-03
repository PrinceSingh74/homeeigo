# PHASE 13 — Dashboard Inventory

The Intelligence Operations Center **extends** the existing Grafana deployment. No second
observability stack, no alternative deployment mechanism, no new datasource.

---

## The existing foundation, audited first

| Component | State |
|---|---|
| Grafana (dev) | `homigo-grafana`, port **3004**, provisioned from `apps/backend/monitoring/_obsstack` |
| Grafana (staging) | `homigo-grafana-staging`, port **3006**, from `deploy/observability/staging` — **untouched** |
| Prometheus | `homigo-prometheus`, port 9090, 10s scrape, scrapes `host.docker.internal:3010/metrics` |
| Alertmanager | `homigo-alertmanager`, port 9094, 20 existing alert rules |
| Datasource | one — Prometheus, uid `prometheus`, provisioned as code |
| Dashboards-as-code | file provider → folder **HOMIGO Enterprise**; JSON in `_obsstack/dashboards` |
| Pre-existing dashboards | **19** (01–18, 20) |

A second dashboard tree exists at `apps/backend/monitoring/grafana/dashboards` (11 files). It is
**not mounted by any running container** — verified from the container's own mount table. It was left
alone; adopting or deleting it is not a Phase-13 decision.

**Slot 19 was free**, so the IOC hub took it and the deep dives took 21–24.

---

## The five new dashboards

### 19 · Intelligence Operations Center — `homigo-ioc-overview`

| | |
|---|---|
| Datasource | Prometheus (`prometheus`) |
| Panels | 29 across 5 rows: Events, Automation, AI, ML, Telemetry health |
| Refresh | 30s · time range `now-6h` |
| Variables | none — see note below |
| Alerts | none attached |
| Purpose | First-glance operational awareness, and a set of doors |

Rows mirror the four domains, each with the handful of signals that decide whether to look deeper.
The **Telemetry health** row is the one an operator should read first when something looks quiet: it
shows whether Prometheus can reach the exporter and how old the newest sample is, so a dead exporter
cannot be mistaken for a calm platform.

Carries a text panel explaining that NO DATA is not zero.

### 21 · IOC — Events — `homigo-ioc-events`

16 panels · Throughput / Backlog and dead letters / Detail.
Events per second, publication rate, processing failures, outbox backlog and oldest-pending age,
DLQ unresolved and persist failures, per-consumer rates, failures-vs-retries-vs-skips as three
distinct series, consumer latency p50/p95/p99, events by domain, dead letters by consumer.

### 22 · IOC — Automation — `homigo-ioc-automation`

18 panels · Inventory / Executions / Job age and liveness / Detail.
LIVE vs SHADOW definitions, total definitions, instances by state, completed, failed, step retries,
oldest RUNNING age, scheduled-job lag, WAITING (labelled as parked by design), a status × mode grid,
and backlog beside age.

### 23 · IOC — AI — `homigo-ioc-ai`

27 panels · Volume and outcome / Latency / Tokens and cost / Errors and providers / Tool calls.
Logical requests **and** provider attempts as separate panels, latency percentiles overall and per
provider, tokens split by direction, cost today with an explicit completeness counter beside it,
failure reasons, provider error codes, prompt-block categories, provider health signals, tool
requests/failures/denials/pending approvals, tool execution latency.

Ends with a text panel stating `FEEDBACK_SOURCE_NOT_AVAILABLE` rather than drawing an empty feedback
chart.

### 24 · IOC — ML — `homigo-ioc-ml`

17 panels · Serviceability / Registry / Inference.
Leads with `ml_platform_serviceable` and the four health checks mapped to OK/WARN/FAIL, then registry
composition, then live inference rate and errors per model.

Ends with a text panel stating `ACCURACY_NOT_AVAILABLE`, `DRIFT — MEASUREMENT_ONLY` and the partial
state of feature health, with the reason for each.

---

## Cross-dashboard navigation

All five carry the tag `ioc` and a dashboard-links dropdown filtered to that tag, with `keepTime`
enabled so the time range follows the operator across boards. Drill-down is by link, not by
duplicating panels — the overview shows a signal, the domain board explains it.

## Variables

**None.** Every dimension a variable would offer (`consumer`, `provider`, `status`, `mode`, `model`,
`check`) is already a series label rendered directly by the relevant panel, and the platform runs one
environment per Grafana instance. A variable that filters nothing is visual complexity, so none was
added.

## Time-range consistency

Every panel respects the dashboard time range. Rate windows are `[5m]` throughout — one window, so no
panel silently shows a different period from its neighbour. Gauges are point-in-time by nature and
are labelled as counts or ages rather than trends.

## Zero / unknown / error semantics

Enforced structurally and asserted by test:

- Every stat, timeseries and table panel sets `noValue` explicitly — **0 panels missing it**.
- `noValue` is `NO DATA` everywhere except the two unknown-cost panels, where an absent counter
  genuinely means "no request had unknown cost". A test asserts the only exceptions contain "cost".
- No expression uses `or vector(0)` or similar, which would turn an outage into a confident number.
- Query errors surface as Grafana's own error state; nothing converts them to 0.

## Performance

95 queries across five dashboards, all instant or 5-minute-rate against Prometheus. No SQL datasource,
no business-table scan, no recreated business logic. Every panel query executed through the Grafana
proxy in the E2E run with **0 errors**; the whole 95-query sweep completes in seconds.

## Security

| Property | State |
|---|---|
| Sensitive labels | **None.** Asserted by extracting label keys from selectors and `by()` clauses and testing against a forbidden set. |
| Label cardinality | Bounded — every grouping label comes from a closed set (`consumer`, `provider`, `status`, `mode`, `reason`, `category`, `direction`, `model`, `check`, `domain`, `event_type`, `endpoint`, `role`). Asserted by test. |
| Raw prompts / tool arguments | Never queried. `homigo_ai_prompt_blocked` carries a category, never the prompt. |
| PII / financial detail | Not present in any IOC series. AI cost is aggregate by provider — no per-user breakdown. |
| Dev Grafana auth | `GF_AUTH_ANONYMOUS_ENABLED=true`, `ORG_ROLE=Admin` — **finding, see reconciliation §L** |
| Staging Grafana auth | Anonymous **disabled**, admin password required from env, HTTPS scrape with authorization |

## Environment separation

Dev and staging are separate stacks, separate compose files, separate ports, separate scrape jobs
(`homigo-backend` vs `homigo-backend-staging`), separate dashboard directories. The five IOC boards
are provisioned to **dev only** — `deploy/observability/staging` is byte-for-byte untouched, verified
by `git status`.
