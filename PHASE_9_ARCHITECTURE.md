# Phase 9 — Architecture

Derived from `PHASE_9_DISCOVERY.md`. Every decision below names the existing thing it reuses.

---

## Governing shape

```
authoritative domain services  (finance, geo, weather, fraud, digital twin)
        |
        v
ExecutiveIntelligenceContext   <- adds provenance + state; computes no business number
        |
        v
ExecutiveEvidence / ExecutiveInsight   <- extends the Phase-8 evidence contract
        |
        +--> deterministic Executive Brief        (always available)
        +--> LLM narrative via existing AI Gateway (optional, never authoritative)
        +--> Recommended actions                   (SHADOW)
                    |
                    v
        existing AiToolApproval engine  (frozen)  -> human approval -> existing business service -> ActivityLog
```

The one-line rule: **the context adds provenance, never numbers.**

---

## 1. Reuse, not rebuild

| Need | Existing thing used | Why not new |
|---|---|---|
| Evidence + provenance contract | Phase-8 `InsightEvidence` / `ExplainableInsight` | Already solves "every fact names its source, freshness, state and confidence" and is tested. Extending it keeps one evidence model across partner and executive surfaces. |
| Approval | `ai-tools/approval/approval-engine.ts` + `AiToolApproval` | Already has `argumentsHash` binding, one-time consumption, expiry and multi-approver. A second engine would be a second answer to "was this authorised". |
| High-risk actions | The 14 `high_risk.*` tools, all 0/14 bound | The safest possible executor is one that cannot execute. Binding a handler is explicitly out of scope. |
| Financial truth | `financeDashboardService`, `finance-analytics.service.ts`, ledger | The ledger is authoritative. Phase 9 reads; it never computes a financial total. |
| Demand staleness | `isDemandForecastStale()` (exported in Phase 8) | One definition of stale demand already exists and is shared. |
| Surge / supply | `geoIntelligenceService.surgePrediction()` | Deterministic, per-zone, with known anomalies already characterised. |
| LLM | `src/ai/gateway/ai-gateway.ts` | No separate executive provider path; failover, audit and model policy live there. |
| Prompt safety | `src/ai/security/prompt-security.ts` | Reused as-is, applied where untrusted text enters evidence. |
| Scheduling | `ScheduledJob` + `runScheduledJobTick` + `runWithLeaderLock` | The Phase-8 pattern. No second scheduler. |
| Delivery | notification router + governance | Intelligence code never touches an adapter. |
| Flags | `PlatformFeatureFlag` via `isFeatureEnabled` | Fail-closed, verified: absent = `FLAG_MISSING` = off. |
| Audit | `ActivityLog` | Existing audit surface. |
| RBAC | `rbac.service.ts` + `admin-route-permissions.ts` | Backend authorization stays authoritative; UI gating is supplementary. |

**Explicitly not created:** `ExecutiveIntelligenceEngineV2`, `FinanceAIEngineV2`, `FraudAIEngineV2`,
`RevenueAnalyticsV2`, `DemandEngineV2`, `AdminAIEngineV2`, `ApprovalEngineV2`, `ReportingEngineV2`.

---

## 2. ExecutiveIntelligenceContext

A provenance wrapper. Each section is a `Signal`-shaped value carrying `state`, `source`,
`observedAt`, `freshness`, `confidence`, `reasonCode` — the same vocabulary Phase 8 proved.

Sections: `revenue`, `finance`, `demand`, `supply`, `fraud`, `customers`, `partners`, `geo`,
`weather`, `operations`, `forecasts`, `digitalTwin`.

States: `OK | UNKNOWN | STALE | UNAVAILABLE | INSUFFICIENT_DATA | MODEL_UNAVAILABLE | DATA_QUALITY_ISSUE`.

Rules:

- The context **calls** `executiveReportingService.buildExecutiveReport()` and the geo/weather/twin
  services. It re-derives nothing.
- A missing section is a state, never `0`, `false`, `"normal"` or `"stable"`.
- `platformMarginPct` at zero GMV is surfaced as `DATA_QUALITY_ISSUE` rather than silently carried
  as `0`. The underlying service is left alone; the context reports what it sees.

### Temporal correctness

Periods are labelled, never mixed. `CALENDAR` (a named day/week/month), `ROLLING` (trailing N days —
what `buildExecutiveReport(days)` actually produces), `FORECAST` (a horizon that has not happened).
The existing report is rolling; a brief that called it "this month" would be wrong. Timezone comes
from the platform convention already used by `windowDateFor`.

---

## 3. Executive Brief

Deterministic first. Every statement is generated from a reason code, exactly as Phase 8's
`STATEMENTS` table works, and every number is present in the evidence.

Five classes are distinguished and never collapsed: `FACT`, `OBSERVATION`, `FORECAST`, `ANOMALY`,
`RECOMMENDATION`. A forecast rendered as a fact is the failure mode this separation exists to
prevent.

### LLM boundary

The gateway receives structured facts only, and may summarise, prioritise, narrate and connect
already-established facts. It may not invent a KPI, compute a total, decide fraud, choose a refund
amount, assert causation, override policy or bypass approval.

If the provider fails, the deterministic brief is unchanged — the narrative is simply absent, and
`narrativeSource` says `UNAVAILABLE`. Model identity (`provider`, `model`, `modelVersion`, latency,
tokens, fallback) is recorded explicitly; a narrative is never claimed when no provider was called.

---

## 4. Revenue anomaly

No detector and no threshold exist. Order is therefore: **measure the real distribution, publish it,
and stop** — the threshold is `HUMAN_DECISION_REQUIRED`, held in a typed `UNSET` policy exactly like
Phase 8's `morningSchedule` and `surgeAlertPolicy`. With the policy unset, no series can be
classified anomalous; the honest outcome is `NOT_EVALUATED`, never "normal".

Detection and explanation stay separate. "Revenue decreased 18% versus the previous 7-day period" is
a measurement; "demand was lower in the same period" is a co-observation offered as *possible*; "because
customers stopped booking" is a causal claim and is never produced.

---

## 5. Fraud narratives

The LLM explains an existing risk signal and never labels anyone. The narrative separates
`OBSERVED_SIGNAL`, `RULE_RESULT`, `RISK_ASSESSMENT` and `RECOMMENDED_HUMAN_ACTION`. Aggregates are
preferred; identity appears only where the action requires it, and sensitive fields are masked with
the existing privacy utilities.

---

## 6. High-risk framework and the Approval Center

```
AI recommendation (SHADOW)
  -> policy / rules check
  -> createApprovalRequest()        [existing frozen engine]
  -> human decides                  [decideApproval]
  -> consumeApproval()              [one-time, argumentsHash-bound]
  -> existing business service
  -> ActivityLog
```

The LLM never reaches a database mutation, a wallet, a ledger, a refund or a freeze. Three
independent barriers already stand between a recommendation and an effect: the handler is unbound
(0/14), the approval binds to an `argumentsHash` so it cannot widen, and consumption is one-time so
it cannot replay.

`/admin/approvals` extends the existing surfaces rather than replacing `ai-brain/approvals` or
`partner-acquisition/approvals`.

**RBAC:** mapped onto the existing `AdminResource` enum. No new resource is invented — which value
governs executive intelligence and high-risk approval is `HUMAN_DECISION_REQUIRED`.

---

## 7. Scheduled reports

Reuse `ScheduledJob` + leader lock. **No schedule is chosen.** As in Phase 8, an unset schedule
cannot create an execution, and the time is `HUMAN_DECISION_REQUIRED`. Delivery goes through the
governed notification path; intelligence code never invokes email, Slack or push directly.

---

## 8. Feature flags

Created only when a surface exists to gate. Candidates: `ADMIN_EXECUTIVE_INTELLIGENCE`,
`ADMIN_EXECUTIVE_BRIEF`, `ADMIN_AI_RECOMMENDATIONS`, `ADMIN_HUMAN_APPROVALS`. All OFF, fail-closed,
environment-scoped, and **no row is written to `homigo_db`** — absence already evaluates to off.

---

## 9. Certification

Per capability, using the existing mechanism appropriate to its type — no generic new framework:

| Type | Capabilities | Path |
|---|---|---|
| Read-only intelligence | context, brief, KPI explanations, narratives, forecast explanations | No automation certification applies (as with Phase-8 Item 8) |
| Governed recommendation | recommended actions, high-risk suggestions | SHADOW + existing `AiToolApproval` |
| Scheduled report | daily brief | Workflow certification, blocked on schedule |

No self-certification. No LIVE activation. Phase-7 and Phase-8 signed evidence is not modified.

---

## 10. Side-effect and security posture

Read-only intelligence produces zero mutations, verified before/after across bookings, payments,
payouts, wallet, ledger, refunds, adjustments, notifications, outbox, workflow instances, audit and
security events. Approval-flow tests that mutate run **only** on the isolated database; no refund,
wallet, ledger or adjustment is executed against `homigo_db` to prove a flow.

Security matrix (401, 403, forged admin, wrong role, resource spoof, IDOR, cross-admin isolation,
prompt injection, approval spoof/replay/expiry/scope) is tracked in `PHASE_9_SECURITY_MATRIX.md`.
