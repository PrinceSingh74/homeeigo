# PHASE 16 — CHAOS & FAILURE BEHAVIOUR

Everything below was **observed**, not designed on paper. Several were unplanned: the free-tier AI
providers rate-limited heavily throughout certification, which turned provider failure into a
naturally-occurring chaos condition rather than an injected one.

---

## Provider unavailability — observed repeatedly

Real router output during certification:

```
ai_provider_failover  GROQ FAILURE PROVIDER_RATE_LIMITED 429 (cooldown 5000ms)
                    → GEMINI SUCCESS 5953ms  fallbackDepth=1

ai_chain_exhausted    GROQ 429 → GEMINI 503 → GEMINI 429 QUOTA (cooldown 42800ms)
                    → PLANNER_UNAVAILABLE
```

**Behaviour:** the run fails closed. `status=FAILED`, `stopReason=PLANNER_UNAVAILABLE`, one PLAN
step recorded, nothing executed, run terminal with `completedAt` set. Failover through the existing
router works; when the whole chain is exhausted the agent stops rather than proceeding on nothing.

The runtime distinguishes three planner failures an operator responds to differently —
`PLANNER_BLOCKED` (firewall), `PLANNER_BUDGET` (spend cap), `PLANNER_UNAVAILABLE` (providers) —
because collapsing them hides a spend cap behind what looks like an outage.

**Effect on the harnesses:** the red-team suite initially reported 9/12 `INCONCLUSIVE`. That was
kept as `INCONCLUSIVE` rather than counted as containment, because reporting an undelivered attack
as contained would be counting a provider outage as a security control.

## Malformed model output — observed

Real occurrence: `status=FAILED stopReason=PLANNER_MALFORMED`.

**Behaviour:** `coercePlanShape` returns null, the run records a failed PLAN step and stops.
No repair, no coercion, no partial execution. Certified by C1 (prose) and C2 (JSON that is not a
plan).

## Unseeded tool registry — observed, and produced a product fix

On a fresh staging database every tool call failed:

```
Foreign key constraint violated: ai_tool_executions_tool_id_fkey
→ live run status=FAILED, executedSteps=0
```

**Behaviour:** fails closed — the audit row is written *before* the handler, so the tool never ran.
But the surfaced error was an opaque `EXECUTION_ERROR` naming neither the table nor the cause, and
the agents still reported `LIVE`.

**Fix:** `checkAgentReadiness()` now resolves every capability tool against the registry and
reports `{ready, reasons, registrySeeded, missingTools}`, surfaced on the API and as a banner in
the control center. "Silently broken" and "correctly refusing" must not look the same.

## Process death mid-run — injected

Two orphans created directly in the database with expired leases: one that never reached the tool
layer, one with an `EXECUTED` step carrying an execution id.

| Orphan | Recovered as | Evidence |
|---|---|---|
| Nothing executed | `TIMED_OUT` | `stopReason=ORPHAN_RECOVERED` |
| Side effect may have landed | `ESCALATED` | escalation reason set; never re-run |

A second sweep left both untouched (N3). The sweep **never restarts** — it cannot know whether the
in-flight step landed, because the process died in exactly that window.

## Concurrent duplicate delivery — injected

5 simultaneous deliveries of one event, twice (runtime H1, real consumer L6). One run each time;
the losers returned the winner's run id.

## Kill switch mid-flight — injected

Engaged, run attempted, released, run attempted again. `KILL_SWITCH` then normal operation — no
restart required, because the switch is read at call time rather than cached at boot.

## Flag store unreadable — designed and reviewed

`evaluateFlag` failure is caught and treated as **disabled**:

```ts
.catch(() => { logger.warn("agent_flag_lookup_failed"); return { enabled: false, reason: "LOOKUP_FAILED" }; })
```

Failing open here would mean a Redis outage silently promoted every agent to live.

## Audit write failure — designed and reviewed

`recordGoverned` throws when the enterprise audit row cannot be persisted. The runtime logs at
`SECURITY` and continues, deliberately: the audit points bracket a decision already recorded in
`agent_runs`/`agent_run_steps`, so aborting would leave a run half-advanced with no better record
than the one that just failed to write.

## Agent failure inside the event consumer — designed and reviewed

`agentTriggerConsumer` catches and logs. A failed agent run must never fail the event: the outbox
would retry the delivery, every other consumer of that event would re-run, and one broken agent
would turn a single event into a platform-wide redelivery storm.

## Bad scheduled payload — injected

`agent.scheduled_run` with `agentId: "not-a-real-agent"` **throws** (M3), so the scheduler's retry
policy exhausts and dead-letters it rather than re-running a nonsense job forever.

## Not tested

Database outage mid-run, Redis outage mid-run, and partial network failure between the backend and
a provider were not injected. Recorded as untested rather than described as passing.
