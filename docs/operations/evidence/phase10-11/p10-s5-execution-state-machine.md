# Phase 10 §5 — Execution state machine

**Status:** FROZEN — fixed in code, regression-protected (3434/0). The DB guard is applied to the test DBs only. Live needs OP-5.

## What already existed (reused, not duplicated)

- `lib/booking-state-machine.ts`: one transition table, read by every writer.
- `booking_status_history`: an append-only history written by a trigger.
- `setBookingAuditContext`: transaction-local actor, reason and request id.
- `lib/booking-realtime.ts`: the one publisher.
- The payment gate, with its audited override.

The brief's conceptual stages map onto these without a new enum:

| Brief stage | Where it lives |
|---|---|
| ASSIGNED | `ACCEPTED` (partner accepted) / `ASSIGNED` (admin assigned) |
| EN_ROUTE | `EN_ROUTE` |
| ARRIVAL | `arrivedAt` fact (ADR-018, not a status) |
| VERIFICATION | start-PIN record (`booking-start-otp`) |
| SERVICE_START / EXECUTION | `IN_PROGRESS` |
| QUALITY | `resolveQualityEvidence` gate inside `complete()` (W2-D1) |
| COMPLETION | `COMPLETED` |
| CONFIRMATION / WARRANTY | §15/§16, §18 |

Adding ARRIVED or VERIFIED as statuses would fork every consumer of the enum. A structural test pins that neither exists.

## Audit — every writer of `bookings.status`

35 `booking.update*` call sites were scanned, plus raw SQL. 12 write status.

| Writer | Guard before | Finding |
|---|---|---|
| accept | row `FOR UPDATE` + status check under lock | sound |
| start | `updateMany where status IN predecessors` | sound, **except the override path (S5-2)** |
| complete | `where status = IN_PROGRESS` | sound; **admin actor mis-recorded (S5-7)** |
| cancel | `where status IN cancellable` | sound |
| en route | `where status IN (ACCEPTED, ASSIGNED)` | **no partner in the where clause, no actor (S5-4)** |
| arrival (fact) | `where arrivedAt IS NULL` only | **no status, no partner (S5-5)** |
| admin reassign | `where status IN reassignable` | sound |
| admin repair | `update where { id }` | **unguarded, unattributed (S5-8)** |
| no-show (both) | `update where { id }` | **unguarded: check outside tx (S5-1)** |
| payment expiry (raw) | `FOR UPDATE` + re-check | sound; **not published realtime (S5-10)** |
| assignment timeout/reject | `where status = PENDING` | sound; **unattributed (S5-4)** |
| any raw SQL / future writer | none | **no DB-level terminal protection (S5-3)** |

- **Routes:** none writes a booking directly, and none accepts a target status from the client. This is pinned structurally.
- **Live measurement** (homigo_db, read-only):
  - 21 status changes are recorded since the history table began.
  - **5 have no actor, and all 5 are EN_ROUTE**: that is S5-4, observed.
  - 0 terminal rewrites, so S5-1/S5-3 are latent, not yet hit.
  - 0 arrivals stamped on a closed booking.

## Defects

| Id | Defect | Root cause | Fix |
|---|---|---|---|
| S5-1 | a no-show could overwrite a COMPLETED/CANCELLED job and settle twice; concurrent reports all "won" | status checked outside the tx, written `where { id }` | `close()` writes `where { id, status: seen, providerId: seen, arrivedAt NOT NULL }`, returns `false` to the loser, and the loser settles nothing |
| S5-2 | **refunded → start**: a stale admin override (granted while unpaid) carried a refunded booking into IN_PROGRESS | override honoured for every non-SUCCESS state | `RETURNED_PAYMENT_STATUSES` (REFUNDED, REFUNDING, EXPIRED) are never overridable, in the single gate and in start's forced path. No new error code: it stays `PAYMENT_NOT_SETTLED`, which routes already map |
| S5-3 | terminal resurrection possible via raw SQL, a forgetful writer, or a race | enforcement only in application code | trigger `bookings_terminal_status_guard_trg` (BEFORE UPDATE OF status). It guards terminal immutability **only**: it is not a second transition table. Its list is pinned equal to `TERMINAL_BOOKING_STATUSES` |
| S5-4 | EN_ROUTE and offer-release partner changes recorded with no actor | writers never set the audit context | `setBookingAuditContext` in `commitEnRoute`, timeout release (system) and reject (partner) |
| S5-5 | arrival (the no-show evidence) could be stamped on a cancelled booking or by a partner who lost the job | where clause `arrivedAt IS NULL` only | where clause now includes `providerId` + live statuses; `commitEnRoute` also names the partner |
| S5-6 | admin no-show reason was required by the route and then dropped | route never passed it | `reason` flows into the history row |
| S5-7 | admin mark-complete recorded as the partner | `complete()` hard-coded the partner actor | `opts.auditActor` |
| S5-8 | admin repair wrote a partner unguarded and unattributed | `update where { id }` | guarded `updateMany` + audit context |
| S5-9 | no trace id on transitions | history only had request id | `trace_id` column + `homigo.trace_id` setting (column kept out of the Prisma model so the live `--watch` backend cannot select a missing column) |
| S5-10 | EXPIRED never reached open apps | sweep emitted outbox only | `publishBookingStatusBackground` after commit |

## Tests

- **`p10-s5-execution-state-machine.test.ts`**: 24 structural and table tests. They cover:
  - the forbidden transitions the brief names;
  - the gate override rules;
  - trigger list = `TERMINAL_BOOKING_STATUSES`;
  - migration additivity;
  - a **scanner that fails on any status write whose where clause names no status**. One exemption (accept, which holds the row lock) is itself pinned. The scanner flags the old no-show `close()` (line 4) and passes the new one.
- **`p10-s5-execution-state-machine.integration.test.ts`**: 14 tests on homigo_test. They cover:
  - raw SQL and the ORM refused on all 7 terminal statuses, with controls: non-status fields still update, and active rows still move;
  - expired → accept, no-show/cancelled → start and refunded-with-override → start are all refused, with a control: the same override starts an unpaid job;
  - a stale no-show write loses;
  - no arrival on a cancelled booking, and no arrival or en route by a non-holder;
  - **10 concurrent no-show reports from both sides → exactly one winner, one terminal history row, every loser `INVALID_STATUS`**;
  - an admin no-show history row carries actor, reason, request id and trace id.

**Reintroduction proofs** ran in the isolated copy `D:/homigo-w2-scratch`, so the live backend never loaded reverted code. Each fix was reverted alone, the suite run, and the file restored.

| Reverted | Result |
|---|---|
| R1 no-show unguarded write | 2 fail (stale write, concurrency) |
| R2 returned-payment check in start | 1 fail (refunded → start) |
| R3 arrival status/partner guard | 2 fail |
| R4 en-route audit context | 1 fail |
| R5 trace id setting | 1 fail |
| R6 admin reason | 1 fail |
| R7 trigger disabled on homigo_test (re-enabled after; `tgenabled = O` verified) | 2 fail |

- **Typecheck:** `tsc --noEmit` exit 0.
- **Runtime:**
  - The live backend hot-reloaded the change: `/health` 200, `/ready` all healthy.
  - The extra `set_config('homigo.trace_id', …)` is harmless on a database without the migration.
- **Browser:** no UI surface changed in this section. Customer web already renders `expired` (`lib/booking-status.ts`, `use-booking-status-subscription.ts`), so the new realtime event has a consumer.

## Full regression

**Run 1:** 3432 pass / **2 fail** / 282 files. Both failures were classified, not rerun away:

| Failure | Class | Resolution |
|---|---|---|
| my own writer scanner flagged `refundStatus: result.status }` in 4 places | **my defect**: the shorthand branch I added matched a `.status` member access | regex narrowed to a property key (`(?<![.\w])status`); re-proved: still flags the old no-show `close()` and old admin-ops writers, no longer flags refund bookkeeping |
| `phase09-late-capture` “booking recovered after expiry” | **test fabricated an impossible state**: a raw `UPDATE … EXPIRED → PENDING`. No product path recovers an expired booking (EXPIRED is terminal, owner decision), and the new trigger now refuses it | rewritten in the honest shape its sibling MULTIPLE_PAYMENTS test already uses: it asserts the DB refuses the recovery, the booking stays EXPIRED, and no gateway refund happens. The resolver guard stays as defence in depth |

**Run 2** (after the two fixes above, no reruns): **3434 pass / 0 fail / 282 files**, exit 0.

**§5 frozen.**

## Operator action

| Id | Action | Effect until done |
|---|---|---|
| OP-5 | apply migration `20260924120000_booking_terminal_status_guard` to homigo_db | live keeps application-level protection only (S5-1 is fixed in code); no trace id in live history |
