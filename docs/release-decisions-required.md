# Release decisions required (business / finance)

**Status: DECIDED 2026-10-10.** Authoritative record: `docs/phase-1-business-decisions.md`.

The 2026-09-20 text below is the question register. It is not the live status. Engineering must not
re-open these as BLOCKED.

| ID | Decision | Launch behaviour |
|---|---|---|
| D1 | Option B, FIXED exception (in force since 2026-09-21) | Duration-aware partner slot; FIXED SKUs keep 60 min |
| D2 | Option (a) (in force) | Admin cancel default `customer_policy`; `full` is explicit |
| D3 | 15-minute EXPIRED (in force since 2026-09-23) | Unpaid future PENDING released after 15 min |
| D4 | Option (a) | Partner is supplier; HOMEEIGO facilitator; 10% is pass-through, not GST payable |

---

## D1. Does a long booking block its partner for its whole duration?

**Current behaviour.** The partner/customer slot is `[scheduled − 30 min, scheduled + 30 min)` for every
booking, whatever its length (trigger `bookings_sync_conflict_slots`, GiST exclusion
`bookings_provider_slot_excl`, `BOOKING_BUFFER_MINUTES = 30`). The rule is documented in migration
`20260909090000_booking_slot_half_open_ranges` — written before multi-hour Hourly Home Help existed.
`estimatedDuration` (= hours × duration) is stored but no scheduling code reads it. Pinned by
`src/__tests__/scheduling-contract.characterization.test.ts`.

**Consequence.** A 4-hour booking at 10:00 blocks its partner 09:30–10:30 only; the same partner can be
booked at 11:00. UI copy does not claim the partner is reserved for the session (checked).

**Options.** (a) Keep the 60-minute slot and say so in customer/partner copy. (b) Reserve
`[start − 30 min, start + slot_duration_minutes + 30 min)`. (c) (b) only for HOUR-quantity services.

**Chosen.** (b), with FIXED SKUs keeping (a). See `docs/business-decision-scheduling.md` and
`docs/phase-1-business-decisions.md`.

## D2. Default refund when an ADMIN cancels a paid booking

**Current behaviour.** Admin cancellation now goes through the one cancellation path. The admin chooses
per cancellation: `customer_policy` (the published tiers: >24 h 0% fee, 2–24 h 10%, <2 h 25%,
in-progress 50%) or `full`. When the API caller sends nothing, `customer_policy` applies. Before the
remediation an admin cancel refunded nothing at all.

**Consequence.** An ops-initiated cancellation (no partner available, platform error) refunds per the
customer policy unless the admin explicitly picks `full`.

**Options.** (a) Keep per-cancellation choice, default `customer_policy`. (b) Default `full`. (c) Reason
codes that determine the policy (platform-fault → full; customer-requested → policy).

**Chosen.** (a). See `docs/phase-1-business-decisions.md`.

## D3. What happens to bookings that are never paid?

**Current behaviour (as of 2026-09-23).** A PENDING unpaid booking expires after 15 minutes
(`EXPIRED`, actor `system:payment-expiry`). The 2026-09-20 register below described the pre-job
state.

**Options.** (a) Keep indefinitely. (b) Auto-cancel after N minutes unpaid. (c) Auto-cancel only once
the scheduled time has passed.

**Chosen.** (b), N = 15, terminal state `EXPIRED`. See `docs/phase-1-business-decisions.md`.

## D4. Who is the supplier of record for the 10% `taxes` line (GST)?

**Current behaviour.** The customer is charged `finalAmount = discountedBase + round(10%)`. The tax is not
booked to any liability: escrow releases the whole `finalAmount` to PROVIDER_PAYABLE (net) and
PLATFORM_REVENUE (commission). Commission basis is explicit and switchable
(`COMMISSION_BASE=final_amount` default | `pre_tax`), covered by `commission-tax-accounting.test.ts`.

**Consequence.** If the platform must remit GST, the ledger currently misstates both platform revenue
and the partner payable by the tax amount.

**Options.** (a) Partner is supplier; platform is a facilitator — keep, choose the commission basis.
(b) Platform is supplier — add `TAX_PAYABLE`, route the `taxes` line there at payment, commission on
pre-tax. (c) Split model (platform remits tax on its commission only — GST on the fee).

**Chosen.** (a). Commission basis remains `final_amount`. No `TAX_PAYABLE`. Customer invoices are not
GST tax invoices. CA work on HOMEEIGO’s own commission GST is outside this ledger and outside first
launch. See `docs/phase-1-business-decisions.md`.

---

Owner: product + finance. Closed 2026-10-10. Do not implement (b) or (c) in this phase.
