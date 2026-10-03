# PHASE 10 — Discovery (read-only)

Performed 2026-09-01 before any code was written.

## What already exists

| Thing | Location | State |
|---|---|---|
| `SupportTicket` model | `prisma/schema.prisma:1158` | **REAL** — 32 live rows; `category` is free `String`, `priority` free `String`, `priorityLevel` enum, `slaDueAt`, `firstResponseAt`, `responseTimeMs` |
| `SupportTicketMessage` model | `prisma/schema.prisma:1193` | **REAL** — 52 live rows; `authorRole`, `isInternal` |
| `SupportTicketService` | `services/support-ticket.service.ts` (643 lines) | **REAL** — 13 methods: create, listForUser, getForUser, userReply, adminGet, adminList, adminRespond, adminResolve, adminEscalate, adminMerge, adminAnalytics |
| SLA policy | same file, `SLA_MS` | **REAL and authoritative** — HIGH 2 h, NORMAL 24 h, LOW 48 h |
| Priority policy | `resolvePriority()` | **REAL and authoritative** — entitlement-driven: membership or `prioritySupport` → HIGH, else NORMAL |
| Customer routes | `routes/support.ts` | **REAL** — create / list / get / reply |
| Admin routes | `routes/admin.ts:1665-1730` | **REAL** — tickets, analytics, respond, escalate, merge, resolve |
| Support RBAC | `lib/admin-route-permissions.ts:39,114-119` | **REAL** — `DISPUTES/READ`, `DISPUTES/UPDATE`, `DISPUTES/APPROVE` |
| Admin support UI | `admin-panel .../support/page.tsx` (404 lines) | **REAL** — list, detail, reply, analytics |
| AI Gateway + failover | `ai/gateway`, `ai/config` | **REAL** — GROQ → GEMINI → OPENAI; GROQ and GEMINI configured |
| Prompt template `support.ticket.v1` | `ai/templates/prompt-templates.ts:130` | **REAL** — but for *drafting agent replies*, not classification |
| Approval engine | `ai-tools/approval/approval-engine.ts` | **REAL, frozen** (Phase 5) |
| Notification governance | `notifications/router.ts` | **REAL** |
| Scheduler | `events/core/job-processor.ts` + leader lock | **REAL** |
| EventOutbox / workflow engine | `events/`, `automation/` | **REAL** |

## What is missing

- No AI classification of tickets — no intent, no sentiment, no confidence, anywhere.
- No support context resolver — nothing assembles booking / payment / partner context for a ticket.
- No suggested-resolution layer.
- No automation-eligibility gate.
- No support events in `EVENT_TYPES`, no support workflow in the registry.
- No support-specific telemetry beyond `adminAnalytics()`.

## What is incorrect or messy (real observation)

`support_tickets.category` is free text and has drifted into seven inconsistent values across
32 rows:

```
Booking issue 17 · GENERAL 8 · Other 3 · Payout issue 1 · Service quality 1 · Booking 1 · Payment 1
```

None of these is the Phase-10 taxonomy. Classification must therefore **map**, not assume.

## A taxonomy that must not be overloaded

`ai/intent/intent-classifier.ts` defines `AiIntent` =
`SERVICE_SEARCH | PRICING_INQUIRY | BOOKING_STATUS | CANCEL_RESCHEDULE | COMPLAINT | ACCOUNT | GENERAL`.

That is the **live-chat routing** taxonomy, and it is a different question from "what kind of support
ticket is this?" — they overlap only on `GENERAL`. Reusing it would silently change chat routing and
would leave REFUND, DELAY and PARTNER_ISSUE unexpressible. Phase 10 therefore defines its own
support-ticket taxonomy and does **not** touch `AiIntent`.

## Consequences for the plan

Reuse: the ticket domain, the SLA and entitlement policies, the AI Gateway, the approval engine, the
notification router, the scheduler, the admin RBAC, and the existing admin support screen.

Build: a context resolver, a schema-validated classifier, a deterministic resolution recommender, an
automation-eligibility gate, an admin surface for all of it, and telemetry.

Build no second engine of any kind.
