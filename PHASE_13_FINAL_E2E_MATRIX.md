# PHASE 13 — Final E2E Matrix

Every path exercised against the running development platform on 2026-09-04. Queries marked *(proxy)*
were executed **through Grafana's own datasource proxy** — the path a panel actually uses — not by
running PromQL in a terminal.

Environment: backend on `:3010` against **`homigo_p39`** (isolated), Prometheus `:9090`,
Grafana `:3004`. `homigo_db` was never written to.

---

## A. Source-to-panel paths

| # | Path | Method | Result | Evidence |
|---|---|---|---|---|
| 1 | Producer exposes `/metrics` | HTTP | **PASS** | 314 distinct metric names |
| 2 | Prometheus scrapes producer | targets API | **PASS** | `health=up` |
| 3 | Grafana reaches datasource | Grafana API | **PASS** | uid `prometheus` present |
| 4 | Five IOC dashboards provisioned | Grafana search | **PASS** | 5 found |
| 5 | **EVENT** → metric → Grafana | proxy | **PASS** | 4.83 events/s |
| 6 | **WORKFLOW** → state → metric → Grafana | proxy | **PASS** | 25 SHADOW definitions |
| 7 | **AI REQUEST** → telemetry → Grafana | proxy | **PASS** | `homigo_ai_requests_total` returned |
| 8 | **ML STATE** → telemetry → Grafana | proxy | **PASS** | `ml_platform_serviceable = 0` |
| 9 | Every panel query executes | proxy × 95 | **PASS** | 95 queries, **0 errors** |
| 10 | Single canonical datasource | JSON audit | **PASS** | 0 foreign references |
| 11 | Absent series never render as 0 | JSON audit | **PASS** | 0 panels without `noValue` |
| 12 | No sensitive/unbounded label | label-key extraction | **PASS** | 0 matches |

**12 / 12.**

## B. Fault conditions — does the centre reflect reality?

| # | Condition | Expected | Result | Evidence |
|---|---|---|---|---|
| 1 | ML platform stale | NOT SERVICEABLE | **PASS** | `ml_platform_serviceable = 0` |
| 2 | ETL dead since 2026-08-19 | FAIL | **PASS** | `etl_pipeline = 0` |
| 3 | Warehouse 22 days stale | FAIL | **PASS** | `warehouse_freshness = 0` |
| 4 | Forecast horizon expired 69 days | FAIL | **PASS** | `forecast_horizon = 0` |
| 5 | 4 ungoverned production models | WARN | **PASS** | `registry_reconciliation = 0.5` |
| 6 | 25 SHADOW workflows | not shown as LIVE | **PASS** | `LIVE=0 SHADOW=25` |
| 7 | A real parked dead letter | visible | **PASS** | `dlq_unresolved = 1` (genuine, not a fixture) |
| 8 | Measured zero vs absent series | must differ | **PASS** | `outbox_pending=0` vs nonexistent = no series |
| 9 | IOC observes its own collection | detectable | **PASS** | target up, sample 2s old |
| 10 | events/sec from real processing | real counter | **PASS** | 2.02/s over 225 processed |
| 11 | Publication vs processing | not conflated | **PASS** | **0.67/s published vs 2.02/s processed** — the 3-consumer fan-out |
| 12 | Cost completeness | stated | **PASS** | `$0.046`, 0 unknown-cost requests |

**12 / 12.**

## C. Failure and empty-state behaviour

| # | Condition | Expected | Result | Evidence |
|---|---|---|---|---|
| 1 | **Producer DOWN** — whole dashboard | NO DATA, not 0 | **PASS** | **93 of 95 panels returned no series**; only the two telemetry-health panels answered |
| 2 | Producer DOWN — scrape target panel | DOWN | **PASS** | `up = 0` |
| 3 | Producer DOWN — data-age panel | NO DATA | **PASS** | after the D1 fix; **previously read "4.9s fresh"** |
| 4 | Unknown datasource | error, not 0 | **PASS** | HTTP 404 through the proxy |
| 5 | Malformed PromQL | error, not 0 | **PASS** | HTTP 400, `status=error`, parse error surfaced |
| 6 | Metric that does not exist | no series, not 0 | **PASS** | 0 series returned |
| 7 | Histogram with no observations | NO DATA, not ~0 | **PASS** | `homigo_ai_tool_execution_time` absent until a real tool call — **the D2 fix working** |

**7 / 7.**

## D. Security and authorization

| # | Probe | Result | Evidence |
|---|---|---|---|
| 1 | Anonymous **reads** IOC dashboards | **CONFIRMED OPEN** | HTTP 200 with no credentials |
| 2 | Anonymous reaches org-scoped API | **CONFIRMED OPEN** | HTTP 200 on `/api/org` |
| 3 | Anonymous **creates** a dashboard | **CONFIRMED OPEN** | HTTP 200 — probe dashboard created, then deleted |
| 4 | Unknown datasource denied | **PASS** | HTTP 404 |
| 5 | Malformed query rejected | **PASS** | HTTP 400 |
| 6 | Absent metric → no series | **PASS** | 0 series |
| 7 | Production `/metrics` token-gated | **PASS** | open in dev, requires `OPS_AUTH_TOKEN` in production, denies when unset |
| 8 | No sensitive/unbounded label | **PASS** | 0 leaks across 95 queries |
| 9 | Staging untouched and locked | **PASS** | 0 IOC files in staging; anonymous disabled there |
| 10 | Environments separately configured | **PASS** | dev :3004 / staging :3006, separate compose, jobs, dashboard dirs |

**10 / 10** — probes 1–3 are **findings demonstrated**, not defects fixed.

## E. Real AI traffic — end to end

Three real requests driven **through the running backend's HTTP API**
(`POST /api/admin/knowledge/ask`), so the telemetry reached the scraped exporter rather than a
throwaway process:

```
req 1: http=200 kind=KNOWLEDGE provider=GROQ latency=1357ms
req 2: http=200 kind=KNOWLEDGE provider=GROQ latency=1597ms
req 3: http=200 kind=KNOWLEDGE provider=GROQ latency=1209ms
```

Resulting telemetry, verified in the exposition and through the proxy:

| Check | Value |
|---|---|
| `homigo_ai_latency_count{provider="GROQ"}` | **3** — exactly the three real calls |
| `homigo_ai_latency_sum{provider="GROQ"}` | 3.826 s |
| `homigo_ai_latency_bucket{le="0.005"}` | **0** — no fabricated sub-5ms sample |
| `homigo_ai_cost_count / _sum` | 3 / **$0.0048765** |
| p50 *(proxy)* | **1.75 s** |
| p95 *(proxy)* | **2.425 s** |

Before the D2 fix that lowest bucket held a seeded `1` and the percentiles were dragged toward zero.

A separate direct-gateway run confirmed the request-level contract:
`provider=GROQ · tokens=481/362 · cost=$0.00056977 · costStatus=COMPUTED · fallbackUsed=false`.

## F. Requirement coverage

| Requirement | State | Evidence |
|---|---|---|
| events/sec real | **PASS** | rate over a real consumer counter |
| total events | **PASS** | cumulative, labelled "since process start" |
| outbox backlog | **PASS** | live table state, paired with oldest-pending age |
| event failures | **PASS** | separate from retries and skips |
| DLQ | **PASS** | real; `dlq_unresolved = 1` |
| consumer latency | **PASS** | histogram p50/p95/p99 |
| workflows | **PASS** | status × mode, LIVE vs SHADOW distinct |
| executions | **PASS** | from instance state, survives restart |
| success | **PASS** | `status="COMPLETED"` |
| retries | **PASS** | `WorkflowStepRun.attempt > 1` |
| failures | **PASS** | `status="FAILED"`, CANCELLED excluded |
| stuck jobs | `STUCK_JOB_THRESHOLD_UNSET` | age exposed; no project threshold exists |
| AI requests | **PASS** | logical requests, separate from provider attempts |
| models/providers | **PASS** | per-provider volume, latency, failures |
| tokens | **PASS** | real, split by direction |
| cost | **PASS** | authoritative pricing + completeness counter |
| AI latency | **PASS** | provider latency, not backend request time |
| tool calls | **PASS** | requests, failures, denials, pending approvals |
| AI errors | **PASS** | five separate categorised series |
| user feedback | `NOT_AVAILABLE` | no source exists anywhere; no panel drawn |
| ML models | **PASS** | registry inventory by status |
| last trained | `NOT_AVAILABLE` as a series | BigQuery column, not a Prometheus series |
| data freshness | **PASS** | `now − newest observation` |
| prediction accuracy | `NOT_AVAILABLE` | no production ground truth exists |
| drift | `MEASUREMENT_ONLY` | freshness + horizon measured; PSI/KL has no threshold |
| feature health | Partial | via `/api/admin/ml/readiness`, not a time series |

No requirement is `UNKNOWN`.
