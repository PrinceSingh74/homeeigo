# PHASE 16 — AGENT RUNTIME

**Implementation:** `apps/backend/src/agents/runtime/agent-runtime.ts`

---

## Lifecycle

```
CREATED → PLANNING → WAITING_POLICY → EXECUTING → VERIFYING → COMPLETED
                                    ↘ ESCALATED / FAILED / CANCELLED / TIMED_OUT / ROLLED_BACK
```

The state machine is enforced in `run-store.ts`, not trusted to callers. Terminal states have
**no outgoing edges at all** — a COMPLETED run that could be moved back to EXECUTING is a run
whose audit trail can be rewritten after the fact.

The guard is part of the `WHERE` clause, so check and write are one atomic operation:

```ts
await prisma.agentRun.updateMany({ where: { runId, status: current.status }, data: {...} })
if (result.count === 0) throw new AgentStateError("changed underneath transition")
```

Reading the status and then updating would let two processes both observe `EXECUTING` and both
advance it.

> **Certified — E1/E2.** `COMPLETED → EXECUTING`, `FAILED → EXECUTING`, `ESCALATED → EXECUTING`
> and `PLANNING → COMPLETED` are all refused.

### A real defect this caught

The first implementation returned `COMPLETED` directly from `EXECUTING`. That edge does not exist,
so the terminal transition was refused, the refusal was logged and swallowed, and the run was left
stranded in `EXECUTING` while the caller was told `COMPLETED`.

Measured: **6 runs stranded, 0 rows COMPLETED**, while every check in the suite passed. Two records
of the same run disagreed, and the stranded runs would have been swept as orphans forever.

Fixed by routing through `VERIFYING`. The check that would have caught it — **G2b**, asserting the
persisted status agrees with the returned status and `completedAt` is set — was added at the same
time, because the harness gap was as real as the bug.

## Bounds are checked before each step

```ts
const bound = boundExceeded(acc, bounds);   // steps, tool calls, elapsed, cost, tokens
if (bound) { recordAgentBoundHit(...); return { status: anyExecuted ? "COMPLETED" : "FAILED", stopReason: bound }; }
```

Checked before, never after. A bound evaluated after the work is a report, not a control.

## Idempotency at two levels

**Run level** — `agent:{agentId}:{triggerType}:{eventRef}:{subject}`, unique-indexed. Enforced by
the database, not by a preceding read: check-then-insert loses the race that matters most, which is
two workers handed the same replayed event at the same moment.

**Step level** — `agent:{runId}:{stepIndex}` handed to `executeTool`. A recovered or retried run
replays the same key, so the tool layer replays the original outcome instead of performing the side
effect twice. Keying on arguments alone would be wrong in the opposite direction: two legitimately
distinct steps that happen to look identical would collapse into one.

> **Certified — H1/H2, L5/L6.** Five concurrent deliveries → 1 run. Later replay → still 1 run.

## The `confirmed: true` decision

`write.confirmation_required` exists so a **human** sees a price or a fee before a booking changes.
An autonomous run has no human in the loop to show it to, so leaving `confirmed` false would make
every write step terminate in `REQUIRES_CONFIRMATION` and the agent could never act at all.

It is therefore asserted — **once**, and only for a step that has already survived every gate
above it: the layer is enabled, the environment permits execution, the flag is on, the capability
is on the agent's allowlist, the risk is within the agent's ceiling, and the agent is not
read-only. The consent that matters for an agent is the operator enabling it and the plan passing
policy. It is never inferred from anything the model said.

> **Certified — forensic F12a.** `confirmed: true` appears exactly once, positioned after the
> disposition gate.

## Recovery (§37)

`findOrphanedRuns()` returns non-terminal runs whose lease has expired. The sweep **never restarts
anything** — it cannot know whether an in-flight step's side effect landed, because the process
died in exactly that window.

| Persisted evidence | Recovered as | Why |
|---|---|---|
| No step reached the tool layer | `TIMED_OUT` | Safe; a human may start a fresh run |
| Any step EXECUTED / VERIFIED / INDETERMINATE / has an executionId | `ESCALATED` | A human must reconcile first |

This is why steps are written before **and** after every tool call rather than batched at the end:
the distinction is only drawable from persisted rows.

> **Certified — N1/N2/N3.** Clean orphan → `TIMED_OUT`. Dirty orphan → `ESCALATED` with a reason.
> A second sweep leaves terminal runs untouched.
