# PHASE 16 — OBSERVABILITY (FINAL)

## Grafana

**Dashboard 21 — Phase 16 Governed Agents**, `monitoring/grafana/dashboards/homigo-agents.json`,
deployed to `_obsstack/dashboards/`. 14 panels over the 18 agent series, loaded by the existing
directory provider (`HOMIGO Enterprise` folder). No second observability system — same Prometheus,
same Grafana, same provisioning.

A separate board rather than more panels on **20 — Enterprise AI Tools** because the two answer
different questions. Dashboard 20 answers *"what did the tool layer do"*; a failed post-condition,
an escalation and a recursion refusal are invisible there, because from the tool layer's point of
view the call was authorised, executed and returned. Panel 10 (*Agent tool calls/min by outcome*) is
the deliberate join between the two.

| Panel | Answers |
|---|---|
| 1 Agent live state | Which agents would actually execute right now |
| 2 Runs by mode | LIVE vs SHADOW volume |
| 3 Run outcomes | COMPLETED / FAILED / ESCALATED |
| 4 **Post-condition verdicts** | Tool said success, world disagreed |
| 5 Step disposition by risk | Every HIGH step must appear as ESCALATE |
| 6 Plan rejections | `UNKNOWN_CAPABILITY` = attempted escalation |
| 7 Admission refusals & loop prevention | Recursion, kill switch, rate limit |
| 8 Bounds hit | Steps, tool calls, elapsed, budget, tokens |
| 9 Escalations to humans | The finance/fraud and high-risk boundaries being exercised |
| 10 Agent tool calls | Join to dashboard 20 |
| 11 Run latency p50/p95 | Seconds, histogram |
| 12 Cost & tokens | Reported by the gateway's own accounting |
| 13 Duplicate suppression & orphan recovery | Idempotency and process death |
| 14 Plans accepted & mean plan length | Counter ratio, not a duration histogram |

Panel 1 charts the **effective** mode, which folds in all four conditions (layer enabled, kill
switch, environment allowlist, feature flag). A flag-only view would read LIVE for an agent the kill
switch has stopped — telling an operator something untrue at exactly the moment it matters.

## Alerts

`monitoring/rules/homigo-agent-alerts.yml` — **7 rules, validated by `promtool` inside the running
Prometheus container** (`SUCCESS: 7 rules found`).

| Alert | Severity |
|---|---|
| `AgentPlanRejectedUnknownCapability` | critical |
| `AgentRecursionPrevented` | warning |
| `AgentPostConditionFailed` | critical |
| `AgentPostConditionUnknown` | warning |
| `AgentBoundsHitFrequently` | warning |
| `AgentInferenceCostSpike` | warning |
| `AgentLiveButFailingEveryRun` | critical |

Deliberately **not** alerted on: escalation rate (the designed outcome for high-risk work — alerting
on it trains operators to treat correct governance as an incident), shadow-mode runs (the safe
state), and aggregate run failures (a provider outage produces a burst of clean, contained failures;
the AI-gateway alerts already cover provider health, and duplicating it would double-page).

## Self-test — 10 PASS / 0 FAIL

`scripts/phase16/observability-selftest.ts` scrapes the real `renderMetrics()` output — the same
text Prometheus reads — before and after driving the producers. Both directions are checked, because
only one of them catches a fake.

| Check | Property |
|---|---|
| W1 | Zero-seeded series are exposed before any run happens |
| W2 | A metric never produced is **absent**, not a fabricated zero |
| W3 | Driving the run producer moves the exposed counter |
| W4 | Verification verdicts reach the exposition format |
| W5 | Read-only escalations are observable |
| W6 | Cost accumulates as a real value (`delta=0.004200`), not rounded to zero |
| W7 | Latency is exposed as a histogram with `le` buckets |
| W8 | The live gauge carries its real value |
| W9 | Every `agent_id` label is one of the five known agents |
| W10 | **Every metric the dashboard queries is actually exposed** |

W10 is the check that closes the loop between the board and the exporter. It found a real gap: the
dashboard queried 18 metrics while only 5 series were seeded, leaving **9 showing NO DATA until
their first occurrence**. A panel that has never had a sample looks like a healthy flat line, and an
alert on a series that does not exist can never fire.

## Zero-seeding, and why it is not a fake zero

Seeding a counter at zero asserts only that the counter **exists and has counted nothing**, which is
true. A fake zero would report 0 for something actually non-zero or unmeasurable — nothing here does
that, and W2 proves the exporter does not invent values for unknown metrics.

Label sets are exactly the ones the board queries. Cardinality stays bounded: five agents × closed
enums, no ids. W9 asserts it from the exposition text.

## Two unit bugs found by reading the implementation

`observeHist` buckets against `DURATION_BUCKETS`, in **seconds**.

- **Latency** was passed in milliseconds — every run would have been filed in the overflow bucket,
  making the histogram read "everything is slow" regardless of reality. Fixed to `ms / 1000` and the
  metric renamed `..._seconds` so the unit is in the name.
- **Plan step count** was passed to `observeHist` too — a 3-step plan filed as "3 seconds", piling
  every plan into one bucket. Replaced with a counter pair whose ratio is the mean plan length.

Neither would have failed a test. A metric with wrong units still emits, still scrapes, and still
looks healthy on a dashboard.

## Health is not "the process is alive"

`checkAgentReadiness()` resolves every capability tool against `ai_tool_registry` and reports
`{ready, reasons, registrySeeded, missingTools}`, surfaced on `GET /api/agents` and as a banner in
the Agent Control Center.

It exists because of an observed failure: on a fresh staging database the agents reported **LIVE**,
planned correctly, and could execute nothing — every tool call died on a foreign-key violation at
the audit write, before the handler, with an opaque `EXECUTION_ERROR`. It fails closed, which is
right, but "silently broken" and "correctly refusing" must not look the same to an operator.

## Diagnosability fix

`agent_runs` recorded `PLANNER_UNAVAILABLE` with an **empty** `error_message`; the reason
(`PROVIDER_ERROR: Upstream AI provider failed`) lived only on the step row. An operator triaging a
spike of failed runs had to write a join to tell a provider outage from a spend cap from a blocked
prompt — three conditions needing three different responses. The run row now carries the reason.
