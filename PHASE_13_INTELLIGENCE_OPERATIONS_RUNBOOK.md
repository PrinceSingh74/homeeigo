# Intelligence Operations Center — Runbook

**Owner:** `OWNER_UNASSIGNED` — this platform has no ownership register, and inventing a name would
put a person on the hook for something nobody agreed to.

---

## 1. Where it is

| | |
|---|---|
| Grafana (dev) | http://localhost:3004 — folder **HOMIGO Enterprise** |
| Entry point | **19 · Intelligence Operations Center** |
| Deep dives | **21 · IOC — Events**, **22 · IOC — Automation**, **23 · IOC — AI**, **24 · IOC — ML** |
| Navigation | *Intelligence Operations* dropdown, top-left of every IOC board (time range follows you) |
| Datasource | Prometheus, uid `prometheus` |
| Prometheus | http://localhost:9090 · 10s scrape |
| Alertmanager | http://localhost:9094 |

**Dashboards are code.** The JSON lives in `apps/backend/monitoring/_obsstack/dashboards/homigo-ioc-*.json`
and is mounted read-only into Grafana by the file provisioner. Edits made in the Grafana UI are **not
persisted** — change the JSON and reload.

## 2. Bringing it up

The exporter must be on **port 3010** or Prometheus cannot scrape it:

```bash
cd apps/backend
DATABASE_URL="postgresql://postgres:homigo_dev@localhost:5433/homigo_p39" PORT=3010 bun run src/index.ts
```

Then, in order, check:

```bash
curl -s localhost:3010/metrics | head                       # producer alive
curl -s 'localhost:9090/api/v1/targets?state=any'           # target health=up
curl -s -u admin:homigo_admin 'localhost:3004/api/search?query=IOC'   # 5 dashboards
```

New or changed dashboard JSON needs `docker restart homigo-grafana` to be picked up.

## 3. Reading the boards

**NO DATA is not zero.** This is the rule the whole design rests on:

| Display | Meaning |
|---|---|
| a number | something was measured |
| `NO DATA` | no series exists — nothing was collected |
| `NaN` | a percentile over a window with no observations (no traffic), not a measurement of zero |
| Grafana error state | the query or datasource failed |

**There are no exceptions.** Every panel shows `NO DATA` for an absent series. *Requests with UNKNOWN
cost* briefly declared `0` instead, on the reasoning that an absent counter meant "no request had
unknown cost" — true while the exporter was alive, false the moment it died, when the panel would
have shown a number while nothing could be measured. The counter is seeded at zero instead, so `0`
is measured and absence stays absence.

**Start with the Telemetry health row** on board 19 when something looks quiet. If *Backend scrape
target* reads DOWN, every other panel is NO DATA and the platform may be perfectly healthy — verified:
with the exporter stopped, 93 of 95 panels returned no series.

*Telemetry data age* is the second signal there. It measures the age of the newest sample the backend
actually published, **not** the age of Prometheus's scrape attempt: Prometheus keeps recording a
failed attempt every 10s after an exporter dies, so a panel built on `up` reads seconds-fresh through
an outage. When the exporter stops, this grows and then reads NO DATA.

## 4. Metric definitions that are easy to get wrong

| Metric | What it means — and what it does not |
|---|---|
| **Events / sec** | `rate(homigo_consumer_processed_total[5m])` — events *handled*. One event handled by three consumers counts three times. Not publication. |
| **Events published / sec** | `rate(homigo_outbox_publish_total[5m])` — events written to the outbox. Expect processed ≈ N × published where N is the consumer count. |
| **Outbox pending** | Live undispatched rows. Not a count of historical rows. |
| **Oldest pending age** | Age of the oldest undispatched event. Depth alone cannot tell a busy dispatcher from a stalled one; age can. |
| **DLQ unresolved** | Dead letters awaiting a human. The dead-letter path is real here. |
| **DLQ persist failures** | Events that could not even be parked. Non-zero means loss, which is worse than a growing DLQ. |
| **Workflows LIVE / SHADOW** | LIVE can act; SHADOW records what it would have done. This platform currently runs 25 SHADOW and 0 LIVE — a governance state, not a fault. |
| **Executions** | `WorkflowInstance` rows by state, read from the table so they survive a restart. A definition is not an execution. |
| **Step retries** | `WorkflowStepRun` rows past attempt 1. A retry that then succeeded is a recovery, not a failure. |
| **WAITING** | Parked until `nextRunAt`, with a job queued. Healthy. Never read as stuck. |
| **AI requests / sec** | Logical requests, counted once. |
| **AI provider attempts / sec** | Provider calls, including fallbacks. **Never add this to requests** — one request through GROQ → GEMINI → OPENAI is 1 request and 3 attempts. |
| **AI latency** | Gateway-observed provider latency. Not total backend request time. |
| **Cost today** | From the per-provider pricing table, not an estimate. |
| **Requests with UNKNOWN cost** | Requests excluded from the cost figure because their provider has no pricing entry. Non-zero means spend is understated by that many requests. |
| **ML platform** | Whether predictions describe *now*. NOT SERVICEABLE means callers should use their deterministic fallback — not that models are missing. |
| **Forecast horizon** | `ML.FORECAST` projects from the end of *training* data, so a model can return confident numbers about a window that closed months ago. FAIL is exactly that. |
| **Registry reconciliation** | WARN means warehouse models are marked production with no governed approval on record. |

## 5. Alert policy

**No new alerts were created.** The 20 existing rules are unchanged.

| Domain | State |
|---|---|
| Outbox backlog / oldest-pending age | `ALERT_POLICY_UNSET` — measured, no threshold defined |
| DLQ unresolved | `ALERT_POLICY_UNSET` |
| Scheduled-job lag | `ALERT_POLICY_UNSET` |
| Workflow failures | `ALERT_POLICY_UNSET` |
| AI provider failure / fallback rate | `ALERT_POLICY_UNSET` |
| ML drift / data staleness | `ALERT_POLICY_UNSET` — `MEASUREMENT_ONLY` |
| Stuck jobs | `STUCK_JOB_THRESHOLD_UNSET` — no canonical threshold exists in this project |

An alert needs a metric, a threshold policy, an owner and a runbook action. The metrics now exist;
the other three are human decisions. Inventing "5 failures = alert" would create noise nobody agreed
to answer.

## 6. Troubleshooting

**Every panel reads NO DATA.**
Check *Backend scrape target*. If DOWN: the exporter is not on 3010, or Docker cannot resolve
`host.docker.internal`. `curl localhost:3010/metrics` from the host, then check the Prometheus
targets page.

**One panel reads NO DATA, the rest are fine.**
The series has no data yet — usually a counter that has never incremented (no AI request, no workflow
run). Confirm with `curl -s localhost:3010/metrics | grep <metric>`. Absence there means the producer
has not fired; presence there means a scrape or query problem.

**A dashboard edit disappeared.**
Expected — provisioning is read-only. Edit the JSON and `docker restart homigo-grafana`.

**A latency panel reads NO DATA.**
Correct if nothing of that kind has run yet. Histograms are deliberately not seeded: observing a fake
zero into a histogram would put a sample in the lowest bucket and drag percentiles toward zero, so an
AI or tool latency panel reads NO DATA until the first real observation rather than a misleading ~0ms.

**Automation panels are all zero.**
Correct if nothing has run: the series are seeded at zero deliberately so "nothing ran" is
distinguishable from "not instrumented". `homigo_workflow_definitions` should still show 25 SHADOW.

**ML board is all red.**
Read it as accurate. As of 2026-09-04 the ETL has been failing since 2026-08-19, the warehouse is
~22 days stale and every forecast horizon has expired — see `PHASE_12_FINAL_RECONCILIATION.md`. The
root cause is **BigQuery billing disabled** on the GCP project, which is an external artifact.

**Cost shows a number but you doubt it.**
Check *Requests with UNKNOWN cost* beside it. Zero means every request was priced and the figure is
complete.

## 7. Known limitations

- **User feedback is not measured.** No thumbs-up/down, acceptance or override signal exists anywhere
  in the platform. No panel is drawn rather than one showing a fabricated zero.
- **Production prediction accuracy is not measurable.** It needs a prediction paired with the outcome
  that later occurred; only shadow predictions carry that, and nothing serves in production.
- **Distribution drift (PSI/KL) is not computed.** Freshness and horizon expiry are the drift signals
  available today.
- **Feature health is an API result, not a time series** — read `/api/admin/ml/readiness`.
- **Last-trained is in BigQuery, not Prometheus** — read `/api/admin/ml/models/:name/versions`.
- **Percentiles over small samples are unstable.** Read latency percentiles beside the rate panels.
- **Retention is `HUMAN_DECISION_REQUIRED`** — Prometheus runs on its image default; no policy is
  defined in this repository, and inventing one would silently decide how long incidents stay
  investigable.
- **A second, unmounted dashboard tree exists** at `apps/backend/monitoring/grafana/dashboards`
  (11 files, mounted by no running container). Left alone; adopting or deleting it is not a
  Phase-13 decision.

## 8. Security posture

**Finding — dev Grafana is open, demonstrated not assumed.** `_obsstack/docker-compose.yml` sets
`GF_AUTH_ANONYMOUS_ENABLED=true` with `GF_AUTH_ANONYMOUS_ORG_ROLE=Admin`. A probe with **no
credentials** read the dashboards (HTTP 200), reached `/api/org` (HTTP 200) and **created a dashboard**
(HTTP 200, then deleted). On a laptop that is a convenience; on any shared network it means
unauthenticated dashboard edit and delete.

This was **not changed** — it is the running environment's access configuration and altering it
silently would lock someone out of their own tooling. The remediation, when wanted:

```yaml
GF_AUTH_ANONYMOUS_ENABLED: "false"
GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?required}
```

Staging already does exactly this, plus HTTPS scraping with authorization.

**Data exposure is bounded by design.** No IOC panel selects or groups by a customer, booking, ticket,
user, email, phone, prompt, token or tool-argument dimension — asserted by a test that extracts label
keys from selectors and `by()` clauses. AI cost is aggregate per provider; there is no per-user
breakdown. `homigo_ai_prompt_blocked` carries a category, never the prompt.

**`/metrics` in production** requires `OPS_AUTH_TOKEN`; the dev scrape config carries no credential
because `assertOpsAuthorized` is open when `NODE_ENV !== production`. A production scrape would need
that token added to the scrape config — `EXTERNAL_ARTIFACT_REQUIRED`.

## 9. Environments

| | Dev | Staging |
|---|---|---|
| Grafana | :3004, anonymous **Admin** | :3006, anonymous **off**, password required |
| Scrape job | `homigo-backend` → `host.docker.internal:3010`, HTTP | `homigo-backend-staging`, **HTTPS + authorization** |
| Dashboards | `_obsstack/dashboards` — **IOC boards live here** | `deploy/observability/staging` — **untouched** |

The stacks are separate compose files, ports, scrape jobs and dashboard directories. A dashboard
cannot silently switch environment because each Grafana has exactly one datasource pointing at its
own Prometheus.
