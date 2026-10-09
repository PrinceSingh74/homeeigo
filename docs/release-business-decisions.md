# Business decisions required before release — DECIDED

Status: **DECIDED 2026-10-10.** Authoritative record: `docs/phase-1-business-decisions.md`.

The 2026-09-20 question list is preserved below. It is not the live status. Mapping to that list:

| ID | Chosen |
|---|---|
| D1 | Duration-aware slot (option 2 / B), FIXED SKUs keep 60 min. Already in code 2026-09-21. |
| D2 | Default `customer_policy` (option 2 on this page; option (a) on `release-decisions-required.md`). |
| D3 | Expire unpaid PENDING after 15 minutes as `EXPIRED`. Already in code 2026-09-23. |
| D4 | Partner is the supplier (option 2 on this page; option (a) on `release-decisions-required.md`). HOMEEIGO is facilitator. 10% is a pass-through line, not a GST slab. No GSTIN / TAX_PAYABLE this launch. |

---

## D1 — What does a four-hour booking reserve on a partner's calendar?

- **QUESTION:** should a booking's duration determine how much partner time it blocks?
- **CURRENT BEHAVIOR (2026-09-20):** every booking occupies a fixed 60-minute slot (start −30 min to +30 min)
  regardless of its `estimatedDuration`. A 4-hour job blocks one hour, so the partner can be
  double-booked into hours 2–4. Pinned by `scheduling-contract.characterization.test.ts` (8 cases).
- **IN FORCE (2026-09-21):** `[start − 30, start + slot_duration_minutes + 30)`; FIXED keeps 60 min.
- **OPTIONS:**
  1. Keep the fixed 60-minute contract (document it as intentional; long jobs need manual care).
  2. Slot = actual duration (± travel buffer) — correct calendars, fewer slots.
  3. Duration-aware tiers (e.g. ≤60 min → 1 slot, else ceil(duration/60) slots).
- **CHOSEN:** 2, with FIXED exception as 1. `docs/business-decision-scheduling.md`.

## D2 — What refund does an ADMIN cancellation issue by default?

- **QUESTION:** when support cancels on a customer's behalf, which policy applies?
- **CURRENT BEHAVIOR:** `processAdminRefund` / the admin cancel path take an explicit
  `refundPolicy`; omitted → `customer_policy`.
- **OPTIONS:**
  1. Always full refund (support cancels = platform's fault).
  2. Apply the customer tier that the timing implies.
  3. Operator must choose per case, with a mandatory reason (make the absence of a default explicit).
- **CHOSEN:** 2 as default; operator may send `full`. `docs/phase-1-business-decisions.md`.

## D3 — When does an unpaid booking expire?

- **QUESTION:** how long may a PENDING, unpaid booking hold a slot?
- **CURRENT BEHAVIOR (2026-09-20):** no expiry existed.
- **IN FORCE (2026-09-23):** 15 minutes → `EXPIRED`.
- **OPTIONS:**
  1. No expiry (today).
  2. Expire after N minutes without payment (typical: 15–30).
  3. Expire only when the slot is within X hours of starting.
- **CHOSEN:** 2, N = 15, new `EXPIRED` state. `docs/phase-1-business-decisions.md`.

## D4 — Who is the supplier of record for GST, and at what rate?

- **QUESTION:** is HOMEEIGO the supplier, or is each partner the supplier with HOMEEIGO as an
  intermediary — and what tax rate applies to which component?
- **CURRENT BEHAVIOR:** exclusive 10% on the discounted base (`TAX_POLICY`). Invoice line is
  `Taxes` (aligned 2026-10-10). No GSTIN, HSN/SAC, place-of-supply or CGST/SGST/IGST split, and no
  tax-payable account in the ledger.
- **BUSINESS IMPACT:** invoices are **not** Indian GST tax invoices. That is accepted for first
  launch. 10% is not a GST slab.
- **OPTIONS:**
  1. HOMEEIGO is the supplier: platform GSTIN on every invoice, correct slab per service category.
  2. Partner is the supplier: platform invoices commission only; partner invoices the customer.
  3. Marketplace/TCS model with the platform collecting tax at source.
- **CHOSEN:** 2 for the service supply. HOMEEIGO still issues a customer receipt for the amount
  paid; it is not a GST tax invoice. Commission stays on `final_amount`. HOMEEIGO GST on its
  commission, if any, is filed by a CA outside this ledger. Options 1 and 3 are a later phase.

---

**Owner:** product + finance. Closed 2026-10-10 without implementing TAX_PAYABLE.
