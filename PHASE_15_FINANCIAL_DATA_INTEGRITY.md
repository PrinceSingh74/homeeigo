# PHASE 15 - Financial Data Integrity

# STATUS: `RECONCILIATION_REQUIRED`

Measured read-only against `homigo_db`, 2026-09-05. No financial correction policy is decided here -
that is explicitly not an engineering decision.

---

## A. Did value leave the platform?

**No - and this is stated only because it was directly verified.**

```
providers holding fixture-derived earnings : 5
their withdrawals                          : 44
  REQUESTED  43
  APPROVED    1
  COMPLETED   0      <- no payout has completed
```

Every rupee of fixture-derived earning is still inside the platform as an unrealised wallet credit.
Nothing has been paid out to a bank account.

## B. Where the value sits

| Provider | Fixture credit | Wallet balance | Share of wallet |
|---|---|---|---|
| `cmq6ukegr0005tzoczxey43xt` | Rs.400.00 | **Rs.400.00** | **100%** |
| `cmtonp9sn021rtz38kovza7jd` | Rs.506.40 | **Rs.506.40** | **100%** |
| `cmq6b0iue0001tzbo5fnp9t5q` | Rs.2,200.00 | Rs.15,470.40 | 14% |
| `cmq9h687s0005tz8swhtkju1p` | Rs.2,740.00 | Rs.63,052.00 | 4% |
| `cmrfxj1fm02aitz78sm9depfw` | Rs.440.00 | Rs.8,412.00 | 5% |
| **Total** | **Rs.6,286.40** | | |

**Two of these wallets exist only because of test data.** Their entire balance is fixture credit. A
withdrawal request from either would pay out money that was never earned - and the platform has no
way to tell, because the credit is indistinguishable from a real one at the wallet level.

## C. The nearest thing to a live exposure

```
withdrawal cmqjx236v0a4jtzvk2fzdtpdg   Rs.10,008   status APPROVED
  provider cmq9h687s0005tz8swhtkju1p
  wallet Rs.63,052, of which Rs.2,740 is fixture-credited
```

APPROVED is one step from payout. The amount is covered by genuine balance (Rs.10,008 <
Rs.60,312 real), so completing it would not itself pay out fixture money. It is recorded because
approving payouts against balances of unknown provenance is precisely the mechanism by which a
fixture credit eventually becomes a real transfer.

## D. Customer-side movement

```
4 wallet transactions referencing fixture bookings, all COMPLETED
  3 x DEBIT   Rs.550   (customer wallet spend)
  1 x REFUND  Rs.550
  net: Rs.-1,650 debited, Rs.+550 returned
```

Smaller than the provider side, and in the opposite direction: fixture bookings consumed customer
wallet balance rather than creating it.

## E. Independent integrity score

`financialIntegrityService.validate()` against production:

```
score 84

WALLET_LIABILITY_MISMATCH   HIGH   ops Rs.106,998.00    vs ledger Rs.107,998.00     gap Rs.1,000.00
PROVIDER_PAYABLE_MISMATCH   HIGH   ops Rs.121,849.40    vs ledger Rs.120,866.40     gap Rs.983.00
```

**These gaps do not match the fixture totals**, and I have not established that the contamination
caused them. Both could predate it. Asserting a causal link without that evidence would be the kind
of claim this document exists to avoid - but the two anomalies sit in the same balances, so any
reconciliation should re-measure this score before and after.

## F. What is required, and from whom

`RECONCILIATION_REQUIRED` on 14 earnings totalling **Rs.6,286.40**, listed individually with their
booking and provider ids in `PHASE_15_PRODUCTION_DATA_RECONCILIATION.md`.

Removing an earning that has already moved a wallet balance requires one of:

1. a compensating ledger adjustment that reverses the credit, or
2. a determination that the balance was never real and can be reduced directly, or
3. an explicit decision to accept the contamination and leave the balances as they are.

**All three are finance decisions.** Engineering has prepared the identification, the dependency
order, the backup and the verified restore. It should not choose between them.

## G. Pre-conditions before any correction

1. Fresh backup with a **verified restore** - the drill passes today at RTO 25.64 s.
2. Re-run the identification queries; these counts will age.
3. Record `financialIntegrityService.validate()` immediately before the change.
4. Apply the correction in one transaction.
5. Re-run the validator and compare against the recorded score of 84.
6. Confirm the 439 real bookings and their money are untouched.
