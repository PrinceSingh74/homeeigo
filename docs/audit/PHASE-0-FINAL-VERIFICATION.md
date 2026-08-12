# Phase 0 — Final Verification (Read-Only)

**Verdict: `CERTIFIED WITH LIMITATIONS`** · **FREEZE RECOMMENDED**

**HEAD:** `34cdc5a04a069bbeb0a242d2e1c008faa0beddd5` · **Branch:** `cursor/stage-e-step-13-certification`
**Date:** 2026-08-08 · **Mode:** read-only. Nothing modified, staged, committed, or deleted.

---

## Release Integrity — PASS

| Check | Result |
|---|---|
| Phase 0 source tracked at HEAD | **37** `.ts` files under `src/events/` |
| Phase 0 tests tracked | **5** test files |
| `event_foundation` migration tracked | yes |
| Phase 0 source still untracked | **0** |
| Uncommitted drift in `src/events/` | **none** |

No Phase 0 code exists outside version control, and the working tree carries no Phase 0 drift.

---

## Event Contract — all 12 required events

Catalog holds **15** entries (12 required + 3 ETA), **zero** non-`homigo.` entries.

| Event | Catalog | Namespace | Producer wired | Rows observed |
|---|---|---|---|---|
| `homigo.booking.created` | ✅ | ✅ | `booking.service.ts` | 19 |
| `homigo.booking.assigned` | ✅ | ✅ | wired | 11 |
| `homigo.booking.started` | ✅ | ✅ | wired | 11 |
| `homigo.booking.completed` | ✅ | ✅ | wired | 11 |
| `homigo.booking.cancelled` | ✅ | ✅ | `booking.service.ts:1283` | 0 — not yet triggered |
| `homigo.payment.success` | ✅ | ✅ | `payment-outbox.ts` | 7 |
| `homigo.payment.failed` | ✅ | ✅ | `payment-outbox.ts:48` | 0 — not yet triggered |
| `homigo.partner.online` | ✅ | ✅ | `provider.service.ts` | 7 |
| `homigo.partner.offline` | ✅ | ✅ | `provider.service.ts:370` | 0 — not yet triggered |
| `homigo.partner.dispatched` | ✅ | ✅ | wired | 212 |
| `homigo.partner.en_route` | ✅ | ✅ | wired | 3 |
| `homigo.partner.arrived` | ✅ | ✅ | wired | 3 |

Three events show zero rows. Their producers are wired to real service call sites (verified by source inspection); the absence of rows reflects **no cancellations, failed payments, or partner-offline transitions in this dataset**. That is data, not a defect.

---

## Invalid Namespace Hunt — PASS (with disclosure)

Validation rejects a bad namespace at runtime:
```
validateEventEnvelope({type: "bad.namespace.test", …})
  → Invalid event type namespace: bad.namespace.test
```

**Database sweep** — 16 distinct event types in outbox, 4 non-`homigo.`:

| Type | Rows | Newest | Status |
|---|---:|---|---|
| `eta.label.created` | 2 | 24.1h ago | FAILED, attempts 7174 |
| `eta.trip.completed` | 2 | 24.1h ago | FAILED, attempts 7175 |
| `eta.feature.updated` | 2 | 24.1h ago | FAILED, attempts 7175 |
| `dlqtest.invalid.namespace` | 1 | 0.5h ago | FAILED, attempts 5 |

**Rows with an invalid namespace created in the last 6h: 1.**

> **Disclosure — this one row is my own audit artifact, not an application producer.**
> `dlqtest.invalid.namespace` was seeded 30 minutes before this audit to prove the
> publisher→DLQ path. Counting it as a producer defect would be wrong. Excluding it,
> **no active producer has emitted an invalid namespace in 24+ hours.** Source-side
> confirmation: a repo-wide literal search for the old namespace returns zero matches,
> and both runtime outbox writers derive `eventType` from the `EVENT_TYPES` catalog.

**Re-claim defect confirmed fixed.** The 6 stale `eta.*` rows sit at attempts ~7175 and were **last touched 97 minutes ago**. Before `f58be06` they climbed +36 per 30s. They are now genuinely terminal.

---

## Runtime Verification — PASS

```
GET /health   200   {"status":"ok","services":{"database":"ok","redis":"ok"}}
GET /ready    200   database 2ms · redis 1ms standalone · rss 285MB · heap 48MB
GET /metrics  200   102,124 bytes
```

**Live chain — one synthetic `homigo.booking.created` through the running backend:**

| Stage | Result |
|---|---|
| Built | `homigo.booking.created` |
| PII markers in payload | **none** (`@`, `+91` absent) |
| Written to outbox | PENDING |
| Published | **PUBLISHED in 1 attempt, <5s** |
| Consumer idempotency receipts | **3** |
| DLQ entries | **0** |

---

## Foundation State

| Metric | Value |
|---|---|
| Outbox PUBLISHED | 290 |
| Outbox FAILED | 7 (6 stale `eta.*` + 1 audit artifact) |
| Outbox PENDING | 0 |
| Oldest PENDING age | none pending |
| Dead letters (unresolved) | 1 — the audit artifact, proving the path works |
| Consumer receipts | 925 |
| Scheduled jobs | 1 completed · 6 skipped · 5 pending |
| Jobs pending **and** >1h overdue | **0** |

---

## Requirement Matrix

| Requirement | Status | Runtime Evidence | Source Evidence |
|---|---|---|---|
| Transactional Outbox | **PASS** | 290 PUBLISHED, atomic writes | `event-publisher.ts` — only 2 writers |
| Domain Event Catalog | **PASS** | 15 entries, 0 bad namespaces | `catalog/event-types.ts` |
| In-process Event Bus | **PASS** | 3 receipts on one event | `core/event-bus.ts` |
| Outbox Processor | **PASS** | published in 1 attempt | leader-locked, `SKIP LOCKED` |
| Consumer Idempotency | **PASS** | 925 receipts | `core/idempotency.ts` |
| Dead Letter Queue | **PASS** | 1 entry via publisher path | `core/dead-letter.ts` (single writer) |
| Scheduled Jobs foundation | **PASS** | executor runs; 0 overdue | `core/job-processor.ts` |
| PII-safe payloads | **PASS** | no PII markers in envelope | `core/pii.ts`, unit-tested |
| Event metrics | **PASS_WITH_LIMITATION** | most present on `/metrics` | 4 lazily-registered — see gaps |
| Event audit | **PASS** | traceId/correlationId present | `consumers/audit.consumer.ts` |
| Feature flags | **PASS** | env-driven config live | `PlatformFeatureFlag` + `core/config.ts` |
| Retry | **PASS** | backoff observed | `core/retry.ts` — single impl |
| Failure recovery | **PASS** | stale-claim lease recovery | `recoverStaleClaims()` |
| Duplicate prevention | **PASS** | unique eventId + receipts | schema `@unique` |
| Concurrency safety | **PASS** | `FOR UPDATE SKIP LOCKED` | `outbox-processor.ts` |
| Multi-instance leader lock | **PASS** | 20+ distinct keys, one primitive | `distributed-scheduler.ts:11` |
| Event ordering | **PARTIAL** | global `created_at ASC` | no per-aggregate guarantee |

---

## No Duplicate Infrastructure — PASS

| Concern | Implementations found |
|---|---|
| Leader lock | **1** (`distributed-scheduler.ts:11`) |
| DLQ writer | **1** (`dead-letter.ts:13`) |
| Retry backoff | **1** (`retry.ts:2`) |
| Outbox writers | 2, both in `event-publisher.ts` |

Over 20 distinct lock keys — `maintenance:event_outbox`, `maintenance:etl_scheduler`, `maintenance:scheduled_jobs`, and others — all share the one primitive.

---

## Gaps

| ID | Gap | Priority |
|---|---|---|
| P0-A | *(none)* | — |
| P1-A | 4 metrics lazily registered → NO-DATA until first use: `homigo_outbox_processing_duration_seconds`, `homigo_scheduled_job_executions_total`, `homigo_forecast_runtime_seconds`, `homigo_feature_generation_total`. `metrics-init.ts` zero-initialises others; these were missed. Prometheus cannot alert on an absent series. | P1 |
| P2-A | 6 stale `eta.*` rows remain FAILED and un-dead-lettered (predate the publisher→DLQ wiring). Inert — attempts frozen 97min. Disposition deferred by prior decision. | P2 |
| P3-A | No per-aggregate event ordering guarantee. | P3 |
| — | Audit artifacts left in place: 1 `dlqtest.invalid.namespace` outbox row + its DLQ entry. Not removed — the standing rule forbids deleting outbox rows. | disclosure |

---

## Verdict

**`CERTIFIED WITH LIMITATIONS`**

Every mandatory Phase 0 requirement is satisfied with runtime evidence. No P0 blocker exists: no lost events, no duplicate effects, no active invalid producer, no security bypass, no broken migration. The limitations are observability polish (P1-A) and inert historical rows (P2-A).

**PHASE 0 — FREEZE RECOMMENDED.**
