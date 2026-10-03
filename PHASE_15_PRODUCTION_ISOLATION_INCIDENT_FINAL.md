# PHASE 15 — Production Isolation Incident, Final

## STATUS: REQUIRES_AUTHORIZED_CLEANUP

**This report corrects my own earlier one, and the correction is not small.** I previously reported
141 fixture bookings and 60 payments from a single incident. Measuring the whole database instead of
the incident window found **231 fixture bookings spanning three months**, of which mine are 141.

**Measured 2026-09-05, read-only.**

---

## A. The actual scale

```
fixture bookings : 231     (services named 'Adv Service adv-%')
  first          : 2026-06-09
  last           : 2026-09-05
  involving      : 19 customers, 18 providers, 17 services
```

### Two separate contamination eras

| Period | Bookings | Origin |
|---|---|---|
| 2026-06-09 to 2026-07-02 | **90** | **Predates me by three months. Not from my incident** |
| 2026-09-05 | **141** | The working-directory incident documented in `PHASE_15_TEST_ISOLATION_INCIDENT.md` |

The June-July cluster (50 on 2026-06-12 alone) means test data has been reaching this database for
far longer than one bad command, and that the isolation gap I found was being exercised before I
found it.

### Proportion

```
fixture bookings : 231
real bookings    : 439
```

**Fixture data is roughly 34% of every booking in the production database.**

## B. It is not isolated — it reached the money path

The earlier report called the rows additive and isolated. That was true of the bookings and wrong
about what hangs off them.

| Downstream | Count | Value |
|---|---|---|
| payments | 110 | **Rs.58,333** — 96 SUCCESS, 11 INITIATED, 3 REFUNDED |
| earnings | 14 | **Rs.6,286.40**, all `CREDITED` |
| wallet transactions | 4 | |
| activity logs | 28 | |
| notifications | 0 | |
| fixture services still present | 27 | |
| fixture users still present | 1 | |

**14 earnings totalling Rs.6,286.40 are CREDITED**, i.e. posted against provider wallets. The 18
providers touched by fixture bookings hold Rs.87,840.80 in wallet balance between them — not all of
it fixture-derived, which is precisely the difficulty: real and fixture money now sit in the same
balances.

Any production figure aggregating bookings, GMV, payment volume or provider earnings is inflated by
this data.

## C. Related, and probably not coincidental

Production financial integrity currently scores **84**:

```
WALLET_LIABILITY_MISMATCH   ops Rs.106,998    vs ledger Rs.107,998      gap Rs.1,000
PROVIDER_PAYABLE_MISMATCH   ops Rs.121,849.40 vs ledger Rs.120,866.40   gap Rs.983
```

Two HIGH-severity ops-versus-ledger drifts. I have **not** established that the fixture data caused
them — the gaps do not match the fixture totals, and both mismatches could predate the
contamination. Stating a causal link without that evidence would be exactly the kind of claim this
report exists to avoid. It is recorded as a co-located anomaly worth checking during any cleanup.

## D. Why nothing was deleted

Deleting production rows is the class of action the standing instruction forbids without explicit
authorization, and there is **no authorization mechanism in this execution context**. That I created
141 of these rows by mistake does not convert their deletion into an authorized operation — cleaning
up my own mess unasked would repeat the category of error that created it.

## E. Identification and cleanup, ready to run

Fixture rows are precisely identifiable by their service naming:

```sql
-- 1. Inspect first (read-only)
SELECT b.id, s.name, b.status, b.created_at
FROM bookings b JOIN services s ON s.id = b.service_id
WHERE s.name LIKE 'Adv Service adv-%'
ORDER BY b.created_at;

-- 2. The money attached to them
SELECT count(*), sum(p.amount_paid) FROM payments p
WHERE p.booking_id IN (SELECT b.id FROM bookings b JOIN services s ON s.id=b.service_id
                       WHERE s.name LIKE 'Adv Service adv-%');
```

A cleanup must remove, in dependency order and inside one transaction, after a **verified restore**
of a fresh backup:

```
wallet transactions -> earnings -> payments -> activity logs -> bookings
                    -> fixture services -> fixture providers -> fixture users
```

**The 14 CREDITED earnings are the hard part.** Removing an earning that has already moved a
provider's wallet balance requires either a compensating adjustment or accepting that the wallet
balance was never real. That is a financial decision, not an engineering one, and it needs whoever
owns the ledger to make it.

## F. Recommended sequence, when authorized

1. Fresh backup, restore verified.
2. Re-run the identification queries — the counts in this report will have aged.
3. Decide the treatment of the 14 CREDITED earnings and the wallet balances they moved.
4. Delete in dependency order, in one transaction.
5. Re-run `financialIntegrityService.validate()` and compare against the pre-cleanup score of 84.
6. Confirm the 439 real bookings are untouched.

## G. Recurrence

The specific mechanism is closed: `prisma-base.ts` now refuses to construct a client against a
non-test database whenever `NODE_ENV=test`, regardless of working directory or preload. Verified in
both directions — the repo-root invocation that caused this now fails immediately.

That barrier would have prevented the June-July cluster too, had it existed then.
