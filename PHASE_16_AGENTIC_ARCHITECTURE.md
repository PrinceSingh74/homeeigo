# PHASE 16 — AGENTIC ARCHITECTURE

**Status:** implemented, certified on staging
**Branch:** `cursor/stage-e-step-13-certification`
**Evidence database:** `homigo_staging_db` (localhost:5434)

---

## 1. What was already here

Phase 16 began with a forensic audit of the existing platform rather than a design. The finding
that shaped everything else: **HOMIGO already had a governed tool-execution layer, and it was
good.** `apps/backend/src/ai-tools/` contains a policy engine, an approval engine with atomic
single-consume semantics, argument schema validation, per-tool rate limiting, circuit breaking,
idempotency that replays every non-retryable state, and an audit trail with an `INDETERMINATE`
outcome for side effects whose result is genuinely unknown.

What did **not** exist:

| Capability | Status before Phase 16 |
|---|---|
| Governed tool execution | **Existed** — `ai-tools/execution/execution-engine.ts` |
| Policy / RBAC / approval / audit | **Existed** — `ai-tools/policy`, `ai-tools/approval` |
| LLM gateway with budget, firewall, failover | **Existed** — `ai/gateway/ai-gateway.ts` |
| Workflow engine, EventOutbox, scheduler | **Existed** — `automation/`, `events/` |
| Model↔tool chat loop | **Existed** — `ai-tools/bridge/tool-bridge.ts` |
| **Agent identity as an authorisation subject** | **Absent** |
| **Typed plan, validated before execution** | **Absent** |
| **Persisted run lifecycle / recovery** | **Absent** |
| **Post-condition verification** | **Absent** |
| **Recursion / self-trigger prevention** | **Absent** |
| **Shadow mode** | **Absent** |

## 2. The one genuinely new abstraction, and why it is necessary

§4 forbids duplicating an existing engine and requires proof before adding an abstraction. Exactly
one was added: **the agent as an authorisation subject.**

The proof it was necessary:

> The Phase-5 policy layer authorises by **role**. The Operations Agent, the Partner Operations
> Agent, the Finance Assistant and the Fraud Investigation Assistant all necessarily run as
> `ADMIN`, and `ROLE_TOOL_PERMISSIONS.ADMIN` grants `tools.read.admin.*`. Under role
> authorisation alone, the Finance Assistant asking for a fraud enforcement tool and the Support
> Agent asking for a ledger tool are **indistinguishable from a legitimate admin request** — the
> policy engine cannot tell one caller from the other, because to it they are the same actor.

So §52 cross-agent security is not expressible in the existing model. `agents/registry/agent-registry.ts`
adds the missing subject. It does **not** re-implement policy, RBAC, approval, audit, rate limiting
or idempotency — all of which still run underneath on every call. An agent must pass **both**.

## 3. Control hierarchy, as implemented

```
RULES      → ai-tools/policy/policy-rules.ts        (unchanged, still decides)
ML         → existing scoring services              (signal only, never verdict)
LLM        → ai/gateway/ai-gateway.ts               (understanding; produces a PLAN, never an action)
RAG        → knowledge-retrieval.service            (grounding, with citations and staleness)
AGENT      → agents/runtime/agent-runtime.ts        (planning + orchestration, NEW)
WORKFLOW   → automation/engine                      (unchanged)
AUTOMATION → ai-tools/execution/execution-engine.ts (unchanged, the only execution door)
HUMAN      → ai-tools/approval + escalation         (high-risk authority, unchanged)
```

The hierarchy is never inverted because the agent layer physically cannot execute: it holds no
service imports. Verified statically — `forensic-audit.ts` F2 asserts the agent layer imports no
`*.service` module except `feature-flag` and `audit-log`, both governance.

## 4. Execution path

```
AGENT REQUEST
  → admitAgentRun()        enabled? kill switch? rate limit? recursion? duplicate?
  → createRun()            persisted, unique on (agent, trigger, subject)
  → planWithModel()        invokeAiGateway — firewall, budget, failover, audit
  → validatePlan()         capability allowlist, argument allowlist, server risk classification
  → disposeStep()          EXECUTE | SHADOW | ESCALATE, per step
  → executeTool()          the SAME door an HTTP caller uses
  → verifyPostCondition()  re-read the world; SUCCESS is not assumed
  → recordStep()           persisted before and after every tool call
  → AuditLogService.recordGoverned()
  → terminal transition    state machine enforced, no illegal edge
```

## 5. What the model can and cannot emit

The model emits a **capability name** and a flat bag of **scalar arguments**. It never sees a tool
id, so it cannot name one. A plan naming a capability outside its agent's vocabulary is
`UNKNOWN_CAPABILITY` — rejected, never remapped. An argument the capability does not declare is
`UNKNOWN_ARGUMENT` — rejected, never dropped, because a silently dropped argument turns a narrow
action into a broad one.

The model's own `risk` field is recorded and **never consulted**. `plan-validator.ts` classifies
risk from the capability definition. Certified: check C6 — a plan claiming `LOW` for
`ticket.resolve` is classified `MEDIUM` by the server.

## 6. Certification summary

| Suite | Result |
|---|---|
| Base certification (47 checks) | **47 PASS / 0 FAIL / 0 BLOCKED** |
| Live execution certification (10 checks) | **10 PASS / 0 FAIL / 0 BLOCKED** |
| Guard removal (7 controls) | **7/7 LOAD_BEARING** |
| Red team (12 attacks) | **12 CONTAINED / 0 BREACH** |
| Event / scheduler / recovery (14 checks) | **14 PASS / 0 FAIL** |
| Forensic second pass (26 checks) | **26 OK / 0 FINDINGS** |
| Whole-project regression (17 files) | **473 pass / 0 fail** |
| Admin panel build | **exit 0**, `/agents` + `/agents/[runId]` |

Live database state after certification:

```
runs=73  steps=167  LIVE=53  SHADOW=20
toolExecutions=72  agentStepsWithExecution=72   (every step joins to an authoritative row)
highRiskToolsTouched=0
writesByReadOnlyAgents=0
```

## 7. Files

**New** — `apps/backend/src/agents/` (config, types, registry, planning, policy, runtime,
triggers, observability), `src/routes/agents.routes.ts`,
`src/ai-tools/registry/phase16-agent-tools.ts`,
`src/ai-tools/execution/handlers/phase16-agent-handlers.ts`,
`src/ai/templates/phase16-agent-templates.ts`,
`src/events/consumers/agent-trigger.consumer.ts`,
`apps/admin-panel/src/app/(console)/agents/`.

**Extended, not replaced** — `tool-catalog.ts` (spread), `handlers/index.ts` (spread),
`prompt-templates.ts` (spread), `audit-log.service.ts` (5 `SecurityEvent` values),
`events/consumers/index.ts` (one consumer), `schema.prisma` (2 models, 4 enums).

**Migration** — `20260910090000_phase16_agent_runtime` — additive only: 4 enums, 2 tables,
11 indexes, 1 foreign key. No column dropped, no existing table altered.
