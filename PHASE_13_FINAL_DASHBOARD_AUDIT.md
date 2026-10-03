# PHASE 13 — Final Dashboard Audit

Every panel re-audited on 2026-09-04: datasource, environment, query, time window, aggregation,
freshness, empty state and error state. All 95 expressions were executed **through Grafana's
datasource proxy**.

---

## A. Deployment

| Property | Value |
|---|---|
| Grafana | `homigo-grafana`, **:3004**, image `grafana/grafana:latest` |
| Provisioned from | `apps/backend/monitoring/_obsstack` — confirmed from the container's mount table, not assumed |
| Folder | **HOMIGO Enterprise** (file provider) |
| Datasource | **one** — Prometheus, uid `prometheus`, provisioned as code |
| Prometheus | :9090, 10s scrape, `host.docker.internal:3010/metrics` |
| Environment | **development** — staging is a separate stack on :3006 |
| Dashboards-as-code | JSON in `_obsstack/dashboards`, mounted read-only |
| Pre-existing boards | 19 (01–18, 20) — unchanged |
| Reload | new/changed JSON requires `docker restart homigo-grafana` |

A second dashboard tree exists at `apps/backend/monitoring/grafana/dashboards` (11 files) and is
**mounted by no running container**. Left alone — adopting or deleting it is not a Phase-13 decision.

---

## B. The five IOC dashboards

| Dashboard | uid | Panels | Queries | Refresh | Range | Variables | Alerts | Status |
|---|---|---|---|---|---|---|---|---|
| 19 · Intelligence Operations Center | `homigo-ioc-overview` | 29 | 26 | 30s | now-6h | none | none | `OPERATIONAL` |
| 21 · IOC — Events | `homigo-ioc-events` | 16 | 18 | 30s | now-6h | none | none | `OPERATIONAL` |
| 22 · IOC — Automation | `homigo-ioc-automation` | 18 | 17 | 30s | now-6h | none | none | `OPERATIONAL` |
| 23 · IOC — AI | `homigo-ioc-ai` | 27 | 21 | 30s | now-6h | none | none | `OPERATIONAL` |
| 24 · IOC — ML | `homigo-ioc-ml` | 17 | 13 | 30s | now-6h | none | none | `OPERATIONAL` |

**95 queries total · 0 errors · 94 returning data.**

The one query that legitimately returns nothing is `homigo_ai_tool_execution_time` — absent until a
real tool call, which is the D2 fix behaving correctly rather than a broken panel.

---

## C. Query audit

| Property | Finding |
|---|---|
| Datasource | **100%** target uid `prometheus`; 0 foreign references |
| Environment | single datasource per Grafana instance — a panel cannot silently reach production |
| Rate window | `[5m]` on **every** rate/histogram query — one window, so no panel silently shows a different period from its neighbour |
| Time range | every timeseries respects the dashboard range; stats are point-in-time by nature and are titled as counts or ages |
| Aggregation | `sum` / `sum by (<closed label>)` / `histogram_quantile`; no nested or hidden re-aggregation |
| Double counting | none — publication (`homigo_outbox_publish_total`) and processing (`homigo_consumer_processed_total`) are separate panels, never summed |
| Business logic in queries | **none** — no revenue, fraud, workflow-state, cost or accuracy computation; every value comes from a canonical producer |
| Default substitution | **none** — no `or vector(0)`, no `absent()` fallback; asserted by test |

### Current vs historical, labelled

| Kind | Panels | Why |
|---|---|---|
| Point-in-time gauges | outbox pending, DLQ unresolved, workflow inventory, ML checks, job lag | current state; titled as counts or ages |
| Rate / trend | events/sec, AI requests, failures, latency percentiles, inference | `[5m]` rate over the dashboard range |
| Cumulative | "Events processed (total)" | explicitly described as "cumulative since process start; counters reset on restart — use the rate panels for trend" |

---

## D. Zero / unknown / error semantics

| Display | Meaning | Enforcement |
|---|---|---|
| a number | measured | — |
| `NO DATA` | no series exists | **every** stat/timeseries/table sets `noValue: "NO DATA"` |
| `NaN` | percentile over a window with no observations | documented in the runbook |
| Grafana error state | query or datasource failed | verified: 404 / 400 surfaced, never 0 |

**No exceptions remain.** The unknown-cost panels previously declared `noValue: "0"`, on the
reasoning that an absent counter meant "no request had unknown cost". That held while the exporter
was alive and broke the moment it was not: with the backend down the series is equally absent and the
panel would have shown a number while nothing could be measured — the one panel on the board still
claiming a value during an outage. The counter is now seeded at zero and the panel reads NO DATA like
every other. A test asserts **zero** panels use any `noValue` other than `NO DATA`.

**Verified live with the producer down: 93 of 95 panels returned no series.** Only the two
telemetry-health panels answered, and one of them read `up = 0`.

---

## E. Navigation and structure

All five carry the tag `ioc` and a dashboard-links dropdown filtered to it, with `keepTime` so the
range follows the operator. Drill-down is by link, never by duplicating panels: the overview shows a
signal, the domain board explains it.

**Variables: none.** Every dimension a variable would filter (`consumer`, `provider`, `status`,
`mode`, `model`, `check`) is already a rendered series label, and one Grafana serves one environment.
A variable that filters nothing is visual complexity.

**Information hierarchy on board 19:** Events → Automation → AI → ML → **Telemetry health**. The
health row is what an operator should read first when the platform looks quiet — it shows whether
Prometheus can reach the exporter and how old the newest **real** sample is.

---

## F. Freshness

| Panel | Source | Behaviour when stale |
|---|---|---|
| Backend scrape target | `up{job="homigo-backend"}` | UP → DOWN |
| **Telemetry data age** | `time() - timestamp(homigo_outbox_pending)` | grows, then NO DATA once stale-marked |
| Warehouse freshness / forecast horizon | ML health sampler | FAIL |
| Oldest pending age / job lag | live table state | age grows |

**"Telemetry data age" was rebuilt in this pass.** It previously used `timestamp(up{...})`, which
stays fresh through an outage because Prometheus keeps recording failed scrape attempts — it read
**4.9 s** while every real series had already been stale-marked and removed. It now anchors on a real
exporter series, so it degrades honestly.

---

## G. Performance

| Measure | Value |
|---|---|
| Queries per full sweep | 95 |
| Errors | 0 |
| Datasource | Prometheus only — no SQL datasource, no business-table scan |
| Heaviest query class | `histogram_quantile` over a 5m rate — bounded by bucket count |
| Sampler cost | grouped counts plus one ordered lookup; no row scans |
| Panels per board | 16–29 |

No optimisation was applied, because nothing measured showed a problem.

---

## H. Alerts

**None attached to any IOC dashboard.** The 20 pre-existing rules are unchanged.

| Domain | Metric exists | Threshold | Owner | Runbook | Status |
|---|---|---|---|---|---|
| Outbox backlog / age | ✓ | none | none | none | `ALERT_POLICY_UNSET` |
| DLQ unresolved | ✓ | none | none | none | `ALERT_POLICY_UNSET` |
| Scheduled-job lag | ✓ | none | none | none | `ALERT_POLICY_UNSET` |
| Workflow failures | ✓ | none | none | none | `ALERT_POLICY_UNSET` |
| AI provider failure / fallback | ✓ | none | none | none | `ALERT_POLICY_UNSET` |
| ML drift / staleness | ✓ | none | none | none | `MEASUREMENT_ONLY` |
| Stuck jobs | age only | **none exists in the project** | none | none | `STUCK_JOB_THRESHOLD_UNSET` |

An alert needs a metric, a threshold, an owner and a runbook action. The metrics now exist; the other
three are human decisions.

---

## I. Security

Full detail in `PHASE_13_FINAL_SECURITY_AUDIT.md`. Summary: no sensitive or unbounded label in any of
the 95 queries (asserted by extracting label keys); dev Grafana grants Admin anonymously — a
demonstrated finding, deliberately not changed; staging untouched and locked down.
