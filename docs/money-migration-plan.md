# Money representation migration plan (Float → exact minor units)

Status: **analysis PASS, execution BLOCKED** (no production database, no approved window, no
production backup infrastructure). Nothing in this plan has been executed against any live data.

Supersedes `docs/money-representation-migration-plan.md`, which covered only the 13 core models.

---

## 1. Inventory — every money-shaped field

Generated from `prisma/schema.prisma` (107 fields matched the money vocabulary):

| | count |
|---|---|
| Float | 92 |
| Int (already minor units or counts) | 15 |
| **has a `…Paise` BigInt twin** | **36** |
| no twin | 71 |

**The 36 twinned fields** live in the 13 models that carry the ledger money path: `User`,
`Provider`, `Booking`, `Payment`, `WalletTransaction`, `Earning`, `Withdrawal`, `WalletTransfer`,
`MembershipCashback`, `Chargeback`, `LedgerEntry`, `RefundRequest`, `FinancialAdjustment`. Since
migration `20260609280000_money_paise_full_dual_write`, a BEFORE INSERT/UPDATE trigger keeps each
twin at `ROUND(float * 100)`.

**The 71 untwinned fields split into two groups:**

*A. Not rupee amounts* (no migration needed; they are ratios, scores or foreign currency):
`commissionRate`, `cashbackPct`, `discountPct`, `surgeMultiplier` (×2), `totalScore`,
`totalDistance`, `AiGatewayUsage.totalCostUsd`, `AiGatewayCost.totalCostUsd`.

*B. Rupee amounts with no twin* — the real remaining surface (≈60 fields):
- catalogue: `Service.basePrice / minPrice / maxPrice`
- partner aggregates: `Provider.thisWeekEarnings / thisMonthEarnings`
- `Rating.tipAmount`, `MembershipBenefitUsage.amount`, `PartnerReferralReward.amount`,
  `ProviderWalletReservation.amount`, `PartnerIncentiveRule.bonusAmount`,
  `PartnerIncentivePayout.amount`
- promotions: `Campaign.*`, `CouponUsage.*`, `MembershipCoupon*.*`, `CouponRule.minOrderAmount`
- settlement/reporting: `SettlementBatch.*`, `PaymentSettlement.settledAmount`,
  `SettlementLineItem.*`, `PayoutBatch*.*`, `ReconciliationIssue.*`, `SettlementDiscrepancy.*`,
  `GatewayReconciliationIssue.*`, `LedgerBalanceSnapshot.balance`, `FinanceLiabilitySnapshot.*`,
  `MarketingAttributionTouch.revenue`, `AcquisitionSpend.amount`

## 2. Usage tracing
- **payment / refund / wallet / commission / earning / withdrawal / ledger** — all inside the twinned
  set. The application writes the Float and the trigger derives the twin; `LEDGER_UNBALANCED` and
  `wallet_balance_consistency` compare Floats with a 0.005 tolerance.
- **tax** — `booking-pricing.service.ts` computes `Math.round(discountedBase * TAX_RATE)`; stored on
  the twinned `Booking`. (The rate itself is business decision **D4**.)
- **reports / exports / invoices** — read Floats (`invoice.service.ts`, finance reports), so they
  must switch to the compat layer before the Floats are dropped.
- **webhooks** — Razorpay is already integer paise on the wire; the conversion happens at the edge.
- **group B fields** feed pricing inputs, promotions and reporting snapshots rather than the ledger.

## 3. Precision evidence (read-only, 2026-09-20)
| Scope | values checked | sub-paise values | twin mismatches |
|---|---|---|---|
| 13 core columns, `homigo_test` | 50,912 | **0** | **0** |
| 13 core columns, `homigo_db` | 8,652 | **0** | **0** |
| 28 untwinned rupee columns, `homigo_db` | 3,675 | **0** | n/a |

Journals balance exactly on both databases (`homigo_test` 5,106 journals; `homigo_db` 971,
₹7,09,341.10 debit = credit; 0 duplicate idempotency keys).

**Conclusion:** no stored value has ever needed finer precision than a paisa, so the migration is a
representation change, not a data repair. The live risk is future Float arithmetic in a path that
skips `round2` — bounded today only because the triggers cannot store a sub-paise error.

*(Two columns, `membership_benefit_usages.amount` and `acquisition_spends.amount`, do not exist on
dev and were skipped; they are covered by the same procedure when present.)*

## 4. Target representation
**Integer minor units (paise) as `BigInt`**, matching the existing twins and the gateway wire format.
Rejected: `Decimal` — it would mean a second representation alongside 36 existing BigInt twins, and
JS `Decimal` handling still needs a wrapper type. Ratios and percentages stay Float; USD AI costs are
out of scope.

## 5. Procedure (per table group, smallest blast radius first)
1. **Compat layer.** `lib/money.ts`: paise in/out, rupees only at the API edge. New code uses it.
2. **Add twins to group B** in one hand-scoped migration per group, with the same dual-write trigger.
3. **Shadow comparison** (see §7) in CI and in the hourly integrity job. Run for one full
   reconciliation cycle; any mismatch stops the migration.
4. **Flip the trigger direction** per table group: when only paise is written, derive the Float
   (`float = paise / 100.0`); when both are written, `RAISE` on disagreement. Readers keep working.
5. **Move writers to paise** in money-path order: ledger → wallet → payments → refunds → earnings →
   settlement/reports. Each step is covered by money-matrix, split-refund, wallet-funded-refund and
   release-concurrency suites.
6. **Move readers** (reports, exports, invoices) to the compat layer.
7. **Drop the Float columns in a separate release**, only after one clean reconciliation cycle.

## 6. Rollback
- Steps 1–3 are additive: rollback = stop using the new path.
- Step 4 is the only irreversible-looking step and is not: keep the reverse trigger as a prepared
  migration, so flipping back is one `migrate deploy`. Floats are never dropped in the same release,
  so every rollback target still holds the data.
- Step 7 is guarded by the backup + restore rehearsal (Phase 23) and is not reversible without it.

## 7. Verification queries (run before, during and after each step)
```sql
-- (a) no sub-paise value anywhere in a column
SELECT count(*) FROM <table> WHERE abs(<col>::numeric * 100 - round(<col>::numeric * 100)) > 1e-7;
-- (b) twin agrees with the Float
SELECT count(*) FROM <table> WHERE <col>_paise <> round(<col>::numeric * 100);
-- (c) every journal balances
SELECT journal_id FROM ledger_entries GROUP BY journal_id HAVING sum(debit) <> sum(credit);
-- (d) wallet balance equals its ledger
--     (the existing wallet_balance_consistency constraint, asserted in the integrity job)
```

## 8. Why execution is BLOCKED
1. There is **no deployed production database** (see memory `production-runtime-and-contamination`).
2. No verified production backup or restore rehearsal exists (Phase 11/23 — local rehearsal only).
3. No maintenance window, and finance sign-off on the before/after reconciliation is required.

**Owner:** platform engineering + finance. Do not begin step 4 on any live data until 1–3 are true.
