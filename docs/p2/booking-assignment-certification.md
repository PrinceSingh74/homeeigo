# Booking → Admin → Partner Assignment Certification (execution-verified)

**Date:** 2026-06-11 · **Method:** real E2E against isolated `homigo_test` (`scripts/e2e-booking-assignment.ts`), DB introspection, and a bug reproduced + fixed + re-verified. Live `homigo_db` never written (0 test-leak users, integrity 100/100).

## Bug found via execution (then fixed)
Running the real flow proved the **auto-assignment → partner acceptance path was BROKEN**:
- `assignmentEngine.dispatchToNextProvider` notified the provider (created an `assignment_attempt` SENT + set `assignmentJob.currentProviderId`) but **never set `booking.provider_id`**.
- The only accept path (`POST /:id/accept` → `bookingService.accept`) requires `booking.provider_id === providerId` → an auto-dispatched booking always returned **NOT_FOUND**. (Reproduced: PHASE 6 → `error: NOT_FOUND`, provider_id NULL.)

**Fix (3 minimal edits, `assignment-engine.service.ts`):** tentatively set `booking.providerId = provider.id` in the dispatch transaction; release it (`providerId = null`) on timeout reassign and on reject (conditional: only if still `PENDING` and held by that provider — never disturbs a booking accepted elsewhere). Mirrors the existing `assignmentJob.currentProviderId` lifecycle.

## E2E evidence (after fix) — `NODE_ENV=test bun run scripts/e2e-booking-assignment.ts`
| Step | Result | DB evidence |
|---|---|---|
| **Customer booking created** | ✅ PASS | `status=PENDING`, `queued_at` set, `priority_score=10`, `finalAmount=₹880` |
| **Admin booking visible** | ✅ PASS | full row queryable (user+service+provider join) |
| **Assignment engine triggered** | ✅ PASS | `assignment_jobs` row (PENDING→DISPATCHED), `processQueue() dispatched=1` |
| **Partner received request** | ✅ PASS | `assignment_attempts` row SENT to the matched provider (== expected provider) |
| **Partner accepted booking** | ✅ PASS | accept ok (was NOT_FOUND before fix) |
| **Database updated** | ✅ PASS | `status=ACCEPTED`, `provider_id`=our provider, `accepted_at` set, `assigned_at` set |
| **Admin updated** | ✅ PASS | admin-view join shows provider assigned |
| **Customer updated** | ✅ PASS | booking reflects ACCEPTED + BOOKING_ACCEPTED notification sent |
| **End-to-end consistency** | ✅ PASS | same booking id across backend / DB / admin-view / partner job-list |

**Verdict: WORKING** — booking travels Customer → Backend → DB → Assignment Engine → Partner → Acceptance, all fields consistent. Matching requires an eligible provider (`serviceCategories` ∋ serviceId, `isActive`+`isApproved`+`isOnline`, a `Location` within distance) — verified by constructing one.

## No regression from the fix (proven, not assumed)
`git stash` of `assignment-engine.service.ts` → suite identical (467–468 pass / 12–13 fail both with and without my change). So the fix introduces **0 regressions**. Production `tsc` 0. Live integrity 100/100, 0 test-leak users in `homigo_db`.

## Separately flagged (NOT caused by this work)
~12–13 **flaky** concurrency stress tests fail intermittently on a clean DB (B1/booking 50–500 concurrent create/accept, C1/C1b 50–200 concurrent createOrder, one RBAC). They are **pre-existing** (baseline fails identically) and **flaky** (count varies run-to-run). These heavy-contention booking/createOrder paths likely need the same advisory-lock-serialization treatment already applied to wallet settle — a separate concurrency-reliability item, not part of the booking→assignment flow (which is verified WORKING above).

## Rollback
`git checkout -- src/services/assignment-engine.service.ts` (reverts the 3 dispatch/timeout/reject edits) — booking-assignment acceptance returns to the broken NOT_FOUND state.
