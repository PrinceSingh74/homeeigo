# PHASE 16 — AGENT AUDIT

## Three independent records of every run

| Record | Table | Written by |
|---|---|---|
| Run lifecycle | `agent_runs` | `run-store.ts` |
| Step-by-step decisions | `agent_run_steps` | `run-store.ts`, before **and** after every tool call |
| Authoritative execution | `ai_tool_executions` | the Phase-5 tool layer, unchanged |
| Governance events | `enterprise_audit_logs` | `AuditLogService.recordGoverned` |

The join is `agent_run_steps.execution_id → ai_tool_executions.execution_id`, so *"which agent
caused this side effect"* and *"what did this agent actually do"* are both answerable from either
end. It is deliberately not a declared foreign key: a step can legitimately have no execution
(denied, shadowed, awaiting approval), and an FK would force one.

> **Certified — F15.** Across 73 runs and 167 steps: 72 steps carry an execution id, and
> **0 dangling** — every one resolves to a real `ai_tool_executions` row. The agent's own record is
> never the only evidence that something ran.

## Five governance events, not one per phase

```
AGENT_RUN_STARTED · AGENT_PLAN_ACCEPTED · AGENT_PLAN_REJECTED · AGENT_ESCALATED · AGENT_RUN_COMPLETED
```

Each marks a point where **authority changed hands**. Every other phase is already reconstructable
from `agent_run_steps` and `ai_tool_executions`; duplicating it here would make the security log
noisier without making it more answerable.

`AGENT_PLAN_REJECTED` is the security-interesting one — it fires when a model asked for a
capability its agent does not hold, which is what an attempted escalation looks like from the
inside. It is logged at `category: "SECURITY"` alongside the other authorisation refusals.

## No fire-and-forget audit (§35)

Every governance event goes through `AuditLogService.recordGoverned`, which **awaits** the
enterprise audit write and treats a null row id as a failure — the returned id is the proof of
persistence.

Failure is logged at `SECURITY`, never swallowed silently. It does not abort the run, and that is a
deliberate trade rather than an oversight: these audit points bracket a decision that has *already*
been made and recorded in `agent_runs`/`agent_run_steps`. Throwing at that point would leave a run
half-advanced with no better record than the one that just failed to write. The alert is the
remedy; the run rows remain the primary evidence.

> **Certified — forensic F5a/F5b.** Zero `void audit(...)` call sites; 5 awaited ones.

## What is deliberately NOT stored

**Raw model output.** Never persisted. The stored plan carries capability names, the server's risk
classification, the model's stated reason (truncated), and **redacted** arguments.

**Chain-of-thought.** §66 asks for structured rationale; raw reasoning is neither structured nor
reliable as an account of what happened, and the two diverge in exactly the cases an operator is
investigating.

**Unredacted arguments.** Plan and step arguments pass through the existing `redactArguments`
before persistence. The `arguments_hash` column is the binding; the preview is for humans and is
never consulted for authorisation.

> **Certified — forensic F11b/F11c.**

## The operator-facing summary is assembled from rows

`buildSummary()` reads the recorded steps. It never uses model prose — a summary written by the
model would be a claim about the run rather than a description of it, including potentially a claim
that something succeeded when the step rows say otherwise.

## Versions are stamped on every run

`agentVersion`, `promptVersion`, `policyVersion` (`POLICY_RULESET_VERSION`), `toolsetVersion`,
`modelProvider`, `modelName` — frozen at creation. A run is only interpretable against the
definition it ran under; *"why did it do that"* is unanswerable once the agent, prompt, policy and
toolset have all moved on.

`toolsetVersion` is **derived** from the agent's capability→tool bindings, so a change to what an
agent can reach changes the version stamped on future runs. A hand-maintained constant is one
somebody forgets to bump, and a version that silently stops moving asserts a stability that is not
there.

Observed on staging: `support=tools.v4.8904264d`, `operations=tools.v6.0c078133`,
`partner-operations=tools.v3.3369748a`, `finance=tools.v4.7effd99d`, `fraud=tools.v5.f1a19d01`.
