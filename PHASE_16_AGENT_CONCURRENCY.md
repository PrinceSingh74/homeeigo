# PHASE 16 — CONCURRENCY & IDEMPOTENCY

## Two levels of idempotency, doing different jobs

**Run level** — `agent:{agentId}:{triggerType}:{eventRef}:{subject}`, unique-indexed on
`agent_runs.idempotency_key`. Answers *"is this the same trigger?"*

**Step level** — `agent:{runId}:{stepIndex}`, handed to `executeTool`. Answers *"is this the same
side effect?"*

The step key is deliberately **not** derived from arguments. Two legitimately distinct steps that
happen to look identical would collapse into one — the same reason the Phase-5 engine anchors its
key on the approval rather than the argument hash.

MANUAL runs get **no** run key: a human asking the same question twice means it twice.

## Enforced by the database, not by a read

```ts
try { await prisma.agentRun.create({ ... }) }
catch (err) { if (code === "P2002") return { created: false, reason: "DUPLICATE" } }
```

A check-then-insert loses the race that matters most here — two workers handed the same replayed
event at the same moment — and losing it means two runs, two plans and potentially two side effects
for one real-world cause. The unique index is the arbiter; `P2002` is the expected outcome for a
duplicate trigger, not an error.

## State transitions are atomic

The status guard is part of the `WHERE` clause:

```ts
updateMany({ where: { runId, status: current.status }, data: { status: to } })
if (result.count === 0) throw new AgentStateError("changed underneath transition")
```

Reading the status and then updating would let two processes both observe `EXECUTING` and both
advance it. On a lost race the runtime **refuses** rather than retrying — the other writer may have
terminated the run, and forcing the transition would overwrite that.

## Evidence

| Check | Scenario | Result |
|---|---|---|
| H1 | 5 concurrent deliveries of one event (runtime) | `runsCreated=1 suppressed=4/5` |
| H2 | Same event replayed later | `runs=1` |
| L5 | Same event through the real consumer, 3× | `runs=1` |
| L6 | 5 concurrent deliveries through the real consumer | `runs=1` |
| L7 | Distinct event, same subject, within cooldown | `runs=1` |
| E3 | Key stable / distinct per event / absent for manual | `same=true distinct=true manualUnkeyed=true` |
| F8a | Duplicate idempotency keys in the database | `duplicateKeys=0` |
| F8b | One execution claimed by two steps | `sharedExecutions=0` |
| N3 | Second recovery sweep over terminal runs | untouched |

`F8b` is the one that would catch a double side effect hiding behind correct-looking rows: two
agent steps sharing a `tool_execution_id` would mean one side effect attributed to two steps.
Across 73 runs and 167 steps: zero.

## Cooldown is not idempotency

They answer different questions and are enforced separately.

Idempotency collapses *the same trigger*. The cooldown (30 minutes per provider, in the trigger
definition) bounds *genuinely different* triggers about the same subject — because two distinct
events about one partner are not duplicates, but they still must not start two runs seconds apart.
That is how a flapping entity turns into an inference bill.

> **L7** proves the distinction: a second event with a **fresh event id** — so idempotency does not
> apply — is still held. `runs=1`.

## Recursion under concurrency

The recursion guard walks the parent chain, bounded to `maxDepth + 1` iterations so a corrupt
parent chain cannot itself become an infinite loop inside the loop guard.

Two independent checks, catching different failures: **depth** catches an unbounded chain even when
every link is a different agent (A→B→A→B…), which a same-agent check alone would miss; the
**ancestry walk** catches a tight cycle still within the depth limit, which would otherwise run to
the ceiling on every event rather than being refused at the first repeat.

> **I1** `RECURSION_CYCLE_DETECTED` · **I2** `RECURSION_DEPTH_EXCEEDED` · **GR5** proven
> load-bearing against a **real** parent row (a synthetic id would have made the walk terminate on
> "parent not found" and the probe would have passed with the guard removed).

## Rate limiting is keyed on the agent

`agent:start:{agentId}`, via the existing `consumeRateLimitSmart`. Keyed on the agent rather than
the actor because the failure this prevents is an event or retry storm — many different actors, or
none, driving one agent. An actor-keyed limit would let a thousand distinct trigger events start a
thousand runs.
