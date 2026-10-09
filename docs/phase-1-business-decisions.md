# Phase 1 — Business decisions (closed)

**Status: DECIDED 2026-10-10.** Owner: project owner (HOMEEIGO). This file is the written
finance and product record. It does not add ledger accounts, GSTIN, HSN, or a new tax engine.

Engineering must not reopen D1–D4 as “undecided”. Later GST compliance is a **new phase** after a CA
registers the filing model. Historical journals are not rewritten.

---

## D4 — Supplier of record for the 10% tax line — **DECIDED: option (a)**

**Choice.** The **partner is the supplier of record** for the service. HOMEEIGO is a **facilitator**.
The platform does **not** remit the booking `taxes` line as GST.

**What the product already does (unchanged ledger).**

- Quote and booking: exclusive 10% on the discounted base (`TAX_POLICY`: `tax.v1`, 1000 bps, label
  `Taxes`). `finalAmount = discountedBase + taxes`. Customer checkout uses that label, not GST.
- Ledger: there is no `TAX_PAYABLE` account. Escrow releases the whole `finalAmount` to
  `PROVIDER_PAYABLE` (net) and `PLATFORM_REVENUE` (commission). Source:
  `apps/backend/src/services/earnings.service.ts`.
- Commission basis at launch: **`final_amount`** (code default; `COMMISSION_BASE=pre_tax` remains a
  deploy-time switch, not a schema change). Gross still equals net + commission.
- Customer invoices and partner earning statements disclose they are **not** GST tax invoices.
  Customer mobile trust copy uses “Taxes itemised”, never “GST included”.
- `GET /api/providers/me/tax-summary`: `gstOnCommission` is **0**, `gstRemittedByPlatform` is
  **false**. The previous `commission × 18%` figure was option (c) and is not shown as GST. `estimatedTax`
  / `tdsEstimate` remain an illustrative net × 10% figure and are **not** a withholding.

**Accounting responsibility.**

| Money | Who is responsible |
|---|---|
| Service supply (what the customer booked) | Partner. They invoice / file GST on that supply under their own GSTIN when they are registered. |
| The 10% `taxes` line on the booking | Pass-through to the partner inside `PROVIDER_PAYABLE`. Not HOMEEIGO GST output. |
| Platform commission (`PLATFORM_REVENUE`) | HOMEEIGO income. GST on that fee, if any, is filed by HOMEEIGO’s CA **outside** this ledger. This booking line is not that return. |
| Tips | Unchanged: wallet only, 0% commission, not taxed by this 10% line. |

**What this is not.** It is not a statutory Indian GST invoice. There is no GSTIN, HSN/SAC,
place-of-supply, or CGST/SGST/IGST split in the product. 10% is not a GST slab (5 / 12 / 18 / 28).
Customer documents must not claim they are. Quote copy already uses `Taxes`. Invoices must use the
same label.

**Rejected.**

- **(b) Platform is supplier** — would need `TAX_PAYABLE`, commission on pre-tax, GSTIN on every
  invoice, and a CA. The current ledger would misstate revenue and payable if we claimed (b) without
  that work. Not this phase.
- **(c) GST only on the commission** — also needs a tax-payable path and a CA. Not this phase.

**Cut-over.** Dated this file. Past journals stay as written. Reissue of old invoices is out of
launch.

---

## D1 — Long booking vs partner calendar — **RATIFIED: already in force (option B, FIXED exception)**

Not a new policy. Implemented 2026-09-21.

A new booking reserves `[start − 30 min, start + slot_duration_minutes + 30 min)`.
`slot_duration_minutes` is frozen at create. `partnerSlotPolicy = FIXED` (turnaround SKUs such as
laundry) keeps the legacy 60-minute block. Pre-change rows with NULL duration keep that legacy
block and are not re-slotted.

Sources: `docs/business-decision-scheduling.md`, migration
`20260921180000_duration_aware_partner_slot`, `slotDurationFor` /
`reservedWindow` in `booking-validation.service.ts`,
`partner-slot-duration.integration.test.ts`. The characterization suite still pins NULL-row
legacy behaviour only.

**Launch behaviour.** A four-hour DURATION service blocks the partner for the appointment plus
buffers. A FIXED service does not.

---

## D2 — Admin cancel refund default — **RATIFIED: already in force (option a)**

Not a new policy.

Admin cancel goes through the one cancellation path. The operator may send `customer_policy` or
`full`. If they send nothing, **`customer_policy`** applies (published tiers: >24 h 0% fee, 2–24 h
10%, <2 h 25%, in-progress 50%; professional-initiated cancel is a full refund). Ban-driven cancels
use `customer_policy`.

Source: `POST /api/admin/bookings/:id/cancel` (`refundPolicy` optional, default `customer_policy`).

**Launch behaviour.** Ops-initiated cancel is not automatically a goodwill full refund. Use `full`
when the platform is at fault.

---

## D3 — Unpaid booking expiry — **RATIFIED: already in force (15 minutes)**

Not a new policy. Implemented 2026-09-23.

A **PENDING** booking whose payment has not settled in **15 minutes** expires (`EXPIRED`), actor
`system:payment-expiry`, and the slot is released. Only future appointments. Paid rows are
re-checked under `FOR UPDATE` so a late capture is not expired. ACCEPTED / ASSIGNED / EN_ROUTE /
IN_PROGRESS unpaid work is **not** swept. Past-dated unpaid PENDING is reported, not rewritten. A
payment that lands after expiry follows the existing cancelled-booking refund path.

Source: `booking-payment-expiry.service.ts` (`PAYMENT_PENDING_TTL_MINUTES = 15`),
`phase09-payment-expiry.integration.test.ts`.

**Launch behaviour.** Abandoned checkout does not hold the slot forever.

---

## Launch scope — **APPROVED 2026-10-10**

Ship the Phase 1 successor of **`51f7bed`** (invoice + partner-tax disclosure on this record). Do
not ship a dirty working tree. Do not ship `51f7bed` alone — that SHA still labelled invoices
`GST / Taxes`.

**In first launch**

- Customer book / quote / pay / cancel / refund on the committed customer web.
- Partner duration-aware calendar (D1), 15-minute unpaid expiry (D3), admin refund default (D2).
- City alias coverage, quote analytics rows, same-origin auth, Host-based redirects.
- Bundle-budgeted customer routes as measured on this SHA.
- Local staging image `homigo/backend:6bcf132` for the API; web is this SHA.

**Out of first launch** (explicit non-scope)

- Partner-as-platform GST (D4-b), commission-only GST engine (D4-c), `TAX_PAYABLE`, GSTIN / HSN /
  place-of-supply / CGST-SGST-IGST, reissued historical invoices.
- Unfinished catalog UI (`CategoryAtlas` / `ServiceMenuList` / dirty `ServicesHub`).
- Production cloud (billing, Cloud SQL, Cloud Run) until a named database backup exists.
- Razorpay **live** keys. Test-mode pay + refund is proven on local staging only.
- Float → paise money migration, PITR, mobile device certification.

**Exit.** D4 written above. Accounting responsibility table above. Launch scope this section.
No production deploy is authorised by this file.
