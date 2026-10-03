# Phase 04 — Quantity, unit, duration

Status: **PASS** (2026-09-21). Owner decision D1 made and implemented the same day — see the addendum at the end.

## Quantity

The model is unchanged in shape: `catalog_config.quantity` = type, unitLabel, unitLabelPlural, min, max, step, default, unitPrice, minimumCharge, durationPerUnitMin, plus **new** `required`. Variant overrides set min, max and unitPrice (the schema now rejects an override with max < min).

**Integer only.** Every quantity type the catalogue uses (hours, rooms, seats, units) is whole. `DECIMAL` / `BOOLEAN` / `ENUM` quantity types were not added, because no service or flow needs them.

Server validation reports a specific issue for each case:

| Issue | Condition |
|---|---|
| `QUANTITY_NOT_INTEGER` | NaN, ±Infinity, any fraction (incl. 2.0000001) |
| `QUANTITY_BELOW_MIN` | below the minimum (incl. negative) |
| `QUANTITY_ABOVE_MAX` | above the maximum (incl. 1e15, `MAX_SAFE_INTEGER`) |
| `QUANTITY_STEP` | not on a step |
| `QUANTITY_REQUIRED` | required and not sent |
| `QUANTITY_NOT_ALLOWED` | a quantity on a service with no rule |

The booking route also caps quantity at 1–1000 integers (zod). Add-on units are validated separately (`ADDON_QUANTITY`).

Configured data today: only Hourly Bookings has a quantity rule (HOUR 1–4 × ₹199). No unit prices were invented for other services.

## Duration — one calculator

`resolveServiceDuration()` (`lib/service-catalog-config.ts`) is the only duration calculator. The second one (`operationalSlotMinutes`) was removed, and `selectionDurationMinutes` delegates to the calculator.

| Output | Meaning |
|---|---|
| serviceMinutes | variant duration, else `duration.serviceMin`, else `totalSlotMin − prep − cleanup`, else `estimated_duration`; scaled by quantity (HOUR ×q; `durationPerUnitMin` per extra unit) |
| addonMinutes | Σ add-on minutes × units |
| preparationMinutes / cleanupMinutes | once per booking |
| totalMinutes | prep + service + add-ons + cleanup; this is `booking.estimatedDuration` |
| customerEstimate | the customer-facing estimate and range (`estimatedMin`, `minMin`, `maxMin`), scaled the same way. Kept **distinct** from operational service time. |

**Defect fixed:** HOUR scaling used to multiply preparation and cleanup together with service time. Live data is unaffected: Hourly Bookings has no duration block, so 60 min × q is unchanged.

Configuration validation (zod):
- `min ≤ estimated ≤ max` (`DURATION_RANGE_INVALID`);
- positive whole minutes everywhere (zero, negative, NaN, Infinity and fractions are rejected);
- `totalSlotMin` must equal prep + service + cleanup (`DURATION_INCONSISTENT`). It is a declared total, never a silent override. The pre-existing test that asserted the override (90 vs parts summing to 60) was rewritten to the corrected rule.

## Slot vs duration (owner decision still open)

The partner calendar reserves a **fixed** `[start − 30 min, start + 30 min)` slot (trigger `bookings_sync_conflict_slots`, protected GiST exclusion). It is independent of the service duration. This is the open owner decision D1 (`docs/business-decision-scheduling.md`), so it was **not changed**.

The duration calculator does not compute travel, because nothing in the platform models travel per service. The slot trigger was untouched and the characterization test still pins it.

## Surfaces

- **Customer:** "Estimated service time" (range when configured), and the Preparation / Service / Add-ons / Clean-up / Total appointment breakdown only when those parts exist. Internal scheduling (the 60-minute reservation) is not shown. Verified in the browser: "Estimated service time: 1 hr / 45 min / 2 hrs / 30 min" on live services.
- **Partner:** "Expected N min", with a prep/service/clean-up breakdown on the job detail (web and mobile).
- **Admin:**
  - editable fields: estimate, shortest/longest range, prep, service, cleanup, total appointment;
  - an inline note that the calendar reserves a fixed slot;
  - the inspect panel shows the resolved appointment and `reservedSlotMinutes`;
  - impossible combinations come back as `INVALID_CONFIG` with the path.

## Tests

- `service-selection-resolver.test.ts`: min/max/step; NaN/Infinity/decimal/negative/huge; variant-specific bounds; required; add-on units; total = sum; HOUR scaling; no-config legacy parity; customer estimate vs service time; schema zero/negative/NaN/Infinity/fraction/range/inconsistent totals.
- Reintroduction proofs, each GOOD → FAIL → RESTORED:
  - P4: removing the max check fails 4 tests;
  - P5: removing the sum-to-total check fails 2 tests.

## Addendum — owner decision D1 implemented (2026-09-21)

The owner chose **option B**: a booking reserves the partner (and the customer) for
`[start − 30 min, start + appointment minutes + 30 min)`. Laundry & fabric services store a turnaround time, not on-site time, so the owner chose that they keep the fixed 60-minute block.

- **Data, not code:**
  - `services.partner_slot_policy` (`DURATION` | `FIXED`, CHECK): Laundry, Ironing & Folding and Complete Wardrobe Cleaning are `FIXED`; the other 63 are `DURATION`. Admins can edit it.
  - `bookings.slot_duration_minutes` (0–10080, CHECK) freezes the reserved minutes at creation: `DURATION` → the resolved appointment total; `FIXED` → 0.
- **Existing bookings are not re-slotted:** all 707 have NULL, which the trigger treats as 0 (the legacy window) on every later update. A hash of every active booking's slot ranges was identical before and after the migration.
- **Protected objects:** only the body of `bookings_sync_conflict_slots()` was replaced. The trigger and both GiST EXCLUDE constraints were not dropped, and they remain the authority.
- **Application pre-checks:**
  - they now use the same range rule (`reservedWindow`) against the stored slot columns. Before, the ±30 min checks were looser than the database (31–59 minutes apart passed the app check and were refused only by Postgres);
  - the advisory lock is per provider, because windows with different starts can now overlap.
- **Tests:**
  - `partner-slot-duration.integration.test.ts` (9): window width, hours 2–4 refused, half-open touch after the window, NULL legacy kept, reschedule keeps length, bounds, API path freezes minutes with a typed `PROVIDER_UNAVAILABLE`, FIXED keeps 60 minutes;
  - `scheduling-contract.characterization.test.ts` (10) still pins the legacy NULL behaviour.
- **Proof:** reverting the trigger function to the fixed window fails 4 tests, and restoring passes.
