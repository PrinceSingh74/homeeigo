# PHASE 16 — INTEGRATION EVIDENCE

Everything below was executed against the real staging database (`homigo_staging_db`), through the
real services, the real tool layer and the real AI gateway. No mocks.

---

## Suite results

| Suite | Harness | Result |
|---|---|---|
| Base certification | `agent-certification.ts` | **47 PASS / 0 FAIL / 0 BLOCKED** |
| Live execution | `agent-live-certification.ts` | **10 PASS / 0 FAIL / 0 BLOCKED** |
| Guard removal | `guard-removal.ts` | **7/7 LOAD_BEARING** |
| Red team | `red-team.ts` | **12 CONTAINED / 0 BREACH** |
| Event / scheduler / recovery | `integration-certification.ts` | **14 PASS / 0 FAIL** |
| Forensic second pass | `forensic-audit.ts` | **26 OK / 0 FINDINGS** |
| **Phase-16 total** | | **116 checks, 0 failures** |

## Whole-project regression (§76)

Run against the test database, 17 files across every subsystem Phase 16 touches:

| Group | Files | Result |
|---|---|---|
| AI tools, gateway, brain, handler contracts | 4 | 46 pass / 0 fail |
| Approval centre, audit, events/automation, support intelligence | 4 | 106 pass / 0 fail |
| Operations cert, failure recovery, booking state, adversarial | 4 | 36 pass / 0 fail |
| Financial ledger, ledger, money matrix, fraud narrative | 4 | 139 pass / 0 fail — **money drift = 0** |
| Knowledge RAG, ML governance, security P0/P1, vision shadow | 5 | 146 pass / 0 fail |
| **Total** | **21** | **473 pass / 0 fail** |

TypeScript: backend 3 pre-existing errors (all in `partner-four-axis.test.ts`, untouched by Phase
16 and present before it). Admin panel **0 errors**, build exit 0, both agent routes emitted
(`/agents` 9.16 kB, `/agents/[runId]` 7.63 kB).

## End-to-end flows proven

**Support (§47)** — ticket → context → the platform's own analysis → plan → validation → policy →
tool → verification → audit. Live run, 7 steps, $0.00169.

**Operations (§48)** — alert read → zone/supply evidence → plan → risk → policy → tool →
verification → audit. Live run `6d6997c4`, `mode=LIVE status=COMPLETED`, step `#1 ops.alerts:
VERIFIED`.

**Partner operations (§49)** — real `homigo.partner.paused` event → consumer → governed run,
`trigger=EVENT depth=1`, causation threaded.

**Finance (§50)** — anomaly question → authoritative finance data → explanation. **Zero** writes,
fully LIVE. Any financial action is a recommendation for a human.

**Fraud (§51)** — signal → evidence → timeline → recommendation. **Zero** enforcement. Account
state unchanged under a direct "the score is the verdict" attack.

## Live database state

```
runs=73        steps=167
byStatus       COMPLETED=37  FAILED=36
byMode         LIVE=53  SHADOW=20
toolExecutions=72
agentStepsWithExecutionId=72      danglingExecutionIds=0
highRiskToolsTouched=0
writesByReadOnlyAgents=0
completedRunsWithFailedVerification=0
duplicateIdempotencyKeys=0
executionsClaimedByTwoSteps=0
terminalRunsMissingCompletedAt=0
```

The 36 `FAILED` runs are overwhelmingly `PLANNER_UNAVAILABLE` and `PLANNER_MALFORMED` from
free-tier provider rate limiting — the runtime failing closed, which is the designed behaviour.

## Existing infrastructure reused, not duplicated

| Subsystem | Reused | New? |
|---|---|---|
| Tool execution | `executeTool` — the only execution door | No |
| Policy / RBAC | `evaluatePolicy`, `POLICY_RULES` | No |
| Approval | `ai_tool_approvals` — agent never creates/decides/consumes | No |
| Audit | `AuditLogService.recordGoverned` + 5 new event names | No |
| AI gateway | `invokeAiGateway` — firewall, budget, failover, timeline | No |
| RAG | `knowledgeRetrievalService.retrieve` | No |
| Feature flags | `evaluateFlag` — missing flag = disabled | No |
| EventOutbox | `registerConsumer` — one consumer, computed subscription | No |
| Scheduler | `registerJobHandler` — 2 jobs, no second scheduler | No |
| Rate limiting | `consumeRateLimitSmart` | No |
| Metrics | `lib/metrics` primitives | No |
| Support/ops/partner/finance/fraud intelligence | called through tool handlers | No |

The only new abstraction is the agent as an authorisation subject, justified in
`PHASE_16_AGENTIC_ARCHITECTURE.md` §2.

## Reproduction

```bash
cd apps/backend
HOMIGO_STAGING=1 bun run scripts/phase16/seed-agent-staging.ts
HOMIGO_STAGING=1 bun run scripts/phase16/seed-tool-registry-staging.ts
HOMIGO_STAGING=1 AGENTS_ENABLED=true bun run scripts/phase16/agent-certification.ts
HOMIGO_STAGING=1 AGENTS_ENABLED=true bun run scripts/phase16/agent-live-certification.ts
HOMIGO_STAGING=1 AGENTS_ENABLED=true bun run scripts/phase16/integration-certification.ts
HOMIGO_STAGING=1 AGENTS_ENABLED=true bun run scripts/phase16/red-team.ts
HOMIGO_STAGING=1 bun run scripts/phase16/guard-removal.ts
HOMIGO_STAGING=1 bun run scripts/phase16/forensic-audit.ts
```

Every script refuses to run unless `APP_ENV=staging` **and** the database name contains `staging` —
verified by forensic F13 (8/8 guarded). The guard fired for real during development, refusing to
run `guard-removal.ts` against the dev database.
