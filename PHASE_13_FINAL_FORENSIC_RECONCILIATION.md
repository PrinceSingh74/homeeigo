# PHASE 13 — Final Forensic Reconciliation

**Date:** 2026-09-04
**Scope:** requirement-by-requirement re-verification of the Intelligence Operations Center, treating
every prior Phase-13 claim as an unproven assertion.
**Environment:** backend `:3010` → **`homigo_p39`** (isolated) · Prometheus `:9090` · Grafana `:3004`
**`homigo_db` was never written to.** No production deployment. No destructive migration.

---

## A. Executive verdict

**`PHASE_13_COMPLETE_WITH_FOLLOWUPS`**

Every in-scope technical requirement is operational and verified **source → producer → exporter →
Prometheus → Grafana panel**, with each hop executed rather than described. 95 panel queries were run
through Grafana's own datasource proxy: **0 errors, 94 returning data**, the 95th legitimately empty.

The pass was not a formality. It found **three real defects that the previous Phase-13 report had
declared passing**, all of which shared one failure mode: *a panel that shows a confident number when
nothing can actually be measured.* All three are fixed and re-verified.

The follow-ups are not unfinished code. They are `HUMAN_DECISION_REQUIRED` (alert thresholds, alert
owners, retention, dev Grafana authentication) and `EXTERNAL_ARTIFACT_REQUIRED` (BigQuery billing,
production scrape credential, feedback capture, ground-truth capture). Writing code to close any of
them would mean inventing a decision nobody made.

---

## B. Previous claim vs current reality

| Previous claim | Verdict | What was actually true |
|---|---|---|
| "All 95 panel queries execute successfully" | **CONFIRMED** | re-run through the proxy: 95 / 0 errors |
| "Freshness is visible on the overview" | **FALSE** | the panel read **4.9 s fresh** while every real series was already stale-marked — **D1** |
| "No fabricated values" | **FALSE** | 9 `observeHist(metric, 0, …)` seedings put fake samples in histograms — **D2** |
| "NO DATA is never 0" | **FALSE** | one panel declared `noValue: "0"` and would have shown a number during a total outage — **D3** |
| "Dashboards carry no sensitive labels" | **CONFIRMED**, but the test was wrong twice | the check scanned prose, not label keys; rewritten to extract label keys — 0 matches |
| "Grafana auth posture documented" | **INSUFFICIENT** | documented, never demonstrated; an anonymous request now provably **created a dashboard** |
| "Single canonical datasource" | **CONFIRMED** | 0 foreign uid references |
| "Staging untouched" | **CONFIRMED** | 0 IOC files under `deploy/observability`; `git status` on that tree empty |
| "ML board reflects reality" | **CONFIRMED** | all four ML checks fail for real, documented reasons |

The pattern in the three falsehoods is worth naming: each was a place where the observability system
would have lied **specifically during an outage** — the moment it exists for.

---

## C. Every defect found

| ID | Defect | Severity | Why it mattered |
|---|---|---|---|
| **D1** | "Seconds since last scrape" used `timestamp(up{job=…})` | **HIGH** | Prometheus records a *failed* scrape attempt every 10 s after an exporter dies, so `up` keeps a fresh timestamp. The panel read **4.9 s** while all real series had been stale-marked and dropped. The one panel an operator consults to ask "is this data current?" was structurally incapable of saying no. |
| **D2** | 9 × `observeHist(metric, 0, {...})` seeding histograms at zero | **HIGH** | A seeded zero is a real sample in the lowest bucket. `histogram_quantile` cannot distinguish it from a genuine sub-5 ms call, so every AI/brain/tool latency percentile was dragged toward zero — fabricated performance, and worse the less traffic there was. |
| **D3** | `noValue: "0"` on the unknown-cost panels | **MEDIUM** | True while the exporter lived ("no request had unknown cost"), false the instant it died — the series is equally absent, and this would have been the **only panel on the board still showing a number** during a total outage. |
| **T1** | Security label test scanned whole dashboard JSON | test defect | Failed on a panel *description* saying prompts are never used as labels. It tested prose. |
| **T2** | Security label test substring-matched query text | test defect | Failed on the metric **name** `homigo_ai_prompt_blocked` — flagging the exact safe design it should approve. |
| **T3** | Fault probe 10 raced a restart | test defect | Read "1.723 events/s over 0 processed" — a rate window outliving the counter. |

---

## D. Every defect fixed

| ID | Fix | Verification |
|---|---|---|
| **D1** | Panel renamed **"Telemetry data age"**, expression changed to `time() - timestamp(homigo_outbox_pending)` — anchored on a real exporter series | With the producer stopped it **grows and then reads NO DATA**; the scrape-target panel reads `up = 0` beside it |
| **D2** | All 9 fabricated observations removed from `ai-metrics.ts`, `ai-brain-metrics.ts`, `ai-tools-metrics.ts`. Histograms are now created by their first real observation | 3 real AI requests → `homigo_ai_latency_count{GROQ}=3`, `sum=3.826`, **`bucket{le="0.005"}=0`**, p50 **1.75 s**, p95 **2.425 s**. `homigo_ai_tool_execution_time` correctly absent until a real tool call |
| **D3** | `homigo_ai_cost_unknown_total` seeded at **0** (a counter at zero is a measurement); every `noValue` normalised to `NO DATA` | Test asserts **zero** panels use any `noValue` other than `NO DATA` — no exception clause remains |
| **T1/T2** | Check rewritten to extract label keys from `{…}` selectors and `by()` / `without()` clauses | 0 matches across all 95 queries |
| **T3** | Bounded 12 × 5 s retry loop | probe 10 now reads a coherent 2.02 /s over 225 processed |

Counters are seeded at zero; **histograms are not**. That asymmetry is the whole lesson of D2 and D3:
a counter at zero is a fact, a histogram sample at zero is a claim about latency.

---

## E. Metric-by-metric audit

Full table in `PHASE_13_FINAL_METRIC_AUDIT.md`. Summary of the properties enforced everywhere:

| Property | Result |
|---|---|
| Every metric traced to a producer in source | **PASS** — no orphan panels |
| Every sampler registered at boot | **24 / 24** verified by boot audit |
| Counter vs gauge vs histogram used correctly | **PASS** — counters rated, gauges read point-in-time, histograms quantiled |
| Gauges published from table state, not process memory | **PASS** — survive a restart |
| No fabricated seeding of histograms | **PASS** — D2 |
| Counters seeded so absence ≠ zero | **PASS** — D3 |
| Label cardinality bounded | **PASS** — closed sets only |
| Sampler failure never writes a value | **PASS** — the catch block in `automation-metrics.ts` deliberately contains **no** `setGauge`, so a failed sample leaves the series to stale-mark rather than reporting a false zero |

---

## F. Events

| Requirement | State | Evidence |
|---|---|---|
| events/sec | **PASS** | `rate(homigo_consumer_processed_total[5m])` = **2.02 /s** over 225 real processed events |
| total events | **PASS** | cumulative, panel explicitly labelled "since process start; counters reset on restart" |
| publication vs processing not conflated | **PASS** | **0.673 /s published vs 2.018 /s processed** — the real 3-consumer fan-out, on separate panels, never summed |
| outbox backlog | **PASS** | live table state, paired with **oldest-pending age** (depth alone cannot distinguish busy from stalled) |
| failures | **PASS** | separate series from retries and skips |
| DLQ | **PASS** | `dlq_unresolved = 1` — a genuine parked dead letter, not a fixture |
| DLQ persist failures | **PASS** | distinct series; non-zero means loss, which is worse than backlog |
| consumer latency | **PASS** | histogram p50/p95/p99 |

## G. Automation

| Requirement | State | Evidence |
|---|---|---|
| workflow inventory | **PASS** | `homigo_workflow_definitions{status,mode}` — **25 SHADOW, 0 LIVE**, a governance state reported honestly, not a fault |
| executions | **PASS** | `homigo_workflow_instances{status}` from `WorkflowInstance` rows — survives restart |
| success | **PASS** | `status="COMPLETED"` |
| retries | **PASS** | `WorkflowStepRun.attempt > 1`; a retry that then succeeded is counted as a recovery, not a failure |
| failures | **PASS** | `status="FAILED"`; CANCELLED deliberately excluded |
| WAITING not shown as stuck | **PASS** | parked with a queued job — documented as healthy |
| stuck jobs | **`STUCK_JOB_THRESHOLD_UNSET`** | running-instance **age** is exposed; no canonical stuck threshold exists in this project and inventing one would manufacture incidents |

## H. AI

| Requirement | State | Evidence |
|---|---|---|
| requests | **PASS** | logical requests, counted once |
| provider attempts | **PASS** | separate series — one request through GROQ → GEMINI → OPENAI is 1 request and 3 attempts; never added |
| latency | **PASS** | real percentiles after D2: p50 1.75 s, p95 2.425 s |
| tokens | **PASS** | real, split by direction (481 in / 362 out on the verification call) |
| cost | **PASS** | authoritative per-provider pricing table — **$0.0048765** over 3 requests |
| cost completeness | **PASS** | `homigo_ai_cost_unknown_total` seeded at 0; UNKNOWN cost increments it and is **excluded** from the cost histogram rather than recorded as $0 |
| tool calls | **PASS** | requests, failures, denials, pending approvals |
| errors | **PASS** | five separately categorised series |
| user feedback | **`NOT_AVAILABLE`** | no thumbs-up/down, acceptance or override signal exists anywhere in the platform. **No panel drawn** — a zero here would be fabrication |

## I. ML

| Requirement | State | Evidence |
|---|---|---|
| model inventory | **PASS** | registry counts by status |
| platform serviceability | **PASS** | `ml_platform_serviceable = 0` — correct |
| ETL health | **PASS (reporting a real failure)** | `etl_pipeline = 0`; dead since 2026-08-19 |
| warehouse freshness | **PASS (real failure)** | `warehouse_freshness = 0`; ~22 days stale |
| forecast horizon | **PASS (real failure)** | `forecast_horizon = 0`; expired 69 days |
| registry reconciliation | **PASS** | `0.5` = WARN: 4 warehouse models marked production with no governed approval |
| last trained | **`NOT_AVAILABLE` as a series** | a BigQuery column; read via `/api/admin/ml/models/:name/versions` |
| prediction accuracy | **`NOT_AVAILABLE`** | needs a prediction paired with the outcome that later occurred; only shadow predictions carry that and nothing serves in production |
| drift | **`MEASUREMENT_ONLY`** | freshness and horizon expiry are measured; PSI/KL has no agreed threshold |
| feature health | **Partial** | via `/api/admin/ml/readiness`, not a time series |

Root cause of the four ML failures is **BigQuery billing disabled** on the GCP project —
`EXTERNAL_ARTIFACT_REQUIRED`. The board is red because the platform is, and that is the correct
behaviour.

## J. Unified operations center

One entry point, four drill-downs, no duplicate stack.

| Board | uid | Panels | Queries |
|---|---|---|---|
| 19 · Intelligence Operations Center | `homigo-ioc-overview` | 29 | 26 |
| 21 · IOC — Events | `homigo-ioc-events` | 16 | 18 |
| 22 · IOC — Automation | `homigo-ioc-automation` | 18 | 17 |
| 23 · IOC — AI | `homigo-ioc-ai` | 27 | 21 |
| 24 · IOC — ML | `homigo-ioc-ml` | 17 | 13 |

All tagged `ioc` with a `keepTime` links dropdown. Drill-down is by link, never by duplicated panels:
the overview shows a signal, the domain board explains it. The 19 pre-existing boards (01–18, 20) are
**unchanged**. No second Grafana, Prometheus or ML engine was created.

**Variables: none** — every dimension a variable would filter is already a rendered series label, and
one Grafana serves exactly one environment.

## K. Grafana datasource

| Property | Result |
|---|---|
| Datasources | **one** — Prometheus, uid `prometheus`, provisioned as code |
| Panel references | **100 %** target that uid; **0** foreign references |
| Environment | development; staging is a separate stack on :3006 with its own Prometheus |
| Provisioning | file provider, mounted **read-only** — confirmed from the container's mount table, not assumed |
| Consequence | a panel **cannot** silently reach production data |

## L. Dashboard query audit

| Property | Finding |
|---|---|
| Rate window | `[5m]` on **every** rate/histogram query — no panel silently shows a different period from its neighbour |
| Aggregation | `sum` / `sum by (<closed label>)` / `histogram_quantile`; no hidden re-aggregation |
| Double counting | none — publication and processing are separate panels |
| Business logic in queries | **none** — no revenue, fraud, cost or accuracy computed in PromQL; every value comes from a canonical producer |
| Default substitution | **none** — no `or vector(0)`, no `absent()` fallback; asserted by test |
| Current vs historical | labelled — the one cumulative panel says so in its description |

## M. Freshness

| Panel | Source | Behaviour when stale |
|---|---|---|
| Backend scrape target | `up{job="homigo-backend"}` | UP → DOWN |
| **Telemetry data age** | `time() - timestamp(homigo_outbox_pending)` | grows, then NO DATA — **D1 fix** |
| Warehouse freshness / forecast horizon | ML health sampler | FAIL |
| Oldest pending age / job lag | live table state | age grows |

The distinction that D1 turned on: **the age of the newest sample the backend published** is not the
age of Prometheus's last scrape *attempt*. Only the former degrades during an outage.

## N. Zero / UNKNOWN / ERROR

| Display | Meaning | Enforcement | Proven by |
|---|---|---|---|
| a number | measured | — | AI cost `$0.046` with 0 unknown-cost requests |
| **0** | measured zero | counters seeded; gauges read from tables | `outbox_pending = 0` **vs** a nonexistent metric returning no series |
| `NO DATA` | nothing collected | every panel sets `noValue: "NO DATA"`, **no exceptions** | producer down → **93 of 95 panels no series** |
| `NaN` | percentile over a window with no observations | documented | — |
| Grafana error | query/datasource failed | never coerced to 0 | 404 unknown datasource, 400 malformed PromQL |
| `UNKNOWN` | cannot measure | own counter, excluded from the value | `homigo_ai_cost_unknown_total` |

These four states are never interchangeable, and the D3 fix removed the last place where one could
have been mistaken for another.

## O. RBAC

The IOC adds **no HOMIGO API surface** — it reads Prometheus, and Prometheus reads `/metrics`. No
admin route, permission or role mapping was created or modified, so application RBAC is unaffected by
this phase.

Grafana runs a single organisation with its own identity; HOMIGO roles (`ADMIN` / `SUPPORT` /
`PARTNER` / `CUSTOMER`) are **not propagated** into it. Stating that plainly is more useful than a
matrix implying an integration that does not exist.

## P. Security

10 / 10 probes executed. Full detail in `PHASE_13_FINAL_SECURITY_AUDIT.md`.

| Area | State |
|---|---|
| Data confidentiality | **PASS** — 0 sensitive labels across 95 queries; no PII, prompts, tool arguments, secrets or per-user cost |
| Label cardinality | **PASS** — closed sets only |
| Failure semantics | **PASS** — errors and absence never become values |
| Environment isolation | **PASS** — staging byte-for-byte untouched |
| Production `/metrics` guard | **PASS** in code (`OPS_AUTH_TOKEN`, denies when unset); the scrape credential is `EXTERNAL_ARTIFACT_REQUIRED` |
| Dev Grafana authentication | **FINDING — `HUMAN_DECISION_REQUIRED`** |

**The finding, demonstrated rather than described:** with no credentials, a probe read the dashboards
(200), reached `/api/org` (200) and **created a dashboard** (200, then deleted). `_obsstack` sets
`GF_AUTH_ANONYMOUS_ENABLED=true` with role `Admin`. **Deliberately not changed** — silently altering
the running environment's access configuration could lock someone out of their own tooling. Two-line
remediation supplied; staging already does exactly it. Blast radius is dashboard *integrity*, not data
confidentiality, because §C proves there is nothing sensitive to read.

## Q. Fault probes

**12 / 12.** Each asks whether the centre reflects reality when reality is bad:

ML stale → NOT SERVICEABLE · ETL dead → FAIL · warehouse 22 d stale → FAIL · horizon expired 69 d →
FAIL · 4 ungoverned models → WARN · 25 SHADOW not shown as LIVE · a genuine parked dead letter visible
· measured `0` distinguishable from an absent series · the IOC observes its own collection · events/s
from a real counter · **publication 0.673 /s vs processing 2.018 /s** (fan-out, not double counting) ·
cost completeness stated.

Failure-mode probes: unknown datasource → **404**, malformed PromQL → **400**, absent metric → 0
series, producer down → **93/95 NO DATA**, empty histogram → NO DATA not ~0.

## R. E2E

**12 / 12 source-to-panel**, executed **through Grafana's datasource proxy** — the path a panel
actually uses, not PromQL in a terminal. Event, workflow, AI-request and ML-state paths each traced
from their producing code to a rendered panel.

Real AI traffic through the running backend's HTTP API (`POST /api/admin/knowledge/ask`), so telemetry
reached the *scraped* exporter rather than a throwaway process: 3 × HTTP 200 via GROQ (1357 / 1597 /
1209 ms) → `latency_count = 3`, `sum = 3.826`, **`bucket{le="0.005"} = 0`**, p50 1.75 s, p95 2.425 s.
Before D2 that bucket held a seeded `1`.

## S. Cross-phase integration

| Phase | Integration | State |
|---|---|---|
| 11 — Enterprise RAG | knowledge/AI telemetry feeds board 23; the verification traffic ran through the RAG ask endpoint | **PASS** |
| 12 — ML & MLOps | registry, readiness and platform-health samplers feed board 24 | **PASS** |
| 12 forensic closure | the demand staleness guard is what makes `forecast_horizon = 0` truthful rather than a confident expired number | **PASS** |
| Existing observability | 19 pre-existing boards, 20 alert rules, one Prometheus, one Grafana — **all unchanged** | **PASS** |

No duplicate observability stack and no duplicate ML engine was created, as required.

## T. Performance

| Measure | Value |
|---|---|
| Queries per full sweep | 95 · **0 errors** |
| Datasource | Prometheus only — no SQL datasource, no business-table scan from a panel |
| Heaviest query class | `histogram_quantile` over a 5 m rate — bounded by bucket count |
| Sampler cost | grouped counts plus one ordered lookup; no row scans |
| Panels per board | 16–29 |

No optimisation was applied, because nothing measured showed a problem.

## U. Regression

| Suite | Result |
|---|---|
| Backend TypeScript | **exit 0** |
| Observability/IOC tests | **22 pass / 0 fail**, 351 assertions |
| Full backend suite (130 files) | **1888 pass / 15 fail** |
| Observability-related failures | **0** |

The 15 failures are the known pre-existing set (Chaos & resilience ×4, unnamed ×4, Enterprise
scalability ×3, Money matrix ×2, Failure recovery ×1, Adversarial ×1). Pre-existence was established
three independent ways: a clean-tree stash comparison, import-path analysis showing no dependency on
anything this phase touched, and two runs on an **identical tree** yielding 36 vs 15 failures — i.e.
the suite is nondeterministic under load, which is itself why a raw pass count cannot be read as a
verdict.

*Operational note:* `bun test` segfaults at startup on relative paths and on the full 130-file list;
absolute paths and two 65-file halves execute cleanly. Recorded so a future run does not read a
segfault as a failure.

## V. Production safety

| Guarantee | Evidence |
|---|---|
| No production deployment | none performed |
| No destructive migration | none applied to `homigo_db` |
| `homigo_db` untouched | bookings **497**, payments **302**, ledger **1792**, users **723**; latest booking `2026-09-03 20:29:13` — **predates this session** |
| Work isolated | `ai_conversations` created today: `homigo_db` **0**, `homigo_p39` **6** |
| Staging untouched | `git status` on `deploy/observability` — **empty** |
| Running environment not silently altered | Grafana auth left exactly as found, finding reported instead |

## W. Human decisions required

None of these can be closed by code without inventing a policy nobody agreed to.

| # | Decision | Why it is not ours |
|---|---|---|
| 1 | Alert thresholds (outbox backlog/age, DLQ, job lag, workflow failures, AI failure/fallback) | "5 failures = alert" would create noise someone must answer at 3 a.m. |
| 2 | Alert owners | an alert without an owner is a notification nobody acts on |
| 3 | Stuck-job threshold | no canonical value exists in this project |
| 4 | Prometheus retention | silently decides how long an incident stays investigable |
| 5 | Dev Grafana authentication | changing a running environment's access could lock out its users |
| 6 | ML drift thresholds (PSI/KL) | `MEASUREMENT_ONLY` until a tolerance is agreed |
| 7 | Platform ownership register | `OWNER_UNASSIGNED` — naming a person puts them on the hook for something they never accepted |

Every one has its **metric already in place**. What is missing is the judgement, not the plumbing.

## X. External artifacts required

| # | Artifact | Blocks |
|---|---|---|
| 1 | **BigQuery billing re-enabled** | ETL, warehouse freshness, forecast horizons, model training — the single root cause of the red ML board |
| 2 | `OPS_AUTH_TOKEN` in the production scrape config | scraping `/metrics` in production (the guard itself is correct and denies when unset) |
| 3 | A user-feedback capture surface | AI feedback metrics — no source exists anywhere in the platform |
| 4 | Production ground-truth capture | prediction-accuracy metrics |

## Y. Known limitations

- **User feedback is not measured** — no signal exists; no panel drawn rather than one showing a
  fabricated zero.
- **Production prediction accuracy is not measurable** — needs predictions paired with later outcomes;
  only shadow predictions carry that and nothing serves in production.
- **Distribution drift (PSI/KL) is not computed** — freshness and horizon expiry are today's drift
  signals.
- **Feature health is an API result, not a time series** (`/api/admin/ml/readiness`).
- **Last-trained lives in BigQuery, not Prometheus.**
- **Percentiles over small samples are unstable** — read latency beside the rate panels.
- **Cumulative counters reset on restart** — stated on the one panel that shows a total.
- **Retention is undefined** — Prometheus runs on its image default.
- **A second, unmounted dashboard tree** exists at `apps/backend/monitoring/grafana/dashboards`
  (11 files, mounted by no running container). Left alone; adopting or deleting it is not a Phase-13
  decision.
- **A residual same-line false positive** remains in the prompt firewall from the Phase-11 fix,
  documented in its test rather than papered over.

## Z. Final scope closure

| Requirement group | State |
|---|---|
| Metric inventory verified source-to-panel | **CLOSED** — `PHASE_13_FINAL_METRIC_AUDIT.md` |
| Dashboard audit (datasource, query, window, aggregation, empty/error state) | **CLOSED** — `PHASE_13_FINAL_DASHBOARD_AUDIT.md` |
| E2E and fault matrix | **CLOSED** — `PHASE_13_FINAL_E2E_MATRIX.md`, 12/12 + 12/12 + 7/7 |
| Security and RBAC | **CLOSED with one finding** — `PHASE_13_FINAL_SECURITY_AUDIT.md`, 10/10 probes |
| Documentation reflects actual state | **CLOSED** — `PHASE_13_INTELLIGENCE_OPERATIONS_RUNBOOK.md` updated for D1/D2/D3 and the demonstrated auth finding |
| Zero / UNKNOWN / ERROR discipline | **CLOSED** — no exception remains |
| No fabrication | **CLOSED** — 9 fabricated observations removed and proven absent by real traffic |
| Production safety | **CLOSED** — `homigo_db` untouched, staging untouched, nothing deployed |
| Alerts | **`ALERT_POLICY_UNSET`** — metrics exist, thresholds/owners are §W |
| Feedback / accuracy / drift thresholds | **`NOT_AVAILABLE` / `MEASUREMENT_ONLY`** — §X, §Y |

**No scope was silently expanded.** No Capability 13, Phase 12.1 or Phase 13.1 was invented. No new
alert rule, no new observability stack, no new ML engine.

**Verdict: `PHASE_13_COMPLETE_WITH_FOLLOWUPS`.**

The Intelligence Operations Center is operational and, more importantly, **honest under failure** —
which the three defects found here prove it was not before. Everything still open is a decision or an
external artifact, held open deliberately rather than closed with an invented value.
