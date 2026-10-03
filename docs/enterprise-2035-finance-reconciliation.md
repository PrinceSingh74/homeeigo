# HOMEEIGO — Finance Reconciliation

**Status: P1 DEFECT FOUND AND FIXED · ₹32 RESIDUAL DRIFT OPEN (root-caused, not plugged)**

Supersedes audit finding **DB-6**, which was **wrong in both its amount and its central claim**.

---

## 1. Correcting the audit

The Master Audit reported:

> *"24 users where `users.wallet_balance ≠ Σ wallet_transactions`, total drift **₹52,939**… there is **no automated invariant** asserting this equality, which is why it went unnoticed."* — P1 DB-6

Three things were wrong.

| Audit claim | Reality | Why the audit was wrong |
|---|---|---|
| ₹52,939 across 24 users | **₹32 in aggregate** | The audit summed the **float** column and counted **all** transactions, including 11 `EXPIRED` and 2 `PENDING` that correctly never moved a balance |
| `wallet_transactions` is the authoritative record | **It is not.** Wallet balance is backed by the **ledger** | Adjustments, H-Coin redemptions and refunds move `CUSTOMER_WALLET` without creating a `wallet_transactions` row |
| "No invariant guards this" | **An invariant exists and has been FAILING** | `financial-integrity.service.ts:263` checks `WALLET_LIABILITY_MISMATCH` with a ₹1 tolerance |

The invariant was firing the whole time. From `financial_integrity_runs`, most recent:

```json
{"issues":[{"category":"WALLET_LIABILITY_MISMATCH","severity":"HIGH",
            "details":"Ops wallet ₹107523 vs ledger CUSTOMER_WALLET ₹107491"}],
 "checkedAt":"2026-09-20T22:52:01.614Z"}
```

The 11 users holding exactly ₹5,000 with zero transactions are **seeded balances backed by `ADJUSTMENT` journal entries** — booked in the ledger, correct double-entry, simply not represented in `wallet_transactions`.

---

## 2. The real defect: plug entries against a non-invariant

Investigating the ₹32 surfaced something considerably more serious.

### FIN-1 (P1, DATA) — the reconciler forced a commingled account to match gift cards

`ledger-reconciliation.service.ts` compares each liability account to an operational quantity and, when they differ, **posts an `ADJUSTMENT` journal entry to make them agree**. `PLATFORM_ESCROW` was in the `ADJUSTABLE` set.

But `PLATFORM_ESCROW` is **commingled**. Its real composition on 2026-09-21:

| Journal type | Entries | Net |
|---|---|---|
| `BOOKING_PAYMENT` | 279 | +₹159,381 |
| `PROVIDER_EARNING` | 250 | −₹141,275 |
| `WALLET_DEBIT` | 7 | +₹5,275 |
| `GIFT_CARD` | 10 | +₹3,800 |
| `REFUND` | 1 | −₹550 |
| **`ADJUSTMENT` (plugs)** | **56** | **−₹17,245** |

`buildReport()` compared the whole account against **active gift-card balance alone** (₹1,800). The resulting "delta" was almost entirely unreleased booking escrow behaving exactly as designed — and the service closed it by writing an adjusting entry.

**Damage:** real escrow of **₹26,631** now reads **₹9,386**. The plug never converged, because every new booking payment re-opens the gap it was trying to close. Any financial report using escrow has been wrong for as long as this ran.

### FIN-2 (P2, DATA) — agreement elsewhere is substantially manufactured

The same mechanism has been at work on the accounts that *do* have valid invariants. Across the ledger there are **117 adjusting entries**:

| Account | Plug entries | Moved | Reads without plugs |
|---|---|---|---|
| `PLATFORM_ESCROW` | 56 | −₹17,245 | ₹26,631 |
| `CUSTOMER_WALLET` | 35 | +₹56,945 | ₹50,546 |
| `PROVIDER_PAYABLE` | 19 | +₹10,294.60 | ₹119,382 |
| `HCOIN_LIABILITY` | 7 | −₹50 | ₹430 |

`PROVIDER_PAYABLE` reconciles to **₹0.00 exactly** — but only because ₹10,294.60 of plugs put it there.

For `CUSTOMER_WALLET` and `PROVIDER_PAYABLE` the comparison *is* a real invariant, so an adjusting entry is a legitimate accounting action. The problem is that it is taken **automatically, with no diagnosis and no stated reason**, so each root cause survives to produce the next mismatch. `scripts/reconcile-ledger.ts` is documented as the remedy — *"Run ledger backfill + liability reconciliation (fixes WALLET_LIABILITY_MISMATCH)"* — which is how a detector and its silencer ended up shipped as a pair.

---

## 3. What was changed

### `src/services/ledger-reconciliation.service.ts`

1. **`PLATFORM_ESCROW` removed from `ADJUSTABLE`.** The set is now exactly the three accounts with a one-to-one operational counterpart:
   ```
   CUSTOMER_WALLET  == SUM(users.wallet_balance)
   PROVIDER_PAYABLE == SUM(providers.wallet_balance)
   HCOIN_LIABILITY  == floor(outstanding_coins * COIN_TO_RUPEE)
   ```
2. **Gift Card Escrow row marked informational** (`"Gift Card Escrow (info)"`), matching the existing convention for Pending Cashback, with an in-code explanation of why the comparison is not an invariant.
3. **`maxDelta` now computed only over `ADJUSTABLE` accounts.** Without this, excluding escrow from adjustment would have pinned `ledger_reconciliation_max_delta` at ₹7,586 — permanently above the CRITICAL threshold. Trading a silent plug for an alert that always fires would not have been an improvement.

**No data was modified.** The 117 historical adjusting entries are left in place; reversing them is an accounting decision (§6).

### `scripts/diagnose-wallet-liability.ts` — new, read-only

The platform had a detector and a silencer but nothing that answered *why*. This script attributes a delta instead of closing it:

- per-account operational vs ledger, each labelled **invariant-backed** or **informational**, with its basis stated;
- full ledger composition by journal type, with plug entries marked `PLUG` and what the account would read without them;
- customer-wallet transactions with no linked journal, and ledger movements with no transaction row;
- exits non-zero on drift, and explicitly warns against running `reconcile:ledger` to clear it.

It writes nothing — no adjustment, no backfill, no balance update.

> **A units bug in this script was caught and fixed during development.** The first version summed `hcoin_wallets.balance` and reported a ₹3,670 H-Coin drift. That column is denominated in **coins**, and `COIN_TO_RUPEE = 0.1`, so 4,050 coins is ₹405. The script now imports `COIN_TO_RUPEE` and derives outstanding from `hcoin_transactions` — the identical definition `hcoin.service.adminAnalytics()` uses, rather than a second one. With the correct units, **H-Coin reconciles exactly (₹380 = ₹380).**

### `src/__tests__/ledger-reconciliation-scope.test.ts` — new

Four structural assertions pinning the fix. Database-free, so they cannot skip silently.

**The test was verified to fail when the defect is reintroduced** — `PLATFORM_ESCROW` was temporarily added back to `ADJUSTABLE`, the suite reported `2 pass / 2 fail`, and the source was restored. A check that cannot fail is not a check.

---

## 4. Current state

```
[DRIFT] Customer Wallet    operational ₹107,523.00   ledger ₹107,491.00   delta ₹-32.00
[ok   ] Provider Payable   operational ₹129,676.60   ledger ₹129,676.60   delta  ₹0.00
[ok   ] H-Coin Liability   operational     ₹380.00   ledger     ₹380.00   delta  ₹0.00
[info ] Platform Escrow    operational   ₹1,800.00   ledger   ₹9,386.00   delta ₹7,586.00  (commingled — not an invariant)
```

**Exactly one invariant-backed account drifts, by ₹32.**

### The ₹32 — FULLY ATTRIBUTED (2026-09-21, second pass)

The residual is now explained to the rupee. It is **not one error**. It is the near-cancellation of
two independent ones, which is why it looked small and why closing it would have been the worst
possible response.

| Component | Amount | Cause |
|---|---|---|
| Orphan `wallet_topup` journal `JE-00001323` | **+₹1,000** | Credits CUSTOMER_WALLET for a top-up whose `wallet_transaction` does not exist in any status |
| H-Coin redemptions journaled twice (×4) | **+₹552** | ₹176 + ₹67 + ₹141 + ₹168 — each carries BOTH `hcoin_redeemed:` and `wallet_topup:` |
| Earliest H-Coin journal, no transaction | **+₹10** | 2026-06-08 |
| Booking tip debit, no transaction | **−₹200** | `booking_tip:` debits the wallet in the ledger only |
| **Journals exceed transactions** | **+₹1,362** | |
| Reconciliation plugs under-representing seeded balances | **−₹1,394** | 35 plug entries |
| **NET** | **−₹32** | matches the measured delta exactly |

**Posting a ₹32 adjustment would have concealed ₹2,756 of gross error.**

#### How the attribution was derived

The ops side reconstructs exactly, which localised the fault to the ledger:

```
A: seed balances (users with transactions)       ₹  6,050
B: balances (users with no transactions)         ₹ 52,289
C: net completed user transactions               ₹ 49,184
A+B+C                                            ₹107,523
actual SUM(users.wallet_balance_paise)           ₹107,523   <- exact
```

And **zero** users show an out-of-band balance change: for every user with transactions, the last
transaction's `wallet_balance_after_paise` equals the current balance. The operational record is
internally perfect.

Comparing journal types against transaction types then isolated the variance: `WALLET_DEBIT` and
`REFUND` match to the rupee; the difference is entirely in top-ups, H-Coin and the tip.

#### The ₹1,000 orphan

`JE-00001323`, 2026-09-05 17:27:46 — `DR BANK_SETTLEMENT / CR CUSTOMER_WALLET ₹1,000`, referencing
`wallet_transaction cmtonomi90032tz38resaiv5l`, which **does not exist in any status**.

The live top-up path is correct: `wallet.service.ts:366` calls `recordWalletTopUpInTransaction(tx, ...)`
**inside** `prisma.$transaction`, so journal and transaction commit atomically. The row was therefore
deleted afterwards. That day's transaction numbers run `WXN-20260905-00001..00003` with no gap —
consistent with the deleted row having been `00004`, the last number issued that day, which is exactly
the case a gap check cannot see. A mass-delete incident on this database is on record for 2026-09-16.

#### The ₹552 double-credit

A redemption moves an existing liability; no money arrives from a bank. A second
`recordWalletTopUpInTransaction` credited CUSTOMER_WALLET again **and debited BANK_SETTLEMENT as
though it had**.

The code is already fixed, and the fix is visible in the data: the redemption on **2026-09-19 carries
only** the `hcoin_redeemed:` journal, while the four before **2026-09-15 carry both**.

**Each journal balances on its own.** No per-journal debit-equals-credit check could ever have seen
this — only comparing the account against the wallet it represents.

#### What was NOT done

The ₹32 was **not plugged**, and the four duplicate journals and one orphan were **not reversed**.
Reversing a journal against a closed period is an accounting decision (§6).

## 5. Findings

| ID | Sev | Class | Finding | Status |
|---|---|---|---|---|
| FIN-1 | **P1** | DATA | Reconciler posted 56 plugs (−₹17,245) forcing commingled `PLATFORM_ESCROW` to match gift-card balance | **FIXED** |
| FIN-2 | P2 | DATA | 117 adjusting entries across 4 accounts; agreement is substantially manufactured | **Mitigated** — plugging narrowed to invariant-backed accounts; diagnosis tool added; historical entries left for an accounting decision |
| FIN-3 | P2 | DATA | ₹32 customer-wallet drift, post-2026-09-06 | **OPEN — root-caused to an event class, not to an event** |
| DB-6 | — | — | Audit's ₹52,939 / 24-user drift claim | **WITHDRAWN — measurement error** |

---

## 6. Open items requiring a decision (not taken here)

1. **The 56 escrow plugs (−₹17,245).** Reversing them would restore escrow to ₹26,631. That is a correcting journal entry against historical periods and needs finance sign-off, not a script.
2. **The ₹32.** Either find the event, or post a documented adjusting entry with a stated reason. Not an automated action.
3. **Segregate gift-card float** into its own ledger account so the escrow comparison becomes a real invariant. Schema + chart-of-accounts change; the informational row is the correct interim state.
4. **`scripts/reconcile-ledger.ts` should require an explicit reason.** It currently posts adjustments with no human input. Suggested: require `--reason "<text>"` and record it on the journal.

## 7. Regression protection added

| Control | Status |
|---|---|
| `ledger-reconciliation-scope.test.ts` (4 assertions) | ✅ added, **proven to fail on reintroduction** |
| `scripts/diagnose-wallet-liability.ts` | ✅ added, read-only, non-zero exit on drift |
| `WALLET_LIABILITY_MISMATCH` in `financial-integrity.service` | ✅ already existed and was already firing correctly |
| Run diagnosis before any `reconcile:ledger` | ⬜ **process change — recommended, not enforceable in code** |
