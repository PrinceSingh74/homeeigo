# PHASE 16 — INTEGRATION EVIDENCE (FINAL)

All evidence produced against the real staging database (`homigo_staging_db`), the real services,
the real transactional outbox, the real tool layer and the real AI gateway. No mocks.

---

## Suite results

| Suite | Harness | Result |
|---|---|---|
| Base certification | `agent-certification.ts` | **47 PASS / 0 FAIL** |
| Live execution | `agent-live-certification.ts` | **8 PASS / 0 FAIL / 1 BLOCKED** |
| Event / scheduler / recovery | `integration-certification.ts` | **14 PASS / 0 FAIL** |
| **Event producers** | `event-producer-certification.ts` | **12 PASS / 0 FAIL** |
| **True end-to-end flows** | `e2e-agentic-flow.ts` | **11 PASS / 0 FAIL / 1 BLOCKED** |
| **Migration guard self-test** | `migration-guard-selftest.ts` | **13 PASS / 0 FAIL** |
| **Observability self-test** | `observability-selftest.ts` | **10 PASS / 0 FAIL** |
| Guard removal | `guard-removal.ts` | **7/7 LOAD_BEARING** |
| Red team | `red-team.ts` | **12 CONTAINED / 0 BREACH / 0 INCONCLUSIVE** |
| Forensic second pass | `forensic-audit.ts` | **28 OK / 0 FINDINGS** |
| **Phase-16 total** | | **162 checks, 0 failures, 2 provider-blocked** |

## Whole-project regression

| Group | Files | Result |
|---|---|---|
| AI tools, gateway, brain, handler contracts, approvals, audit, events, support | 8 | 152 pass / 0 fail |
| Operations cert, failure recovery, booking state, adversarial, ledger, money matrix, fraud | 8 | 175 pass / 0 fail — **money drift 0** |
| Knowledge RAG, ML governance, security P0/P1, vision, support fanout, scheduled reports | 7 | 192 pass / 0 fail |
| **Total** | **23** | **519 pass / 0 fail** |

TypeScript: 3 pre-existing errors, all in `src/__tests__/partner-four-axis.test.ts`, present before
Phase 16 and untouched by it. **0 attributable to Phase 16.**
Prebuild gate: log governance + migration safety both PASS.

## The end-to-end chain, proven

```
real service write → transactional outbox row → real outbox processor
  → real consumer registry → real agent trigger → real agent runtime
    → persisted run + steps + ai_tool_executions + audit
```

| Flow | Evidence |
|---|---|
| **Support** | S1 outbox row · S2 run created · S3 `trigger=EVENT depth=1` causally bound · S4 governed tool calls with authoritative execution rows · S5 zero money/enforcement tools |
| **Operations** | T1 outbox row · T2 run created · T4 an INFO alert publishes an event but starts **no** run |
| **Partner** | U1 a real `pause()` drives a Partner Operations run through the outbox |
| **Replay** | V1 re-delivering published events creates **no** additional runs · V2 exactly one run for the replayed ticket |

Live database after certification:

```
runs=135          byTrigger: MANUAL=110  EVENT=25
                  byMode:    LIVE=106    SHADOW=29
outboxEvents=101  (support.ticket.created + ops.alert.raised + partner.paused)
highRiskToolsTouched=0
readOnlyAgentWrites=0
```

## Two configuration facts the E2E work uncovered

**The staging baseline ships events OFF.** `.env.staging` sets `EVENTS_OUTBOX_ENABLED=false` and
`EVENTS_CONSUMERS_ENABLED=false`, and `lib/staging-safety.ts` refuses to boot if either is enabled
without `STAGING_EVENTS_CERTIFICATION=1`. That guard fired during this work and named the sanctioned
path — it was used rather than worked around.

**Outbox-on / consumers-off is a silent-failure combination.** They are independent flags. With the
processor on and consumers off, rows are claimed, published and marked PUBLISHED while
`dispatchEvent` returns immediately — outbox metrics climb, every row reaches a terminal state, and
no consumer ever runs. Observed directly as `claimed=68` with zero agent runs, which reads exactly
like a healthy pipeline.

Both flags are now preserved by `load-env` as explicit runtime overrides (like `PORT` and
`DATABASE_URL`), because the setting is read **once** at import time and static imports are hoisted
above every statement — no assignment inside a script can change it.

## What remains BLOCKED

**T3 / K5** — the Operations agent reaching governed tool execution inside the E2E sequence.
Consistently `PLANNER_UNAVAILABLE` with `PROVIDER_ERROR: Upstream AI provider failed` after the
support flow has spent the free-tier quota (GROQ 429, Gemini 503/quota with 42.8 s cooldowns). A
bounded delivery retry was added and did not clear it.

This is an environment condition, not a product property, and it is reported as BLOCKED rather than
passed — counting a provider outage as evidence would be counting an outage as a control. The
capability itself is separately proven: **K6** shows an Operations run executing `read.ops.getAlerts`
with a matching `ai_tool_executions` row.

## Reproduction

```bash
cd apps/backend
HOMIGO_STAGING=1 bun run scripts/phase16/seed-agent-staging.ts
HOMIGO_STAGING=1 bun run scripts/phase16/seed-tool-registry-staging.ts

HOMIGO_STAGING=1 AGENTS_ENABLED=true bun run scripts/phase16/agent-certification.ts
HOMIGO_STAGING=1 AGENTS_ENABLED=true bun run scripts/phase16/agent-live-certification.ts
HOMIGO_STAGING=1 AGENTS_ENABLED=true bun run scripts/phase16/integration-certification.ts
HOMIGO_STAGING=1 AGENTS_ENABLED=true bun run scripts/phase16/event-producer-certification.ts
HOMIGO_STAGING=1 AGENTS_ENABLED=true bun run scripts/phase16/red-team.ts
HOMIGO_STAGING=1 AGENTS_ENABLED=true bun run scripts/phase16/observability-selftest.ts
HOMIGO_STAGING=1 bun run scripts/phase16/guard-removal.ts
HOMIGO_STAGING=1 bun run scripts/phase16/forensic-audit.ts
bun run scripts/phase16/migration-guard-selftest.ts

# Full event path additionally needs the sanctioned staging certification flags:
STAGING_EVENTS_CERTIFICATION=1 EVENTS_OUTBOX_ENABLED=true EVENTS_CONSUMERS_ENABLED=true \
  HOMIGO_STAGING=1 AGENTS_ENABLED=true bun run scripts/phase16/e2e-agentic-flow.ts
```

Every database-capable script refuses unless `APP_ENV=staging` **and** the database name contains
`staging`. Verified by forensic F13a/F13b/F13c: 9/9 guarded, one declared read-only exemption
(the audit itself), two scripts that never open a database.
