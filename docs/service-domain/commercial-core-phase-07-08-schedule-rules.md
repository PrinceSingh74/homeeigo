# Commercial Core — Phase 07/08: eligibility, serviceability and schedule rules

Status: implemented (Wave 2). Authority for "may this service be booked, for this address, at this
instant, with this partner?". Phase 05 (money) and Phase 06 (requirements) are unchanged by this
work and remain their own authorities.

---

## 1. What was wrong before

Measured on the codebase as it stood, not inferred:

| # | Defect | Where | Effect |
|---|---|---|---|
| S1 | Same-day was judged with the **server's** local calendar (`toDateString`), blackout dates with **UTC** (`toISOString().slice(0,10)`) | `booking-validation.service.ts` | Two different notions of "day", neither the business's. A 00:30 IST slot on a blacked-out date is 19:00 UTC the *previous* day, so it was accepted. |
| S2 | A hard 30-day cap was applied a second time with no service config in hand | `validateScheduledDate` | A service configured `maximumAdvanceDays: 60` was still refused at 31 days. The configuration was dead. |
| S3 | The partner working-window check looked only at the appointment's **first minute** | `validateBookingDetails` → `isWithinWorkingWindow` | A 3-hour job starting 17:30 was accepted against a window closing at 18:00 — the partner was committed to 2.5 hours they never offered. |
| S4 | **Reschedule ran no time rules at all** — conflict detection only | `booking.service.update` | A confirmed booking could be moved into the past, onto a blackout date, inside the lead time, or to 03:00. |
| S5 | Every rule collapsed into one opaque code | `routes/bookings.ts` | A lead-time refusal was reported to the customer as *"Invalid service or address. Add a saved address and try again."* — sending them to fix something that was never wrong. |
| S6 | Admin reschedule had **no status guard**, no audit actor and no date validation | `admin-booking-operations.service.ts` | A COMPLETED booking's date could be rewritten, re-reserving a slot for work already done, with no actor recorded on the history row. |
| S7 | Customer reschedule used a **deny-list** of statuses that omitted `REJECTED` | `booking.service.update` | A booking the partner had rejected could still be moved and re-reserve the window. |
| S8 | The quote never checked **coverage** | `booking-pricing.service.quote` | A customer could be given a complete, signed, priced quote for an address the service cannot be delivered to, and only be refused at the final step. |
| S9 | The web schedule step claimed *"Great! Fastest available slot secured."* | `BookingScheduleSection.tsx` | Nothing was reserved, nothing was checked, and no slot was "fastest". The banner was unconditional. |

## 2. The rule authority

`src/lib/service-availability.ts` — pure, no database, one implementation:

```
evaluateServiceTimeRules({ scheduledDate, now?, availability?, sameDayAvailable?, timeZone? })
  → { ok: true } | { ok: false; reason: ServiceTimeReason; message: string }
```

`ServiceTimeReason` = `INVALID_DATE | SLOT_IN_PAST | LEAD_TIME_NOT_MET | BEYOND_ADVANCE_WINDOW |
SAME_DAY_UNAVAILABLE | BLACKOUT_DATE`.

- **Instant rules** (past, lead time, advance window) compare canonical instants.
- **Civil-date rules** (same-day, blackout) resolve the date in the business timezone
  (`BUSINESS_TIMEZONE = "Asia/Kolkata"`) via `Intl.DateTimeFormat("en-CA")`, then compare calendar
  dates. The timezone is a **parameter**, not an assumption baked into the rules: every live service
  is in an Indian city today, and a multi-timezone future passes the location's IANA zone.
- `DEFAULT_MAX_ADVANCE_DAYS = 30` applies **only** when a service configures no
  `availability.maximumAdvanceDays`. A configured value always wins, in either direction.

`isAppointmentWithinWorkingWindow(schedule, start, durationMinutes)` in `partner-ops-clock.ts` is the
partner half: the whole appointment must fit, using the same reservation length the slot engine uses
(owner decision D1 — `0` for `partnerSlotPolicy = FIXED`, whose "duration" is a turnaround time
rather than occupancy, so for those it is the start check unchanged).

### Consumers

| Path | Calls | Notes |
|---|---|---|
| Booking create | `validateBooking` → `validateService` + `validateBookingDetails` | unchanged entry point |
| Customer reschedule | `validateReschedule` (new) | same rules, before the locking transaction |
| Admin reschedule | status allow-list + audit context | admins may still override the *time* window deliberately; the override is recorded |
| Quote | `coverageAllowsAddress` | serviceability only; time rules stay at booking |

**Reschedule deliberately does NOT re-run the sellability gate.** It moves an appointment that already
exists. Gating it on the service still being bookable would mean retiring or suspending a service
silently blocks customers from moving bookings already placed, leaving cancellation as their only
option — a restriction that was never a platform rule, so it is not invented here. The time rules and
the partner's window still apply, because they describe whether the NEW instant is workable. Pinned
by "a service that stops being bookable does not trap its existing bookings", which also asserts that
a NEW booking of that service is still refused.

Conflict and overlap detection is untouched: it stays inside the transaction under
`pg_advisory_xact_lock` + `FOR UPDATE` (`assertBookingConflictFree`), because it is the only part
that must be atomic with the write.

## 3. Error contract

| Code | Reason values | HTTP | Meaning |
|---|---|---|---|
| `SCHEDULE_NOT_ALLOWED` | the six `ServiceTimeReason`s | 400 | the instant breaks a service rule |
| `PROVIDER_UNAVAILABLE` | `OUTSIDE_WORKING_HOURS`, or absent for a slot conflict | 400 | the partner cannot take it |
| `SERVICE_NOT_AVAILABLE` | — | 400 | not bookable, or not covered at this address |
| `OVERLAPPING_BOOKING` | — | 409 | the customer already has that window |
| `INVALID_STATUS` | — | 400 | this booking's schedule can no longer be changed |

`code` is the stable contract; `reason` is additive; `message` is customer-safe copy that may change.
Existing clients switch on `code` and fall back to the server's `message`, so the specific copy
surfaces on web and mobile with no client change required.

Metric labels on `service_availability_failures_total` are pinned to the values the existing
dashboards already query (`lead_time`, `advance_window`, `same_day`, `blackout`, `coverage`,
`not_bookable`), plus `past`, `invalid_date` and `outside_working_hours`.

## 4. Deliberate behaviour changes

1. **An appointment that would run past the partner's closing time is now refused.** A 3-hour job
   at 17:00 against a `09:00–18:00` window no longer books.

   The first version of this rule required the appointment to END before the close of its START
   day, which also refused a 4-hour job at 23:00 for a partner working `00:00–23:59` — an all-day
   partner who can genuinely do it. Several existing suites (whose fixtures seed slots at "the
   current hour") started failing only when the run crossed IST midnight, which is what surfaced it.
   The rule was corrected rather than the fixtures: each ENDPOINT is judged against the window on
   its own day, plus a guard that an appointment longer than the window itself fits no day. So an
   all-day partner may cross midnight; a `09:00–18:00` partner may not; and crossing into a
   NON-working day is still refused. No assertion anywhere was relaxed.
   Measured against live data before shipping (`homigo_db`, read-only): of the **84** active future
   bookings whose partner has configured hours, **0** would be refused by the new rule, so nothing
   already booked is invalidated. Of 319 active partners, 191 have no hours configured at all — for
   them the window check is a no-op, exactly as before.
2. **A configured advance window longer than 30 days now works.** Previously capped.
3. **A reschedule can be refused for a reason other than a conflict.** New `SCHEDULE_NOT_ALLOWED`
   responses on `PUT /api/bookings/:id`.
4. **`REJECTED` bookings can no longer be rescheduled** by the customer.

## 5. Still owner decisions — not implemented, not faked

| Id | Question | Why it is blocked |
|---|---|---|
| O1 | Platform business hours and the slot grid | The 6 time chips on the web booking step are a hardcoded client list. A server-side availability projection needs the owner's opening hours and slot granularity. |
| O3 | No-show / late-arrival policy | No model exists; nothing is inferred. |
| O4 | Eligibility dimensions beyond ban/active/approval, and the verified data source for them | |
| O5 | One coverage truth: `service.availableCities` and `catalogConfig.coverage` are both consulted today | Merging them changes who can book what, so it is the owner's call. |
| O6 | Reschedule policy: how late, how many times, and at what fee | Currently any live booking may be moved any number of times, free. That is the existing behaviour, left unchanged rather than invented. |

## 6. Evidence

- `src/__tests__/service-availability.test.ts` — 9 tests, fixed clocks (no test depends on when it runs).
- `src/__tests__/phase07-08-schedule-rules.test.ts` — 9 tests: whole-appointment window, timezone,
  status allow-list, and a completeness check that every `BookingStatus` is decided.
- `src/__tests__/phase07-08-schedule-rules.integration.test.ts` — 17 tests over real HTTP against the
  isolated test database: each refusal's code and reason, the IST-vs-UTC blackout case with an
  in-test assertion that UTC really does disagree, the 60-day horizon, the overrunning appointment,
  reschedule into the past / onto a blackout / outside hours, `REJECTED`, admin refusal on
  `COMPLETED`, the admin actor landing on the status-history row, quote-time coverage (refused,
  location-agnostic, restored), and the retired-service reschedule case.

### Browser verification

Run on an isolated stack (web :3011 → backend :3100 → `homigo_test`, `/health` asserting
`"isolatedDatabase":true`), with the owner's own servers left running and untouched and the isolated
web build confined to its own dist dir. Signed in through the real form, then confirmed a booking
inside the service's 48-hour lead time:

- the schedule step renders "We'll confirm this slot when you place the booking."; the former
  "Great! Fastest available slot secured." is gone;
- `POST /api/bookings` → 400 `SCHEDULE_NOT_ALLOWED` / `LEAD_TIME_NOT_MET`, message *"This service
  needs at least 48 hours' notice. Please choose a later slot."*;
- the response does **not** mention a saved address, and the rule text is what the customer sees.

Every test-database change made for the run was reverted afterwards.

### Defect reintroduction matrix

Each fix was reverted one at a time in an isolated copy on D: (`homigo_test` only, never the live
database or the live backend), the suites re-run, and the file restored byte-identically. A green
baseline is asserted before any reintroduction, so a red baseline cannot produce meaningless results.
Full log: `docs/operations/evidence/commercial-core-wave2-reintroduction-2026-09-23.txt`.

| Id | Reintroduced defect | Result |
|---|---|---|
| V1 | civil dates back to UTC | CAUGHT (6 failures) |
| V2 | hard 30-day cap overrides the configured window | CAUGHT (2) |
| V3 | working window judged on the first minute only | CAUGHT (5) |
| V3b | the "longer than the window" guard removed | CAUGHT (1) |
| V4 | reschedule drops the schedule verdict | CAUGHT (3) |
| V5 | create collapses every rule into the generic message | CAUGHT (4) |
| V6 | admin reschedule loses its status guard | CAUGHT (1) |
| V7 | customer pre-check reverts to the deny-list | **NOT CAUGHT** — masked by the in-transaction check, which is the same allow-list. Defence in depth, reported rather than hidden. |
| V7b | *both* layers revert to the deny-list | CAUGHT (1) |
| V8 | quote stops checking coverage | CAUGHT (1) |
| V9 | admin reschedule writes without an audit actor | CAUGHT (1) |
| V10 | same-day compares with the server's local calendar | CAUGHT (1) |

11 of 12 caught; the one miss is explained above and is a property of the fix, not a gap in the tests.
After restoration all six touched files were byte-identical to the repository and the suites returned
38/0.

---

## 7. Wave 3 (Phase 09) — designed, not yet built

Recorded here so the sequencing is explicit; each item names the authority it extends rather than
adding a second one.

| Id | Item | Design | Blocked on |
|---|---|---|---|
| W3.1 | Bounded idempotency for booking create | `Idempotency-Key` header (opaque, ≤128 chars) + additive table `booking_idempotency_keys` (unique `(user_id, key)`, request fingerprint, resulting booking id, 24h expiry, swept). Same key + same fingerprint returns the same booking; same key + different fingerprint is `IDEMPOTENCY_KEY_REUSED`; in-flight is `REQUEST_IN_FLIGHT`. **No header = today's behaviour**, unchanged — dedupe is never inferred. | — |
| W3.2 | Versioned policy snapshot | `serviceConfigSnapshot.policy = { version, cancellation: tiers }` written at create; cancellation reads the snapshot when present and the current policy only for rows that predate it, so a later policy edit cannot re-price an old booking's refund. Also fixes a live contract defect: the published tier id is `late` but `calculate()` returns `very_late` for the same window (the *amounts* agree — 25% fee / 75% refund — so no money is wrong, but no client can match the returned tier to the published policy; nothing persists the id, so aligning it is safe). | — |
| W3.3 | Schedule / serviceability snapshot | Extends the same `serviceConfigSnapshot` object (no schema change) with `schedule` (timezone, lead time, advance window, same-day, blackout dates applied, slot duration, reserved window) and `serviceability` (city, pincode, coverage decision) — the inputs that decided this booking, frozen against later catalogue edits, exactly as Phase 06 froze `requirements` and Phase 05 froze `pricing`. | — |
| W3.4 | `booking.rescheduled` outbox event | The catalogue has created / assigned / started / completed / cancelled, but no rescheduled event, so a schedule change reaches no consumer. The gap is already load-bearing elsewhere: the AI tool catalogue declares `eventMapping: "homigo.booking.rescheduled"` for `write.booking.rescheduleBooking` (`ai-tools/registry/tool-catalog.ts`), an event nothing emits. Emitted in-transaction from the single reschedule path (customer and admin). | — |
| W3.5 | Missed-webhook payment reconciliation | Sweep bookings awaiting payment past a threshold that hold a gateway order, query the gateway, and reconcile a capture the webhook never delivered. The *reconcile* half is safe to build now; the *expire* half needs O2. | O2 (pending-payment TTL) |

---

## 8. Wave 4 — availability + slots API (owner-authorised policy, 2026-09-23)

O1 is decided. The owner's policy, to be implemented as the **server's** projection, never the
client's guess:

| Parameter | Value |
|---|---|
| Timezone | `Asia/Kolkata` |
| Customer operating window | 07:00–22:00 |
| Slot grid | 30 minutes |
| 24×7 | only by explicit configuration |
| Midnight crossing | supported |
| Occupancy buffer (D1) | unchanged: `[start − 30m, end + 30m)` |

**What exists today:** nothing. The six time chips on the web booking step are a hardcoded client
array (`BOOKING_TIMES` in `apps/web/src/lib/services.ts`), and there is no availability endpoint at
all. A customer can therefore pick a time the platform will refuse — which is exactly the class of
defect Phase 07/08 removed from the *answer* but not yet from the *question*.

**Design.** A pure grid builder plus one service that answers, for a service and a civil date:

1. build the 30-minute grid across the operating window in the business timezone;
2. run each candidate start through `evaluateServiceTimeRules` — the same authority booking create
   uses, so the list can never offer a slot that create would refuse;
3. load qualified, covering providers **once**, with their working windows and their existing
   reserved windows for that day;
4. a slot is offered when at least one provider's window fits the WHOLE appointment
   (`isAppointmentWithinWorkingWindow`) and its `[start − 30m, end + duration + 30m)` does not
   overlap that provider's reserved windows — the same predicate the exclusion constraints enforce;
5. every unavailable slot carries the reason it is unavailable, so the UI explains rather than hides.

The client then renders what the server returned. No slot list is computed on the client.
