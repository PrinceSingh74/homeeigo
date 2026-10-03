# Phase 06 closure track — commercial extension and work-at-height safety (design, 2026-09-22)

Status: **design only**. Nothing in this document is implemented. Both holds stay open because the dependencies below do not exist yet. Labels were not changed to hide that.

## 1. Existing commercial capability map

Audited in code and schema on 2026-09-22.

| Capability | Where | Supports a customer-approved additional charge? |
|---|---|---|
| Price quote (Phase 05) | `bookingPricingService.quote`, `lib/quote-token.ts` (`signQuote`, `selectionFingerprint`), `lib/pricing-policy.ts` (paise, rounding, `TAX_POLICY`, `PRICING_VERSION`) | **Reusable pieces**: integer paise, central rounding, tax policy, HMAC-signed tokens with expiry and fingerprint. Scoped to the *booking selection* before the booking exists. |
| Booking amount | `bookings.final_amount(_paise)`, `total_amount(_paise)`, `tip_amount(_paise)`, `addons` (JSON snapshot) | No. All fixed at creation. `addons` are catalogue add-ons priced by Phase 05, not post-diagnosis items. |
| Payment | `payments` with **`booking_id UNIQUE`**, `razorpay_order_id UNIQUE`, `idempotency_key UNIQUE`; `payment.service.createOrder` charges `booking.finalAmount` | **No.** One payment row and one gateway order per booking. A second charge cannot be expressed without a new table, or without relaxing a 1:1 invariant that refunds, reconciliation and the ledger depend on. |
| Tips | Wallet-funded via the ledger (402 `TIP_INSUFFICIENT_WALLET`) | No. Customer-initiated, wallet only; not an itemised, quoted, approved charge. |
| Financial adjustment | `financial_adjustments` + `financial_adjustment_approvals` (maker-checker, idempotency key, ADJUSTMENT journal, wallet txn) | **Partially.** It is the right *approval and ledger* pattern (maker ≠ checker, immutable journal, idempotent). But it is admin-initiated, wallet-only, has no customer approval, no booking or item linkage, and no gateway path. |
| Refunds | `refund_requests`, admin partial refunds validated against paid − refunded | Refund side only; keyed to the single booking payment. |
| Approvals elsewhere | `ai_tool_approvals` (AI governance) | Unrelated domain. |
| Diagnosis / inspection | `job_evidence` (stage photos), `booking_chat` | Evidence and conversation only; no structured diagnosis → item. |
| Parts / material price list | — | **Does not exist.** There is no server-side price for any part, gas or paint. |

**Conclusion.** No reusable customer-facing mechanism exists for *inspection → itemised quote → customer approval → payment*. Two dependencies are missing, and code alone cannot supply either of them:

1. **An authoritative amount.** No parts/material price list exists. A partner-typed amount is not server-authoritative (A5/A7). Either the owner supplies a price list, or the owner defines an approval authority for partner-proposed amounts (for example, admin checker above a threshold).
2. **A money path beyond the single booking payment.** `payments.booking_id` is 1:1. An additional charge needs its own ledger-linked record, gateway order and refund semantics. That is Phase 09 scope: it touches payments, refunds, reconciliation and the ledger.

## 2. The generalised primitive (ready to build in Phase 09)

This is one reusable model, not an AC-, plumbing- or painting-specific one.

### Tables (additive migration)

**`booking_additional_quotes`**

| Column | Notes |
|---|---|
| `id`, `booking_id` (FK), `version` (CAS) | |
| `status` | enum, see the state machine below |
| `reason` | partner diagnosis, text |
| `created_by` (partner user) | |
| `reviewed_by` | admin; set when the owner policy requires review |
| `subtotal_paise`, `tax_paise`, `total_paise` | computed by the server only |
| `pricing_version`, `tax_policy_version` | |
| `quote_token_hash`, `expires_at` | |
| `approved_at`, `approved_by` (customer) | |
| `rejected_at`, `rejection_reason` | |
| `payment_id` | FK to the new `additional_payments` |
| `created_at`, `updated_at` | |

CHECKs: `total = subtotal + tax`; paise precision; a status ⇒ timestamp pairing (the same pattern as `booking_completed_requires_timestamp`).

**`booking_additional_quote_items`**

| Column | Notes |
|---|---|
| `id`, `quote_id` (FK) | |
| `requirement_item_code` (FK) | links to the Phase 06 catalogue item, e.g. `ac-refrigerant-gas`, `spare-parts-and-fittings`, `paint-and-primer` |
| `description`, `quantity`, `unit` | |
| `unit_price_paise` | comes **only** from the owner price list (`price_source = PRICE_LIST`) or from an admin-approved partner proposal (`price_source = REVIEWED_PROPOSAL`, `reviewed_by NOT NULL`) |
| `line_total_paise`, `price_source` | |

**`additional_payments`**: gateway order per approved quote, `idempotency_key UNIQUE`, `razorpay_order_id UNIQUE`, and refund linkage. The existing `payments` 1:1 invariant is **not** relaxed.

### State machine (one module, like `lib/booking-state-machine`)

```
DRAFT ──submit──▶ PENDING_REVIEW* ──review──▶ QUOTED ──customer approve──▶ APPROVED ──order──▶ PAYMENT_PENDING ──webhook/verify──▶ PAID
  │                    │                        │ └──customer decline──▶ REJECTED        │                                        │
  └──cancel──▶ CANCELLED ◀──────────────────────┴──expires_at──▶ EXPIRED                 └──gateway fail──▶ APPROVED (retry)       └──refund──▶ REFUNDED
* PENDING_REVIEW only when the owner policy requires review for REVIEWED_PROPOSAL prices
```

- A quote in PAID, REJECTED, EXPIRED or REFUNDED is immutable. A change is a new version (CAS 409 on a stale edit).
- Execution of the extra work is allowed only in PAID, or APPROVED if the owner allows pay-after-work. The partner job brief shows the state.

### Money rules (Phase 05 reuse, no second engine)

- The server computes subtotal, tax and total with `pricing-policy.ts` (`toPaise`, `sumPaise`, `TAX_POLICY`, central rounding).
- The client sends item ids and quantities only; any amount field is stripped (the same Elysia `t.Object` + zod + service triple as booking create).
- An approval carries a signed token (`quote-token.ts` pattern) that binds quote id, version and total paise. The server re-derives and compares (`PRICE_CHANGED` / `QUOTE_EXPIRED` semantics). The gateway order amount equals the stored total.

### Tests the implementation must ship (C1–C10)

| # | Scenario | Expected |
|---|---|---|
| C1 | Altered amount, quantity, tax or total from the client | Ignored or 409 |
| C2 | Quote replay | Refused |
| C3 | Approval replay | Idempotent |
| C4 | Payment replay or webhook duplicate | One charge |
| C5 | Another customer approves | 403/404 |
| C6 | Stale version | 409 |
| C7 | Payment without approval | Refused |
| C8 | Execution without payment | Brief blocks it |
| C9 | Concurrent approval | One wins |
| C10 | Duplicate charge | Unique keys hold |

All go through the existing isolated-copy reintroduction harness.

### Owner decisions that unblock it

| Decision | Options |
|---|---|
| Price authority | (a) price list for parts, gas and paint; (b) partner proposal + admin review above ₹X; (c) partner proposal auto-accepted up to ₹X (not recommended) |
| Pay timing | Before the extra work, or after completion |
| Declined quote | Does the visit still charge the base price? (The base booking is already paid; this is the cancellation/refund policy for the remainder.) |
| Refund policy | For unused approved parts |
| Invoice presentation | One invoice or two |

Once the primitive exists, the four services close by replacing `SEPARATE_QUOTE` copy with a link to the quote flow and moving them from COMMERCIAL_HOLD to READY, after the implementation passes C1–C10 and browser verification.

## 3. Work-at-height safety — audit and future model

### Audit (2026-09-22)

- No work-at-height, scaffolding, harness, rope-access or PPE model exists in the schema or services. The only "PPE" string is a distractor answer in a partner training quiz.
- Provider capability data: `serviceCategories`, `certifications` and `isVerified`. **5** providers carry the `apartments` / facade category; **0** providers hold any certification.
- `catalog_config.providerRequirements` supports `requiredSkills`, `certifications`, `trainingRequired` and `verifiedProfessionalRequired`. None are set for `fasade-cleaning`, and setting them would be inventing a capability standard.
- No site-assessment or inspection-before-booking flow exists. `job_evidence` is post-arrival evidence only.

### What changed in content v2 (safe fallback, not a closure)

Facade customer copy had shown *"We bring: Access equipment, confirmed after assessment · Included in the price"*. That is an equipment and price promise nothing defines, so it was removed:

- Facade equipment is now `NOT_CONFIGURED`, declared with a reason under SAFETY_HOLD.
- The customer is told only: society permission is needed; the professional assesses safe access; unreachable areas are not covered.
- Engine rules added: `UNSUPPORTED_EQUIPMENT_PROMISE`, `METHOD_CLAIM_UNSUPPORTED`, `SAFETY_COPY_MUST_STATE_ASSESSMENT`, `UNCONFIGURED_OUTSIDE_SAFETY_HOLD`.
- Window-cleaning is unchanged: reachable interior glass only, the rest assessed on arrival.

### Future model (to build once the owner defines a method)

| Concept | Where it would live | Populated by |
|---|---|---|
| `SITE_ASSESSMENT_REQUIRED` | service lifecycle flag + assessment booking type (inspect before the work booking) | owner |
| `ACCESS_METHOD` | enum on the service (ground-reach, internal-access, specialist) | owner-defined method |
| `ALLOWED_SCOPE` | per-method scope limits (floors, heights) | owner |
| `PROVIDER_CAPABILITY` | provider capability records with evidence (certificate document, expiry) and admin verification | provider onboarding + admin |
| `EQUIPMENT_REQUIREMENT` | Phase 06 catalogue items with `SPECIALIZED` class | owner |
| `SAFETY_APPROVAL` | admin maker-checker approval of the method per service | owner/admin |
| `EXECUTION_ELIGIBILITY` | matching filter: only providers with verified capability for the method | derived |

fasade-cleaning moves to READY only when these exist with real values.
