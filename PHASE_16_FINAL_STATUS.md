# PHASE 16 — FINAL STATUS

**Verdict:** `PHASE_16_COMPLETE_WITH_FOLLOWUPS`
**Environment of record:** staging (`homigo_staging_db`)
**Date of closure:** 2026-09-07

---

## 1. Status line

Phase 16 engineering is complete and operationally validated in the available non-production
environment. All in-scope agentic capabilities have reached their strongest evidence-backed state.
Production LIVE verification remains a release follow-up because no production runtime is available
in the current environment.

---

## 2. Production status — stated explicitly

| Item | Status |
|---|---|
| Production runtime | **NOT AVAILABLE** |
| Production traffic | **NOT VERIFIED** |
| Production canary | **NOT VERIFIED** |
| Production LIVE status | **NOT VERIFIED** |

Every claim in this document is a **staging** claim. Staging, local, clone and test environments
are not production and are not described as such anywhere in these artifacts.

---

## 3. Scope delivered

Five governed agents, in `apps/backend/src/agents/` — 16 modules, 4 811 lines.

| Agent | Role | Capabilities | Writes | Read-only |
|---|---|---|---|---|
| Support | SUPPORT | 7 | 2 | no |
| Operations | ADMIN | 8 | 1 | no |
| Partner Operations | ADMIN | 4 | 1 | no |
| Finance Assistant | ADMIN | 7 | **0** | **yes** |
| Fraud Investigation Assistant | ADMIN | 6 | **0** | **yes** |
| **Total** | | **32** | **4** | |

25 Phase-16 tools (23 READ, 2 WRITE), 25 handlers, **0 unhandled**.

---

## 4. Governance architecture

**The agent, not the role, is the authorisation subject.** Four of the five agents necessarily run
as `ADMIN`, so role RBAC cannot distinguish the Finance Assistant from the Fraud Assistant — to the
policy engine they are the same actor. The registry is a distinct allowlist layered on top of
everything Phase 5 already enforces; an agent must pass **both**.

**Capability→tool indirection.** The model plans in capability names and never sees a tool id, so a
plan cannot name a tool outside its agent's vocabulary.

**The request is authorised, not only the actor.** Intent resolution refuses a change under a
request that only asked for information — the one check no other control could make, because by the
time a plan reaches policy, "why did this fail" and "fix this" are indistinguishable.

### Enforced invariants (verified against live staging rows)

| Invariant | Observed |
|---|---|
| Read-only agents never executed a side effect | **0** |
| HIGH-risk steps executed autonomously | **0** |
| Stranded runs | **0** |
| Writes without a post-condition | **0** |
| Tools reachable without a handler | **0** |

---

## 5. Evidence — Phase-16 suites

| Suite | Result |
|---|---|
| Base certification | 47 PASS / 0 FAIL |
| Live execution | 8 PASS / 0 FAIL / **1 BLOCKED** (`K5`) |
| Integration (event · scheduler · recovery) | 14 PASS / 0 FAIL |
| Event producers | 12 PASS / 0 FAIL |
| True end-to-end flows | 11 PASS / 0 FAIL / **1 BLOCKED** (`T3`) |
| Observability self-test | 10 PASS / 0 FAIL |
| PII & isolation | 12 PASS / 0 FAIL |
| Chaos & concurrency | 11 PASS / 0 FAIL |
| Migration guard self-test | 13 PASS / 0 FAIL |
| Intent · clarification · freshness | 44 PASS / 0 FAIL |
| Guard removal (core) | **7/7 LOAD-BEARING** |
| Guard removal (request-intent, clarification, freshness) | **6/6 LOAD-BEARING** |
| Red team | 12 CONTAINED / 0 BREACH |
| Forensic second pass | 29 OK / 0 FINDINGS |

**236 checks, 0 failures, 2 provider-blocked.**

13 guards total were broken on purpose and observed to fail, then restored and verified by sha256.
> **On the total.** An earlier run of the same suites reported 237. This closure run reports 236,
> because free-tier AI provider quota converted one live-execution check from PASS to BLOCKED
> (`K5`), while chaos recovered one (11 rather than 10). The count moves between runs *only* along
> the provider-availability axis; no check changed from PASS to FAIL at any point. The number above
> is this run's, not the best run's.


### Invariants asserted against live staging rows

Not against the registry's own declarations — a registry that says "finance is read-only" and a
database that shows a finance write are the same claim checked two different ways, and only the
second is evidence.

| Assertion | Observed |
|---|---|
| Distinct tool ids executed by agents | 18 |
| Executed outside the executing agent's vocabulary | **0** |
| HIGH_RISK or money-moving tools ever executed | **0** |
| Executed write steps with no verification record | **0** |
| Read-only agent side effects | **0** |
| Stranded runs | **0** |

Distinct tools exercised per agent: support 5 · fraud 5 · finance 4 · operations 4 ·
partner-operations 0 (see the note below).


### One agent has not exercised tool execution

`partner-operations` has 13 runs on staging (7 LIVE FAILED, 6 LIVE COMPLETED, 6 SHADOW FAILED) and
**zero executed tool steps**. Every one of its 13 failures is a planner failure — 12
`PLANNER_UNAVAILABLE` and 1 `PLANNER_MALFORMED` — so the cause is free-tier provider quota, not a
defect in the agent.

What *is* proven for this agent: registry validation, plan validation, the event path end-to-end
(`U1` — a real partner pause drives a run through the outbox), and its read-only/write boundaries.
What is **not** proven: that its three reads and one notification write execute correctly against
live services. Stated rather than glossed, because "4 of 5 agents have exercised real tool
execution" is the accurate claim.


### Regression

**2007 pass / 30 fail** across 141 files. All 30 failures are environmental and none is in the
agent layer:

- 21 × connection-pool exhaustion (`connection limit: 5`, against tests firing 50–500 concurrent
  operations)
- 9 × write conflict / deadlock inside those same concurrency tests
- BigQuery `Could not load the default credentials` — a standing external blocker

Verified, not assumed: zero occurrences of "agent" in the regression log; the only test file that
imports the agent layer passes **5/5**; database isolation held (`homigo_test` +150 bookings,
`homigo_db` **+0**).

---

## 6. Live staging run state

```
runs=305   steps=579   stepsWithToolExecution=172   outboxEvents=188
mode:    LIVE=218  SHADOW=87
trigger: MANUAL=214  EVENT=91
status:  COMPLETED=108  FAILED=195  ESCALATED=1  TIMED_OUT=1
strandedRuns=0   highRiskStepsExecuted=0   readOnlyAgentSideEffects=0
```

**The 195 FAILED runs are accounted for, not hidden:**

| Cause | Count | What it means |
|---|---|---|
| `PLANNER_UNAVAILABLE` | 153 | Free-tier AI provider quota (GROQ 429 → GEMINI 503). The runtime **failed closed**, which is the designed behaviour. |
| `PLANNER_BLOCKED` | 20 | The prompt firewall refused an injection. A **security success** recorded as a failed run. |
| `PLANNER_MALFORMED` | 11 | Model returned prose instead of a plan; refused rather than coerced. |
| `EXECUTION_ERROR` | 6 | Tool-layer errors during fault-injection tests. |
| `TICKET_NOT_FOUND` | 3 | Deliberate negative-path tests. |
| `PLAN_TOO_LONG` | 2 | Bound enforcement firing. |
| `INTENT_FORBIDS_SIDE_EFFECT` | 1 | The §8 control firing in a **live run**, not merely in a unit test. |

`COMPLETED` includes 15 runs stopped with `EMPTY_PLAN` — the model correctly answering "I cannot
serve this with the capabilities I hold", which is a correct outcome rather than a failure.

---

## 7. Security status

| Control | Status |
|---|---|
| Prompt injection | 12/12 CONTAINED, 0 BREACH |
| Cross-agent privilege escalation | Refused — capability not in vocabulary |
| Cross-tenant / memory isolation | 12 PASS |
| PII in prompt, plan, args, results, logs, audit, metrics | 12 PASS, Luhn-validated, negative-controlled |
| Finance boundary — no autonomous money movement | **Structural**: 0 write capabilities exist |
| Fraud boundary — no autonomous punishment | **Structural**: 0 write capabilities exist |
| High-risk actions | Always escalated to a human; no autonomous path exists |
| Recursion (depth + ancestry cycle) | Enforced, guard-removal proven |
| Budget / rate limits / loop bounds | Enforced, guard-removal proven |
| Audit | Mandatory, non-swallowed, `recordGoverned` |

Both read-only boundaries are enforced in **three independent places**: the registry throws at
module import (the backend refuses to boot), the plan validator refuses, and `disposeStep`
escalates.

---

## 8. Event architecture

Real domain events through the transactional outbox — `support.ticket.created`,
`ops.alert.raised`, `partner.paused`. 188 outbox events recorded; 91 event-triggered runs.

Verified: a failed transaction publishes no event; a suppressed alert publishes no event; a
committed alert publishes exactly one; replay creates no second run (two-level idempotency —
run key and step key).

---

## 9. Observability

20 metric series emitted and zero-seeded. Grafana dashboard `homigo-agents.json` — **14 panels**.
Alert rules `homigo-agent-alerts.yml` — **7 rules**: plan rejection, recursion prevention,
post-condition failure, post-condition UNKNOWN, bounds hit, inference cost spike, live-but-failing.

**Known gap:** two metric series added in the final pass —
`homigo_agent_freshness_total` and `homigo_agent_stale_evidence_blocked_total` — are emitted and
zero-seeded but have **no dashboard panel and no alert rule**. Recorded as a follow-up rather than
fixed, because dashboard work is out of scope at closure.

---

## 10. UI — Agent Control Center

| Route | Purpose | Bundle |
|---|---|---|
| `/agents` | Fleet command center | 7.93 kB |
| `/agents/[agentId]` | Agent workspace + command surface | 7.59 kB |
| `/agents/runs/[runId]` | Run timeline with authoritative tool rows | 5.3 kB |

Ten operational states, each derived server-side from a real signal. One state vocabulary
(`lib/agent-states.ts`) so no two screens can disagree. Three rules enforced in one place: UNKNOWN
is never green, WAITING_APPROVAL is amber not red, BLOCKED is never styled as OFF. `null` renders
as "Insufficient data", never `0`.

The command surface shows the resolved intent and whether the run may act **before it starts** — a
refusal is only a good answer if the screen said it was coming. There is no tool picker and no
argument editor: that would be a second, ungoverned execution path wearing the styling of the
governed one. No approval buttons — approvals stay on the existing surface that already carries
non-self-approval and single-consume.

Admin panel: 0 type errors, build exit 0.

---

## 11. Migration safety

`scripts/check-migration-safety.ts` is wired into `prebuild`, alongside the log-governance gate.
Current run: **OK — 40 new/modified migration files scanned, no protected object dropped.**
Self-test: 13 PASS (a known-bad diff fails, a safe diff passes).

**Standing hazard, retained:** `prisma migrate diff` can generate destructive changes around the
protected booking-slot objects. Always hand-scope a migration touching them. The guard blocks new
destructive drops; it does not rewrite history.

---

## 12. Known follow-ups

1. **Production runtime / deployment** — the single blocker.
2. **Production canary** — cannot run where there is no production.
3. **Production verification** — required before any `PHASE_16_COMPLETE` claim.
4. **AI provider quota (T3 / K5)** — free-tier limits produce `PROVIDER_ERROR`. Reported
   **BLOCKED**, never converted to a PASS. The provider is **not** healthy.
5. **Dashboard coverage for the two freshness metric series** (§9 above).
6. **`intel()` stamps `generatedAt` after the cache read**, so it reports serve time under a name
   that reads as computation time. The freshness gate already prefers the correct field
   (`freshness`); renaming is a separate owner's call.
7. **High-concurrency tests exceed the 5-connection pool** — pre-existing.
8. **Migration history drift** — 6 historical drops that were correct when written.
9. **Load behaviour unmeasured** — no 1k/10k/100k agent-run load test.
10. **Database and Redis outage mid-run** not injected.
11. **Customer / partner autonomous surfaces remain unexposed** — release governance and production
    readiness are not available, so the §66 bar is not met. A deliberate refusal.

---

## 13. Exact next release prerequisite

> A deployed production runtime with a production authentication mechanism, and a controlled canary
> rollout observed against real production traffic, with all five agent flags starting at OFF.

Until that exists, the verdict cannot move past `PHASE_16_COMPLETE_WITH_FOLLOWUPS` without
fabricating the one thing §75 forbids fabricating.

---

## 14. Closure

Phase 16 implementation is **closed**. No further Phase-16 engineering is to be started — no
Phase 16.6, no new agent types, no new dashboards, no new capabilities — unless assigned as a new
phase.
