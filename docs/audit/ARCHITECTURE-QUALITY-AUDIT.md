# Architecture Quality Audit

**Score: 85%** · **HEAD:** `b582ead` · Audit-only

## 1. Duplication — CLEAN

I looked specifically for the common failure mode where each phase grows its own infrastructure. It is not present.

| Concern | Finding |
|---|---|
| Outbox / retry / DLQ | **Single implementation.** Only two runtime writers (`emitInTransaction`, `emitStandalone`), both in `events/core/event-publisher.ts`. Phase 2 ETA events ride this outbox rather than a parallel path. |
| AI Gateway | **Single.** `ai/gateway/ai-gateway.ts`; Phase 4 and 5 route through it rather than calling providers directly. |
| Memory / conversation | **No duplication.** Phase 4 extends the pre-existing `AiConversation`/`AiMessage` via `conversation-bridge.ts`, exactly as the roadmap required. |
| Scheduler | **Single primitive.** `runWithLeaderLock` shared by the outbox processor (`maintenance:event_outbox`) and the ETL scheduler (`maintenance:etl_scheduler`). |
| Analytics pipeline | **Single.** `analytics/etl/engine.ts`; Phase 2 writes through the same BigQuery client. |
| Observability | **Partial concern.** Three Grafana stacks (`_obsstack`, `staging`, `stage-f`) exist. Defensible as env separation, but it caused a real outage this session — the staging stack published Grafana on port 3000, hijacking the backend and breaking all login (fixed in `b582ead`). |

## 2. Coupling — ACCEPTABLE

- **AI → business logic:** decoupled. Tools declare a `serviceMapping` string and route through the service layer; no handler was observed reaching Prisma directly to bypass business rules.
- **ML → APIs:** decoupled. `analytics/` writes to BigQuery and staging tables; API routes read from services, not from ETL internals.
- **Events → consumers:** decoupled via the consumer registry; a failing consumer does not abort its peers (verified in `event-bus.test.ts`).

One coupling wart: `analytics/` sits outside `src/` and imports across that boundary (`../../src/lib/...`), which produces `rootDir` TypeScript errors in `bun run type-check`. Pre-existing and unrelated to Phase 0–5 correctness, but it means the type-check gate is not clean.

## 3. Separation of Concerns — PRESERVED

The stated philosophy maps onto real, distinct modules:

| Principle | Module | Verified |
|---|---|---|
| Rules = Control | `ai-tools/policy/policy-engine.ts` | 115 DENIED decisions |
| ML = Prediction | `analytics/` (forecast, feature store, ETA) | ETL runs, BQ layers |
| LLM = Understanding | `ai/`, `ai-brain/` | 1,626 gateway requests |
| Automation = Execution | `ScheduledJob` | **Executor missing** |
| Human = High-Risk Authority | `ai-tools/approval/approval-engine.ts` | Self-approval denied, expiry, tamper check |

The chain holds under inspection: a CRITICAL tool cannot reach a service without passing policy and then a human approver who is not the requester.

## 4. Existing System Preservation — GOOD

Phase 0 explicitly ran alongside legacy paths rather than replacing them: `notification.service.ts` is untouched and still fires directly, while `audit.consumer.ts` independently consumes the same events. This is what the roadmap asked for ("existing logic initially runs in parallel") and it means a Phase 0 regression cannot silently kill notifications.

## 5. Extensibility — GOOD

- **Tools** are a data-driven catalog; adding one is a catalog entry plus handler, not a code-path change.
- **Providers** sit behind `model-providers.ts` + router, so a third model is additive.
- **Context collectors** are pluggable per role (6 today).
- **Events** are catalog-driven with a namespace guard, so new domains extend rather than fork.

Vision, voice, RAG, agents, and further ML models could be added without rewriting the core. The one exception: **automation workflows have no extension point at all**, because the engine does not exist.

## 6. Scalability — SOUND, with one caveat

| Property | Finding |
|---|---|
| Horizontal scaling | Supported — leader locks + instance IDs |
| Multi-instance safety | `FOR UPDATE SKIP LOCKED` on outbox claims; leader-locked ETL |
| Leader election | `runWithLeaderLock` (shared) |
| Connection pooling | PgBouncer deployed (`homigo-pgbouncer` :6432, staging :6433) |
| Caching | `AiContextCache`, L1/L2 patterns present |
| Rate limits | Gateway + per-tool |
| BigQuery scaling | Batched `loadRows`, fail-safe on error |

**Caveat:** the future automation executor must adopt the same leader-lock discipline. Built naively it will double-execute jobs on multi-instance deploys — the failure mode the rest of the platform already avoids.

## 7. Architectural Verdict

Design quality is high; the deduction is **completeness, not design**. The target architecture names three pillars under EVENT FOUNDATION — AUTOMATION, AI CORE, ML PLATFORM. AI CORE and ML PLATFORM are substantially real. AUTOMATION is a stub: triggers and a job table, no executor and no workflow model.

An architecture diagram that does not match the system is itself a defect, because it is the artifact people plan against. Either build the executor, or amend the diagram to show AUTOMATION as planned rather than present.

## Gaps

| ID | Gap | Priority |
|---|---|---|
| P0-2 | Automation pillar ~1/3 built; architecture diagram overstates reality | P0 |
| — | `analytics/` outside `rootDir` breaks clean type-check | P2 |
| — | Three Grafana stacks; port collision already caused a login outage | P2 |
