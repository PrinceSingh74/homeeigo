# HOMEEIGO — Observability, Pass 4

**Everything below is runtime-measured against the running stack on 2026-09-21. No claim here rests on reading a file.**

Pass 3 ended with "114 rules loaded, 0 health errors" and called observability fixed. It was not. The
rules were correct and the pipeline under them was not connected. This pass took the stack apart in
the order a signal actually travels — exposition → scrape → rule → route → receiver — and found a
defect at four of those five stages.

---

## 1. The stack was scraping a port nothing has ever listened on

`_obsstack/prometheus.yml` targeted `host.docker.internal:3010`. The backend reads `PORT` from
`.env` and serves on **3000**.

```
target homigo-backend -> down ("connection refused")
```

Every one of the 114 rules keyed on a `homigo_*`, `financial_*`, `payment_*` or `redis_*` series was
therefore evaluated against no data. **114 healthy rules, none of them able to fire** — including
every money-integrity alert, and including the refund-backlog alerts whose conditions were
demonstrably true in the database at that moment.

This is the failure mode that matters most in monitoring: the system reports full coverage on
`/api/v1/rules`, `promtool` validates, health is `ok` across the board, and nothing is watched.
Pass 3 measured all three of those things and concluded observability was healthy.

**Fixed** → port 3000. After the restart:

```
target homigo-backend -> up ()
alert rules loaded: 113   health=ok : 113
```

and, for the first time, alerts with values attached:

```
FIRING   FinanceIntegrityFailure       value = 52.3
FIRING   FinancialIntegrityBelow100    value = 92
```

The ₹32 wallet drift root-caused in `enterprise-2035-finance-reconciliation.md` had been true for
the entire life of this stack. This is the first moment it was ever alerted on.

### A defect I introduced and then removed

While fixing the target I added a second scrape job for `/ready`, reasoning that a readiness probe
is a health signal. `/ready` answers **200 with `application/json`**, which Prometheus cannot parse
(`received unsupported Content-Type`), so the job was a permanently-down target.

That is worse than no job. A target that is always down teaches everyone to ignore target-down
alerts — and target-down was the one signal that would have caught the wrong port years earlier. The
job was removed from both configs and a test now forbids it.

---

## 2. `DatabaseDown` could not distinguish an outage from a healthy database

```yaml
- alert: DatabaseDown
  expr: up{job="homigo-ready"} == 0
```

The reasoning was sound — `/ready` returns 503 when the database is unreachable, so the scrape would
fail. The premise was not: that target failed on *every* scrape regardless of database state, for
the Content-Type reason above. The alert was permanently true, which means a database outage and a
perfectly healthy database produced identical output.

`redis_up` had existed as a 0/1 gauge since the beginning. There was no database counterpart.

**Fixed.** `src/lib/metrics.ts` gained `registerDatabaseMetricsProvider`, `src/lib/prisma.ts`
registers a `SELECT 1` probe, and the alert became:

```yaml
expr: database_up == 0 and on() up{job="homigo-backend"} == 1
```

The `and on()` guard means a backend that is itself down raises `BackendDown` rather than both.

**Proven in both directions**, which is the part that matters for a gauge whose whole job is to be 0
exactly once in a blue moon:

| Condition | `/metrics` emits |
|---|---|
| live database | `database_up 1` |
| unreachable `DATABASE_URL` | `database_up 0` |

---

## 3. Alert delivery — **PROVEN to the receiver**, still `EXTERNAL_BLOCKED` to a human

### What was measured

Before the probe, Alertmanager had never handled an alert in its life:

```
alertmanager_alerts_received_total{status="firing"}  0
alertmanager_alerts{state="active"}                  0
```

The running stack's Alertmanager routes **everything** — default, critical and warning — to one
receiver, `homigo-cert-webhook` at `host.docker.internal:45678`. Nothing listens on 45678; it
belongs to a certification harness that only runs during cert runs:

```
POST http://127.0.0.1:45678/webhook -> connection failed
```

### The probe

A disposable listener was bound to 45678 and left up while the repaired scrape let the real alerts
mature past their `for:` durations. Three webhook notifications arrived, carrying real conditions:

```
POST /webhook {"receiver":"homigo-cert-webhook","status":"firing",
  "alerts":[{"labels":{"alertname":"PaymentSuccessRateLow","priority":"P0",...}}], ...}
POST /webhook {"receiver":"homigo-cert-webhook","status":"firing",
  "alerts":[{"labels":{"alertname":"FinancialIntegrityBelow100",...}}, ...]}
POST /webhook ... FinanceIntegrityFailure ...
```

Before the listener existed, Alertmanager logged `POST http://host.docker.internal:45678/webhook
failed` — so the *failure* path is confirmed too, not assumed.

### Verdict — stated precisely

| Hop | Status | Evidence |
|---|---|---|
| exposition → scrape | **VERIFIED** | target `up`, values present on alerts |
| scrape → rule evaluation | **VERIFIED** | 113/113 `health=ok`, alerts carry live values |
| rule → Alertmanager | **VERIFIED** | `activeAlertmanagers: http://alertmanager:9093/api/v2/alerts`; alerts received |
| Alertmanager → receiver | **VERIFIED** | full webhook payloads captured, both success and failure paths |
| receiver → a human | **EXTERNAL_BLOCKED** | see below |

**`ALERT_DELIVERY = EXTERNAL_BLOCKED` for the human hop, and this is not a formality.** In the local
stack the single receiver is a port that is normally closed, so notifications are dropped silently.
In `monitoring/alertmanager.yml` the Slack, SMTP and PagerDuty credentials are deploy-time
placeholders (`${SMTP_SMARTHOST}` and similar) — inventoried by name only, never read. No human
delivery has been observed and none is claimed.

A local-stack note worth acting on separately: routing every severity to a cert-harness port means
the dev stack's alerting is inert by construction. That is a deliberate choice for a cert fixture,
but it should not be mistaken for a working local pipeline.

---

## 4. OBS-7 (P2, FIXED) — one condition, two alerts, two different routes

`FinancialIntegrityBelow100` was defined **twice**: `homigo-alerts.yml` with a bare
`severity: critical`, and `homigo-enterprise-alerts.yml` with `priority: P0`, `team: L3` and a
runbook. Every `prometheus.yml` lists both files.

Caught empirically, not by inspection — the captured webhook payload carried both:

```
"alertname":"FinancialIntegrityBelow100", "severity":"critical"
"alertname":"FinancialIntegrityBelow100", "severity":"critical","priority":"P0","team":"L3"
```

The damage is not noise. Alertmanager deduplicates on the label set, so two different label sets can
never dedupe; and because the bare copy had no `priority`, it fell past the P0 route in
`alertmanager.yml` to the ordinary critical receiver. One ledger drift paged two chains, one of them
wrong, and the copy without the runbook arrived alongside the copy that had it.

**Fixed** by deleting the weaker copy. Runtime confirms `FinancialIntegrityBelow100 definitions: 1`.

---

## 5. OBS-8 (P2, FIXED) — a P0 that fired *because* nothing was happening

```yaml
expr: 100 * sum(increase(payment_success_total[15m]))
      / clamp_min(sum(increase(payment_success_total[15m]))
                  + sum(increase(payment_failed_total[15m])), 1) < 95
```

`clamp_min(denominator, 1)` avoids a divide-by-zero by substituting the worst possible answer. With
no payments the numerator is 0, the clamped denominator is 1, and `0 < 95` pages a P0.

Observed doing precisely that:

```
FIRING  PaymentSuccessRateLow  value = 0
payment_success_total 0
payment_failed_total  0
```

**Fixed** by dividing by the true denominator. `0/0` is `NaN`, every NaN comparison is false, so an
idle window is silent while real traffic is measured normally. There was never a divide-by-zero to
avoid — `NaN` is the correct answer to "what fraction of no payments succeeded".

After the restart the alert is gone from the active set while every genuine condition remains.

### Why only this one

`clamp_min` appears 8 times. The direction of the comparison decides whether it is harmful:

| Comparison | Effect of the clamp when idle | Verdict |
|---|---|---|
| `< threshold` (success rates) | `0/1 = 0`, below any threshold → **fires** | defect |
| `> threshold` (failure rates) | `0/1 = 0`, below any threshold → silent | harmless |

Only `PaymentSuccessRateLow` is a `<`. The other seven — dispatch timeouts, API 5xx, Gemini
failures, mobile startup failures, agent outcomes — are all `>` and were left alone.

---

## 6. OBS-9 (P3, OPEN — owner decision) — `ProviderAcceptanceLow` on a sample of one

`provider_acceptance_rate` is **not** a vacuity defect, and I checked before assuming it was.
`src/lib/acceptance-rate.ts` exists specifically to return `null` rather than fabricate 0 or 100 for
an empty window, and `metrics-samplers.ts` converts that to `NaN`, which PromQL will not compare.
The design is right.

The live 0 is a real measurement:

```
window: last 24h   terminal: 1   accepted: 0   by status: TIMEOUT=1
verdict: REAL EVIDENCE -> 0% is a measurement
```

But one timed-out offer is not a rate, and `provider_acceptance_rate < 60` pages on it. The module
already argues that 0 is a fabrication when `n = 0`; at `n = 1` it is barely less so.

**Not fixed, deliberately.** The correct minimum sample size is a business judgement, and inventing
a number here would be exactly the fabrication this audit is supposed to catch. Recommended shape:
publish the denominator as its own series and guard the alert with
`and on() provider_acceptance_sample_total >= N`, with `N` set by the owner.

---

## 7. Regression coverage

`src/__tests__/observability-scrape-config.test.ts` — 9 assertions on the plumbing rather than the
rules, because the rules were never the problem:

| Assertion | Defect it pins |
|---|---|
| scrape target port == backend `PORT` | the 3010 target |
| no `/ready` scrape job in either config | the unparseable target |
| every `up{job=...}` in a rule matches a real scrape job | alerts keyed on jobs that do not exist |
| `database_up` gauge exists and is registered from `lib/prisma` | the missing DB signal |
| the provider's `catch` sets 0 rather than dropping the series | a gauge that vanishes when it matters |
| `DatabaseDown` keys on `database_up`, guarded by `homigo-backend` | the permanently-true alert |
| no alert name defined twice across the three files | OBS-7 |
| no `/ clamp_min(...)` in an expression compared with `<` | OBS-8 |

**Proven non-vacuous.** Reintroducing the defects — port back to 3010, `DatabaseDown` back to
`homigo-ready`, the duplicate alert re-appended, `clamp_min` restored — failed 3 then 2 of these
assertions by name. Restoring returned 9/9 green and the drift gate to exit 0.

One of those assertions was itself wrong on first run and is worth recording: it matched the
`homigo-ready` string inside the *comment* explaining why `homigo-ready` was removed. The comment
strip that fixed it then silently did nothing, because the rule files are CRLF and JavaScript's `.`
does not match a carriage return, so `/#.*$/` never matched a single line. A test that scans text
for a forbidden pattern is only as good as its ability to fail.

---

## 8. Status after Pass 4

| Item | Status |
|---|---|
| Rules loaded at runtime | **113**, `health=ok` on all 113 — `RUNTIME_VERIFIED` |
| Scrape target reachable | **VERIFIED** — `up`, was `down` for the stack's entire existence |
| Money-integrity alerts evaluating real data | **VERIFIED** — `FinancialIntegrityBelow100` firing at 92 |
| `DatabaseDown` able to fire | **VERIFIED** both directions |
| Alertmanager receives alerts | **VERIFIED** |
| Receiver receives notifications | **VERIFIED** — payloads captured |
| Human delivery | **EXTERNAL_BLOCKED** — no credentials, none fabricated |
| Duplicate alert definitions | **FIXED** (OBS-7) |
| Idle-window false P0 | **FIXED** (OBS-8) |
| Small-sample acceptance alert | **OPEN, P3** — owner-owned threshold (OBS-9) |
| Rule-copy drift gate | **PASS**, re-proven to fail on a modified mirror |
