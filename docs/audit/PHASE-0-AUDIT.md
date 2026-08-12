# Phase 0 Audit — Event & Reliability Foundation

**Score: 92%** · **HEAD:** `b582ead` · Audit-only

## Summary

The strongest foundation layer in the platform. Every mandatory Phase 0 primitive exists, is wired into real business services, and is provably running. Two deductions: the DLQ path has never been exercised, and the "Scheduled Jobs foundation" ships a producer without a consumer.

## Runtime Evidence

```
outbox by status:   { PUBLISHED: 285, FAILED: 6 }
dead letters:       0
consumer receipts:  900
distinct event types flowing: 15
```

Top event flow: `partner.dispatched` 212 · `booking.created` 19 · `booking.started` 11 · `booking.assigned` 11 · `payment.success` 7 · `partner.online` 7 · `booking.completed` 6

## Requirement Detail

**Transactional Outbox — IMPLEMENTED.** Two write paths only (`emitInTransaction` for in-transaction, `emitStandalone` outside), both in `events/core/event-publisher.ts`. Persists full CloudEvents-shaped envelope plus trace metadata.

**Event Catalog — IMPLEMENTED.** `events/catalog/event-types.ts` holds 15 types. All now carry the `homigo.` prefix, enforced by a regression guard added this session.

**Event Bus + Consumer Registry — IMPLEMENTED.** `dispatchEvent` fans out to registered consumers; failures isolated per consumer (verified in `event-bus.test.ts` — one consumer throws, the other still succeeds).

**Outbox Processor — IMPLEMENTED.** Leader-locked (`runWithLeaderLock`), batch claim with `FOR UPDATE SKIP LOCKED`, configurable batch size and interval, stale-claim lease recovery.

**Idempotency — IMPLEMENTED.** `EventConsumerReceipt` with 900 rows; `hasConsumerProcessed` short-circuits replays.

**Dead Letter Queue — PARTIAL.** `EventDeadLetter` model, `dead-letter.ts`, and `replayDeadLetterById` all exist. **0 rows** — the path has never executed, so correctness is unproven at runtime. Not a defect; an untested control.

**Scheduled Jobs foundation — PARTIAL.** Model and creation path exist and work. Nothing executes the jobs. See P0-2 in the gap register.

**PII-safe payloads — IMPLEMENTED.** `sanitizeEventPayload` strips prohibited keys recursively; `assertNoProhibitedPii` throws on leakage. Tests assert both, including nested objects.

**Metrics / Audit / Feature Flags — IMPLEMENTED.** `homigo_outbox_publish_total` and `homigo_outbox_processing_duration_seconds`; `audit.consumer.ts` maps events to audit categories; `PlatformFeatureFlag` + `PlatformFeatureFlagHistory` plus env-driven `eventPlatformConfig`.

**All 12 roadmap events — IMPLEMENTED.** Nine have flowed; `booking.cancelled`, `payment.failed`, `partner.offline` are wired to real call sites (`booking.service.ts:1283`, `payment-outbox.ts:48`, `provider.service.ts:370`) but have not yet been triggered in this dataset. Registered *and* wired — absence of rows is data, not a defect.

**Existing-system compatibility — IMPLEMENTED.** `notification.service.ts` remains untouched and runs in parallel, as the roadmap required.

**Retry / Recovery / Duplicate prevention / Concurrency — IMPLEMENTED.** Exponential backoff; lease-expiry recovery; unique `eventId` plus receipts; skip-locked claims with instance IDs.

**Event ordering — PARTIAL.** Claims are globally ordered by `created_at ASC`, but there is no per-aggregate ordering guarantee. Acceptable for current consumers; would matter for strict per-booking sequencing.

## ETA Namespace Remediation (verified)

Fixed in `914c7dd`. Repo-wide literal search for the old namespace returns **0 matches**. Both runtime outbox writers derive `eventType` from the `EVENT_TYPES` catalog, so no runtime path can emit the old form. A follow-up defect found this session — terminal-`FAILED` rows being re-claimed every 5s forever — was fixed in `f58be06`; the attempt delta fell from +36/30s to **+0/30s**.

6 stale `eta.*` rows remain, now inert. Disposition deferred by prior decision.

## Gaps

| ID | Gap | Priority |
|---|---|---|
| P0-2 | Scheduled-job execution engine missing | P0 |
| P2-1 | DLQ never exercised | P2 |
| P3-1 | 6 stale eta.* rows | P3 |
| P3-2 | No per-aggregate ordering | P3 |
