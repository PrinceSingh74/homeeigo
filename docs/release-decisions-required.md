# Release decisions required (business / finance)

Searched before writing (2026-09-20): `docs/**` (incl. `OWNER_DECISIONS_REQUIRED.md`, final-certification,
operations handbook), migrations, finance services, admin settings, catalogue config. None of the four
questions below has an authoritative answer in the repository. Engineering has NOT chosen one; each is
**BLOCKED** until an owner decides. Current behaviour is safe and documented in each entry.

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
`[start − buffer, start + duration + buffer)`. (c) (b) only for HOUR-quantity services.

**Engineering impact of (b)/(c).** One hand-scoped migration changing the trigger to read
`estimated_duration` (+ buffer), the same range in `assertBookingConflictFree` and `detectConflicts`,
availability generation, and the characterization test rewritten as a contract test. The existing
exclusion constraint stays the authority. Estimated 1–2 days incl. tests; historical rows re-derive on
their next UPDATE only.

## D2. Default refund when an ADMIN cancels a paid booking

**Current behaviour.** Admin cancellation now goes through the one cancellation path. The admin chooses
per cancellation: `customer_policy` (the published tiers: >24 h 0% fee, 2–24 h 10%, <2 h 25%,
in-progress 50%) or `full`. When the API caller sends nothing, `customer_policy` applies. Before the
remediation an admin cancel refunded nothing at all.

**Consequence.** An ops-initiated cancellation (no partner available, platform error) refunds per the
customer policy unless the admin explicitly picks `full`.

**Options.** (a) Keep per-cancellation choice, default `customer_policy`. (b) Default `full`. (c) Reason
codes that determine the policy (platform-fault → full; customer-requested → policy).

**Engineering impact.** (a) none. (b) a one-line default change. (c) a reason-code enum on the admin
endpoint + UI select (~0.5 day).

## D3. What happens to bookings that are never paid?

**Current behaviour.** An unpaid PENDING booking stays PENDING indefinitely. It is never offered to a
partner (owner decision #1) and — since 2026-09-19 — never occupies the dispatcher's queue. It does hold
the customer's own ±30-minute slot.

**Consequence.** Abandoned checkouts accumulate; a customer cannot book the same slot again without
cancelling the abandoned one.

**Options.** (a) Keep. (b) Auto-cancel after N minutes unpaid (via the canonical cancel, actor
`system`). (c) Auto-cancel only once the scheduled time has passed.

**Engineering impact.** (b)/(c): a leader-locked maintenance job calling `bookingService.cancel` with a
system actor, `UNPAID_BOOKING_TTL_MINUTES` config, a customer notification template, tests
(~0.5–1 day). A late payment after such a cancel is already refunded automatically.

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

**Engineering impact.** (b)/(c): new ledger account + journal lines at payment and refund, integrity
check extension, reports; historical journals are not rewritten (a dated cut-over). Needs an accountant.

---

Owner: product + finance. Engineering will implement whichever option is chosen in the same session.
