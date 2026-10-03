# Business decisions required before release — BLOCKED ON OWNER

Status: **BLOCKED — OWNER DECISION.** No policy has been chosen silently. Each item states what the
code does today, so a decision to "keep current behaviour" is also a valid, explicit answer.

Repository search performed (2026-09-20): `docs/`, ADRs, operations handbooks, the pricing, tax,
cancellation and booking services. The **customer** cancellation tiers are defined and published
(`cancellation-policy.service.ts`, `GET /api/bookings/cancellation-policy`): free outside 2 hours,
25% fee inside 2 hours, 50% once in progress, full refund when the professional cancels. Nothing
authoritative exists for the four questions below.

---

## D1 — What does a four-hour booking reserve on a partner's calendar?

- **QUESTION:** should a booking's duration determine how much partner time it blocks?
- **CURRENT BEHAVIOR:** every booking occupies a fixed 60-minute slot (start −30 min to +30 min)
  regardless of its `estimatedDuration`. A 4-hour job blocks one hour, so the partner can be
  double-booked into hours 2–4. Pinned by `scheduling-contract.characterization.test.ts` (8 cases).
- **BUSINESS IMPACT:** partners are over-booked on long jobs and arrive late to the next customer;
  the alternative reduces sellable slots per partner per day.
- **TECHNICAL IMPACT:** the slot window is computed by a DB trigger and enforced by the
  `bookings_provider_slot_excl` exclusion constraint. Changing it means a hand-scoped migration to
  recompute `provider_slot_start/end` from duration, a backfill decision for existing rows, and
  re-baselining the characterization test. Capacity/matching read the same columns.
- **OPTIONS:**
  1. Keep the fixed 60-minute contract (document it as intentional; long jobs need manual care).
  2. Slot = actual duration (± travel buffer) — correct calendars, fewer slots.
  3. Duration-aware tiers (e.g. ≤60 min → 1 slot, else ceil(duration/60) slots).
- **DEPENDENCIES:** capacity engine, partner calendar UI, existing future bookings (backfill).
- **EXACT OWNER DECISION REQUIRED:** choose 1, 2 or 3; if 2 or 3, state the travel buffer and whether
  existing future bookings are re-slotted.

## D2 — What refund does an ADMIN cancellation issue by default?

- **QUESTION:** when support cancels on a customer's behalf, which policy applies?
- **CURRENT BEHAVIOR:** `processAdminRefund` / the admin cancel path take an explicit
  `refundPolicy`; there is no defined default, so the outcome depends on what the operator picks.
  The published customer tiers (25% / 50% fees) are the only written rule and they describe
  *customer-initiated* cancellations.
- **BUSINESS IMPACT:** identical situations can be refunded differently by different operators;
  disputes and an inconsistent audit trail follow.
- **TECHNICAL IMPACT:** small — a default in the admin cancel path plus an override reason. The
  concurrency and refund tests already cover both outcomes.
- **OPTIONS:**
  1. Always full refund (support cancels = platform's fault).
  2. Apply the customer tier that the timing implies.
  3. Operator must choose per case, with a mandatory reason (make the absence of a default explicit).
- **DEPENDENCIES:** finance reconciliation, support SOP, refund reporting.
- **EXACT OWNER DECISION REQUIRED:** name the default and who may override it.

## D3 — When does an unpaid booking expire?

- **QUESTION:** how long may a PENDING, unpaid booking hold a slot?
- **CURRENT BEHAVIOR:** **no expiry exists.** No scheduled job cancels unpaid bookings; a PENDING
  booking holds its slot indefinitely (dispatch already ignores unpaid bookings, so it does not reach
  partners, but the slot is occupied and the customer sees an open booking).
- **BUSINESS IMPACT:** abandoned checkouts silently consume capacity; customers see stale bookings.
- **TECHNICAL IMPACT:** a new scheduled job plus a terminal state (EXPIRED vs CANCELLED_BY_USER),
  notification copy, and a rule for a payment that lands after expiry (the "cancelled booking never
  resurrects on payment" path already exists and would apply).
- **OPTIONS:**
  1. No expiry (today).
  2. Expire after N minutes without payment (typical: 15–30).
  3. Expire only when the slot is within X hours of starting.
- **DEPENDENCIES:** payment webhook race handling, notifications, partner capacity.
- **EXACT OWNER DECISION REQUIRED:** the timeout value (or "no expiry"), and whether an expired
  booking is CANCELLED or a new EXPIRED state.

## D4 — Who is the supplier of record for GST, and at what rate?

- **QUESTION:** is HOMEEIGO the supplier, or is each partner the supplier with HOMEEIGO as an
  intermediary — and what tax rate applies to which component?
- **CURRENT BEHAVIOR:** a single flat 10% is applied to the discounted base
  (`booking-pricing.service.ts`: `TAX_RATE = 0.1`) and rendered as "GST / Taxes" on the invoice
  (`invoice.service.ts`). There is no GSTIN, HSN/SAC code, place-of-supply or CGST/SGST/IGST split,
  and no tax-payable account in the ledger.
- **BUSINESS IMPACT:** invoices are not compliant Indian tax invoices; the platform cannot file
  correctly, and partner commission tax treatment is undefined. 10% matches no standard Indian GST
  slab (5% / 12% / 18% / 28%).
- **TECHNICAL IMPACT:** largest of the four. Needs: supplier model, GSTIN storage and validation,
  per-service HSN/SAC, place-of-supply logic, CGST/SGST/IGST split, a tax-payable ledger account,
  invoice template changes, and a decision on historical invoices.
- **OPTIONS:**
  1. HOMEEIGO is the supplier: platform GSTIN on every invoice, correct slab per service category.
  2. Partner is the supplier: platform invoices commission only; partner invoices the customer.
  3. Marketplace/TCS model with the platform collecting tax at source.
- **DEPENDENCIES:** finance/CA advice, legal entity registration, partner onboarding (GSTIN
  collection), invoice templates, ledger chart of accounts, historical invoice policy.
- **EXACT OWNER DECISION REQUIRED:** the supplier model, the rate per service category, and whether
  past invoices are reissued.

---

**Owner:** product + finance (D4 additionally needs a CA). **Engineering status:** current behaviour
is characterized by tests so any chosen option starts from a known baseline. None of these is
marked PASS, and none will be decided by engineering.
