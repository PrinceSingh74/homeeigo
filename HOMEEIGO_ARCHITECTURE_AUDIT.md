# HOMEEIGO — ARCHITECTURE AUDIT

---

## 1. System topology (verified)

```
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│ Customer Web │ Customer     │ Partner Web  │ Partner      │ Admin Console│
│ Next.js 15   │ Mobile       │ Next.js 15   │ Mobile       │ Next.js 15   │
│ 28 pages     │ Expo/RN 0.81 │ 52 pages     │ Expo/RN 0.81 │ 88 pages     │
│              │ 29 screens   │              │ 13 screens   │              │
└──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┴──────┬───────┘
       │  HTTPS (same-origin proxy) + WebSocket                     │
       └──────────────────────────┬─────────────────────────────────┘
                                  ▼
        ┌───────────────────────────────────────────────────┐
        │  BACKEND — Bun + Elysia (587 TS files)            │
        │  onRequest: security headers                      │
        │  → error → request-context → logger               │
        │  → rate-limit → metrics → idempotency → CORS      │
        │  42 route modules · 6 WebSocket handlers          │
        └───────────────────────────┬───────────────────────┘
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │  DOMAIN SERVICES (173)                            │
        │  01 Acquisition  02 Operations  03 Execution      │
        │  04 Finance      05 Trust & Safety                │
        │  + AI (20) · AI-Brain (23) · AI-Tools (18)        │
        │  + Automation · Notifications · Analytics (16)    │
        └───────────────────────────┬───────────────────────┘
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │  TRANSACTION BOUNDARY                             │
        │  business write + EventOutbox row, one commit     │
        └───────────────────────────┬───────────────────────┘
                                    ▼
        ┌──────────────┬────────────────────┬───────────────┐
        │ PostgreSQL16 │ Redis              │ AWS S3        │
        │ 189 models   │ cache · locks ·    │ documents     │
        │ 119 enums    │ presence · flags   │ evidence      │
        │ 481 indexes  │                    │               │
        │ 94 migrations│                    │               │
        └──────────────┴─────────┬──────────┴───────────────┘
                                 ▼
        ┌───────────────────────────────────────────────────┐
        │  EVENT BUS → 8 consumers → DLQ                    │
        │  → notifications · automation · analytics · audit │
        └───────────────────────────┬───────────────────────┘
                                    ▼
        ┌───────────────────────────────────────────────────┐
        │  EXTERNAL: Razorpay · Google Maps · Twilio ·      │
        │  Resend · Expo Push · OpenWeather · BigQuery ·    │
        │  Vertex AI · Groq/Gemini/OpenAI/Anthropic         │
        └───────────────────────────────────────────────────┘
```

## 2. Request lifecycle (verified from `src/index.ts`)

Root `onRequest` applies security headers to **every** response including errors and 404s, then:
`errorMiddleware → requestContext → requestLogger → apiRateLimit → metrics → idempotency → CORS →
swagger (dev only) → observability → 43 route modules → 5 WebSocket modules`.

**Engineering note found during audit:** the plugin chain is 54 links long and exceeded TypeScript's
instantiation depth (TS2589). It is now assembled in segments — verified runtime-neutral by booting
the original and segmented servers side by side and comparing **80/80 routes**, all returning
identical status codes with identical security headers.

## 3. The outbox pattern (the architectural centrepiece)

```
BEGIN
  update booking → COMPLETED
  insert EventOutbox { eventId, eventType, aggregate, payload, metadata }
COMMIT                          ← both, or neither
      ↓
  event bus dispatch
      ↓
  8 consumers (audit, notification, analytics, automation, …)
      ↓
  failure → DLQ, never a lost event
```

**Why it matters:** without it, a booking could complete while its notification silently failed, or
a notification could fire for a transaction that rolled back. The outbox makes the business change
and its consequence atomic.

**Verified hardening:** `outboxPayload()` validates that the payload is storable and **throws**
rather than skipping — because dropping an outbox row would silently break the guarantee. (During
this audit an over-strict version of that validator was found rejecting legitimate `Date` values and
was corrected to defer to `JSON.stringify`, the conversion the driver actually performs.)

## 4. Concurrency and correctness controls (all verified)

| Control | Implementation | Protects |
|---|---|---|
| Transactions | `prisma.$transaction` across money paths | Partial financial writes |
| DB check constraints | `booking_completed_requires_timestamp` | COMPLETED with no completion time |
| DB exclusion constraint | `bookings_user_slot_excl` (tstzrange GIST) | Double-booking one customer |
| Unique constraints | 29 `@@unique`, incl. `(providerId, ruleId, periodKey)` | Duplicate incentive credits |
| Claim-before-side-effect | in-transaction re-check before crediting | Concurrent double credit |
| Idempotency keys | server-derived; unique index | Replayed requests re-executing |
| Distributed leader lock | Redis `SET NX EX`, in-memory fallback | 18 jobs running N times on N instances |
| Circuit breaker | AI tool execution, threshold 5 / 60 s | Cascading failure on a broken tool |
| Reservation pattern | wallet reservations for withdrawals | Over-withdrawal under concurrency |

**Verified by execution, not inspection:** two concurrent accepts of one job produced 1 SUCCESS +
1 FAILED with exactly one customer email and one outbox event; 5 concurrent same-idempotency-key
calls created exactly 1 row.

## 5. Domain separation

Each of the five business sections has its own services, models, routes and admin surface. The AI
layer is separated further into three subsystems with distinct responsibilities:

- `ai/` (20 files) — gateway, providers, templates, context, security, cost
- `ai-brain/` (23 files) — enterprise context, memory, prompts, timeline
- `ai-tools/` (18 files) — registry, policy, approval, execution, audit, sandbox

The Partner Intelligence layer added in this cycle keeps the same discipline: aggregation
(`partner-intelligence.service.ts`) is separate from ranking (`zone-recommendation.service.ts`), so
no consumer inherits a single service's opinion of "best".

## 6. Import-graph findings (honest)

A real cycle exists: `execution-engine → tool-registry → handlers → execution-engine`. Rather than
deepen it, shared error types were placed in a dependency-free leaf module
(`ai-tools/execution/errors.ts`). The cycle itself remains and is recorded as follow-up work.

## 7. Scalability posture

| Dimension | Verified position |
|---|---|
| Horizontal API scale | Stateless routes; leader locks make scheduled work single-execution |
| Read scale | L1 in-process + L2 Redis caching in geo-intel; measured warm context build 42 ms vs 1,455 ms cold |
| Write integrity | Transactions + constraints rather than application-level coordination |
| Async work | Outbox + event bus + DLQ decouple side effects from request latency |
| Data growth | Retention service with categories, archival job, log-governance guardrails |

**Not claimed:** any specific requests-per-second, concurrent-user or uptime figure. No load test
result is present in the repository for the current build.

## 8. Quality architecture

```
Unit / service tests (96 backend files, bun test)
        ↓
Integration tests against an isolated database
        ↓
API + security tests (RBAC, IDOR, spoofing, injection)
        ↓
Web E2E — 44 Playwright specs
        ↓
Mobile E2E — 8 specs + startup certification gate
        ↓
Operational certification scripts (226)
        ↓
CI: typecheck across 5 surfaces + mobile startup gate
```

**Isolation discipline verified:** database-touching tests refuse to run outside an isolated
database (`REFUSING TO RUN: connected to …`) — demonstrated by deliberately running one without the
override and confirming it aborted with production row counts unchanged.

## 9. Architectural strengths and weaknesses

**Strengths**
1. Money correctness is enforced by the database, not only by code.
2. Side effects are transactionally guaranteed via the outbox.
3. AI is bounded: 14 highest-risk tools are structurally unbound in production.
4. Every intelligence output carries provenance, freshness and confidence.
5. Scheduled work is safe to run multi-instance.

**Weaknesses (recorded, not hidden)**
1. One import cycle in the AI-tools subsystem.
2. Concurrent same-idempotency-key requests surface a raw database error instead of a structured
   replay (no integrity impact — exactly one row is still created).
3. Test-isolation drift: a shared test database has accumulated 349 providers, which changes
   top-N matching assertions over time.
4. Current cloud deployment state is **not verified in repository**.
