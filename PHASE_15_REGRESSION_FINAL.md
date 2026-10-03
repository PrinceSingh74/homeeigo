# PHASE 15 — Regression, Final

```
half 1 (68 files) : 1158 pass /  0 fail    (reproduced twice)
half 2 (67 files) :  840 pass /  0 fail
COMBINED          : 1998 pass /  0 fail across 135 files
                    0 Postgres deadlocks (40P01)

Phase-15 suite : 52 pass / 0 fail   (47 + 5 new metric-fabrication guards)
Phase-14 suite : 26 pass / 0 fail
tsc            : 3 errors, all pre-existing, none from this work
```

**Starting point for comparison: 1961 pass / 30 fail / 359 deadlocks.**

---

## A. What the previous report got wrong

The last version of this document classified all 30 failures as `PRE_EXISTING` and attributed them
to deadlock contention, on the evidence that the failure count tracked the deadlock count across
five runs. That reasoning was sound for most of them and **wrong for the ones that mattered**.

Investigating instead of classifying found **four real defects**:

| Was reported as | Actually was |
|---|---|
| "Pass 11 money matrix - contention" | A real money-path defect: **withdrawal completion could never satisfy the wallet check constraint** |
| "Enterprise scalability reschedule - contention" | A real product defect: **back-to-back bookings were impossible** |
| "Chaos & resilience - contention" | The same booking defect, different surface |
| "unnamed x 2" | `mkdirSync` throwing `EEXIST` under Bun on Windows |

Every one of them failed **in isolation, with zero deadlocks**, which is the check that should have
been run the first time. Contention was a real phenomenon and it was also a comfortable label.

---

## B. The four defects

### B1 - Withdrawal completion violated the wallet consistency constraint

`completeProviderPayout` flipped the wallet transaction to `COMPLETED` without refreshing its
closing balance. The row still carried the snapshot written at PROCESSING time, when the amount was
*reserved* rather than deducted - `before = 800, after = 800, amount = 150`.

`wallet_balance_consistency` applies only to COMPLETED rows and requires `after = before - amount`
for a WITHDRAWAL. So the status flip made the row illegal and Postgres rejected it: **the payout
could not complete at all.**

Fixed by reading the provider's **actual** balance either side of the reservation consumption and
recording the measured movement. Deliberately not computed as `before - amount` - a derived figure
satisfies the constraint by construction and would defeat the only thing checking that the ledger
matches the wallet. When no movement is observed the balances are left alone and the discrepancy is
logged rather than papered over.

### B2 - Back-to-back bookings were impossible

`bookings_provider_slot_excl` compared slot ranges as **closed** ranges `'[]'`. Slots are
`[scheduled - 30m, scheduled + 30m]`, so two bookings exactly 60 minutes apart produce
`[16:30, 17:30]` and `[17:30, 18:30]` - which share the single instant 17:30 and therefore
"overlap".

Three other expressions of the same rule disagreed with the constraint:

| Definition | Verdict on a 60-minute gap |
|---|---|
| `booking-validation.service.ts` (+/-30 min window) | **allowed** |
| `scripts/verify-booking-overlaps.ts` (strict `<` both sides) | **allowed** |
| `BOOKING_BUFFER_MINUTES = 30` | 60 min apart is the tightest *legal* pair |
| `bookings_provider_slot_excl` `'[]'` | **rejected** |

The constraint was the outlier. A customer booking one provider at 5pm and 6pm was told *"Provider
is not available at this time. Try 30 minutes earlier or later"* - advice that moves them to a slot
the platform also rejects.

Migration `20260909090000_booking_slot_half_open_ranges` switches both constraints to `'[)'`.
**Applied to `homigo_test` and verified there. Not applied to production** - see section D.

### B3 - `mkdirSync(..., { recursive: true })` throwing EEXIST

Documented as a no-op when the directory exists; under Bun on Windows it throws anyway, failing four
certification suites on an operation already satisfied. Guarded with `existsSync` in all four.

### B4 - Test isolation depended on the working directory

Covered in `PHASE_15_TEST_ISOLATION_INCIDENT.md`. Summarised: running the suite from the repo root
skipped the `bunfig.toml` preload, so `.env.test` never loaded and **the suite connected to the live
`homigo_db`**. A barrier now makes that impossible.

---

## C. Deadlocks: 359 to 0

The advisory-lock fix and its symmetric 6-vs-6 A/B are in `PHASE_15_DEADLOCK_ROOT_CAUSE.md`,
including where my first diagnosis was wrong and how strong the evidence actually is (`p = 0.09` on
the clean set, `p = 0.01` pooled - supported, not proven).

Three consecutive full-half runs produced **zero** deadlocks.

---

## D. What is deliberately not done

| Item | Why |
|---|---|
| Apply `20260909090000` to production | **No authorization.** It rebuilds a GiST index under an ACCESS EXCLUSIVE lock on `bookings`. Deployer's call |
| Remove the 141 fixture bookings written to production | Deleting production rows needs explicit authorization - see the incident report |
| Fix the 3 remaining `tsc` errors | `partner-four-axis.test.ts` asserts that homonym tokens across axes are not comparable. The comparisons are always false **and that is the point**; TypeScript flags exactly what the test exists to state. Not a bug |
| Convert the `-> 0` metric family to null | Consumers already render 0 as an em dash with an explanation. See the sweep report |

---

## E. Cross-phase coverage

| Phase | Representative suites | Result |
|---|---|---|
| 0-4 | booking, payment, ledger, money matrix | **Pass** - including the two money-matrix cases fixed here |
| 5 | AI tools, approval, high-risk governance | **Pass** |
| 6 | workflow engine, notifications, cadence | **Pass** |
| 7-9 | referral, partner performance, executive | **Pass** |
| 10 | support intelligence | **Pass** |
| 11 | knowledge base, RAG, embeddings | **Pass** |
| 12 | ML registry, shadow, demand evaluation | **Pass** |
| 13 | observability, IOC | **Pass** |
| 14 | governance, budget, audit, recovery | **26 / 26** |
| 15 | simulation, drafting, models, chaos, metric guards | **52 / 52** |

**Zero failures across all 135 backend suites.**
