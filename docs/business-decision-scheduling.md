# Business decision — partner slot duration

Status: **DECIDED 2026-09-21 — option B implemented** (laundry/turnaround services keep the fixed block). Ratified for launch 2026-10-10 in `docs/phase-1-business-decisions.md`. See `docs/service-domain/phase-04-quantity-duration.md` addendum and migration `20260921180000_duration_aware_partner_slot`. The text below is the original 2026-09-20 question record; the last paragraph is historical.

Searched (2026-09-20): `docs/release-decisions-required.md` D1, `docs/release-business-decisions.md` D1, `OWNER_DECISIONS_REQUIRED.md`, migration `20260909090000_booking_slot_half_open_ranges`, trigger `bookings_sync_conflict_slots`, characterization `scheduling-contract.characterization.test.ts`. No product owner answer exists in the repository.

## Current behaviour

Every booking occupies a **fixed 60-minute** partner/customer slot:

`[scheduled_date − 30 minutes, scheduled_date + 30 minutes)`

Enforced by:

- trigger `bookings_sync_conflict_slots`
- GiST exclusion `bookings_provider_slot_excl` / `bookings_user_slot_excl`
- application `BOOKING_BUFFER_MINUTES = 30`

`estimatedDuration` and `catalogConfig.duration.totalSlotMin` are stored and shown. They are **not** the reserved range.

A 4-hour Hourly Home Help at 10:00 blocks 09:30–10:30 only. The same partner can be booked at 11:00.

## Business consequence

Partners can be double-booked during hours 2–N of a long job. Customers are not promised a duration-long exclusive reservation in API copy.

## Technical consequence

Changing the rule is a **protected-object** migration: rewrite the trigger to use `estimated_duration` (plus buffer), keep the exclusion constraint as authority, decide backfill for future rows, re-baseline the characterization test, and update availability/conflict helpers to the same range.

## Options

| ID | Policy |
|---|---|
| A | Keep the 60-minute protected slot. Document it as intentional. Long jobs need operational care. |
| B | Reserve `[start − buffer, start + duration + buffer)`. |
| C | B only for HOUR-quantity / Hourly Home Help; other SKUs stay A. |

## Required owner decision

Choose A, B, or C. If B or C: state the travel buffer and whether existing future bookings are re-slotted.

Closed: option B + FIXED exception. The trigger was modified in `20260921180000_duration_aware_partner_slot`. This gate is not BLOCKED.
