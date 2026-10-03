# PHASE 16 — CANARY & ROLLOUT

## The ladder

```
DRAFT → SHADOW → CONTROLLED (0% → 1% → 5%) → PRODUCTION
```

Implemented through the existing `platform_feature_flags` mechanism — no new rollout system. The
`rolloutPct` bucketing is deterministic (`sha256(flagKey:subjectId) % 100`), so a 1 % rollout is a
stable 1 % of subjects rather than 1 % of requests. A subject that is in stays in.

## Four conditions decide the mode, and all four must agree

```ts
if (!agentsConfig.enabled)   → REFUSED   // layer off
if (agentsConfig.killSwitch) → REFUSED   // switch pulled
if (!environmentAllowed())   → SHADOW    // allowlist, not deny-list
if (!flag.enabled)           → SHADOW    // missing row = disabled
else                         → LIVE
```

The environment check is an **allowlist**, deliberately. An unrecognised `APP_ENV` — a typo, a new
environment nobody has reviewed — lands on "not permitted", which a deny-list gets backwards.

A flag-store read failure is treated as disabled, not as an error to ignore. Failing open would
mean a Redis outage silently promoted every agent to live.

## Stages exercised on staging

| Stage | Configuration | Observed |
|---|---|---|
| No flag row | flag absent | `SHADOW · FLAG:FLAG_MISSING` (all 5) — **K1** |
| Flag disabled | `enabled=false` | `SHADOW · FLAG:FLAG_DISABLED` — **K2** |
| Canary 0 % | `enabled=true, rolloutPct=0` | `mode=SHADOW` — enabled but excluded — **K3** |
| Full rollout | `enabled=true, rolloutPct=100` | `LIVE · FLAG:FULLY_ENABLED` — **K4** |
| Live execution | as above | real tool call, `executedSteps=1` — **K5/K6** |
| Kill switch over a live flag | `AGENTS_KILL_SWITCH=true` | `KILL_SWITCH` — **K9** |

K3 is the one worth dwelling on: the flag is **on** and the agent still does not execute, because
the subject falls outside the bucket. That is the canary actually working rather than a
configuration that merely looks like one.

## Shadow mode is genuinely comparable (§41)

A shadow step is fully resolved, risk-classified, authorised and recorded — with the **exact
arguments that would have been used**:

```ts
status: "SHADOWED",
verification: { verdict: "NOT_APPLICABLE", check: "shadow", reason: "No side effect performed" }
```

Everything happens except the one thing that changes the world. That is what makes shadow output
comparable to a live run and to a human's decision; a shadow mode that skipped planning or
authorisation would only prove the agent can be switched off.

Observed distribution on staging: **LIVE=53, SHADOW=20** across 73 runs.

## Recommended production sequence

Read-only agents first — the worst case is a wasted inference call.

1. `AGENTS_ENABLED=true` with **no flag rows**. Every agent SHADOW. Observe for a period.
2. `PHASE16_FRAUD_INVESTIGATION_ASSISTANT` at 1 % → 5 % → 100 %. Structurally read-only.
3. `PHASE16_FINANCE_ASSISTANT` likewise.
4. `PHASE16_OPERATIONS_AGENT` at 1 %. First write-capable agent; its only write closes an alert.
5. `PHASE16_PARTNER_OPERATIONS_AGENT` at 1 %. Its write sends a notification to a partner.
6. `PHASE16_SUPPORT_AGENT` at 1 %. Its write closes a customer-visible ticket — widest blast
   radius, so last.

**Never enable all five at once** (§71).

## Promotion gates (§43)

Do not widen on "the LLM output looks good". Require, from the metrics:

| Signal | Gate |
|---|---|
| `homigo_agent_verification_total{verdict="FAILED"}` | zero — a tool reporting success while the world disagrees |
| `homigo_agent_verification_total{verdict="UNKNOWN"}` | near zero — checks that could not be performed |
| `homigo_agent_plan_rejected_total{code="UNKNOWN_CAPABILITY"}` | zero — a model reaching outside its vocabulary |
| `homigo_agent_loop_prevented_total` | zero in steady state |
| `homigo_agent_bound_hit_total` | rare; a rising rate means bounds are mis-sized or the agent is confused |
| `homigo_agent_escalation_total` | present and explicable — escalation is a designed outcome, not a defect |
| `homigo_agent_cost_usd_total` | within the per-run ceiling |

Escalation rate rising is **not** by itself a reason to hold. A high-risk-heavy period should
escalate more; the question is whether the escalations are the right ones.

## Rollback at any stage

Set the agent's flag `enabled=false`. Effect within the flag cache TTL —
`FLAG_DISABLE_PROPAGATION_MAX_MS` is 30 s worst case, immediate when the Redis invalidation
broadcast is delivered. For everything at once, `AGENTS_KILL_SWITCH=true`.

Neither undoes a side effect that already landed. Where one may have, the run is `ESCALATED` for
human reconciliation — compensation, not a fake rollback.
