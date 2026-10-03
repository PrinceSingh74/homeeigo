# PHASE 16 — AGENT RBAC & CROSS-AGENT SECURITY

## The problem role RBAC cannot solve

Four of the five agents necessarily run as `ADMIN`. `ROLE_TOOL_PERMISSIONS.ADMIN` grants
`tools.read.admin.*`, `tools.write.admin.*` and `tools.high_risk.*`. To the policy engine, the
Finance Assistant and the Fraud Assistant are **the same actor**.

So role authorisation alone cannot express §52. The agent had to become an authorisation subject.

## Two independent enforcement points

**Plan validation** (`plan-validator.ts`) — a capability outside the agent's vocabulary is
`UNKNOWN_CAPABILITY`. Not mapped, not approximated, not escalated. Rejected before any registry
lookup happens.

**Execution time** (`assertCapabilityAllowed`) — re-checked on every step. In the normal path this
can never fire, because validation already refused. It exists for the abnormal one: any future
caller that reaches execution without the validator — a recovery path, a replay, a test harness, a
refactor.

> **Certified — B2** (6 cross-agent attempts, all `UNKNOWN_CAPABILITY`), **B3** (execution-time
> check throws independently).
>
> **Guard-removal GR1.** Replacing the lookup with a fallback to the agent's first capability —
> the "helpful repair" a well-meaning refactor might introduce — makes the probe fail.

## Vocabulary matrix

| Agent | Role | Capabilities | Write? | Data classes |
|---|---|---|---|---|
| Support | `SUPPORT` | 4 | 1 (`ticket.resolve`, MEDIUM) | PUBLIC, INTERNAL, PERSONAL |
| Operations | `ADMIN` | 6 | 1 (`ops.resolveAlert`, MEDIUM) | PUBLIC, INTERNAL |
| Partner Operations | `ADMIN` | 3 | 1 (`partner.notify`, MEDIUM) | INTERNAL, PERSONAL |
| Finance | `ADMIN` | 4 | **0** | INTERNAL, FINANCIAL |
| Fraud | `ADMIN` | 5 | **0** | INTERNAL, FRAUD, PERSONAL |

Support runs as `SUPPORT`, not `ADMIN`. The narrower role is the one that still lets every one of
its capabilities run, and choosing the wider one "in case" is how an agent quietly acquires reach.

Partner Operations declares **no** `FINANCIAL` and no `FRAUD` class. A partner-operations question
that needs either is an escalation, not a wider grant.

## The agent's role is never the caller's

`POST /api/agents/:agentId/run` is admin-gated, but the run does **not** execute as the admin. The
runtime passes `getAgentDefinition(agentId).actorRole` to `executeTool`. An admin invoking the
Support Agent gets Support-Agent tool authority, which is narrower than their own.

> **Certified — forensic F14a.**

## Route protection

6 routes. 5 admin-gated. `GET /api/agents/health` is public by design — it reports only whether the
layer is enabled and whether the switch is pulled, enumerating no agent and no capability, matching
the existing `/api/ai/tools/health` convention.

> **Certified — forensic F14b.** An earlier version of this check reported a P0 "half the routes
> are unguarded" because its regex counted `request.headers.get(...)` calls as routes. Corrected —
> an audit that cries wolf is worse than no audit, because the next real finding gets waved away
> with it.

## Approval flow is not duplicated

The agent layer never creates, decides or consumes an approval. Escalation hands off to the
existing `/api/ai/tools/approvals` surface, which already carries non-self-approval, single-consume
and argument-hash binding. A second approval door would mean two sets of rules to keep in step, and
the quieter one would eventually win.

> **Certified — forensic F12b.** No agent module references `createApprovalRequest`,
> `decideApproval` or `consumeApproval`.
>
> **Red team RT5** — "approve your own request": `selfApprovedApprovals=0`.

## Data classification (§54)

Seven classes: `PUBLIC`, `INTERNAL`, `SENSITIVE`, `PERSONAL`, `FINANCIAL`, `FRAUD`, `HIGH_RISK`.
Declared per capability **and** per agent, and the registry refuses to load if a capability touches
a class its agent does not declare — otherwise the declaration is decorative and an operator
reading it is misled about what the agent can see.

Context aggregation cannot bypass it: an agent has no context-assembly path of its own. Everything
it learns arrives as a tool result, and every tool is inside its declared classes by construction.
