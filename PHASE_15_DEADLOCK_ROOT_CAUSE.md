# PHASE 15 — Deadlock Root Cause

§15 required treating the 359 deadlocks as a real engineering problem rather than dismissing them as
pre-existing. This is that investigation, including the part where **my first root-cause diagnosis
was wrong** and the A/B test proved it.

---

## A. The reproduction

A minimal probe: N customers race for the **same provider at the same slot**, which is exactly what
`release-blocker-elimination` does.

```
raw-SQL probe, 60 concurrent
  succeeded  : 1
  DEADLOCKS  : 10
```

Postgres named the cycle, with `log_lock_waits = on` and `deadlock_timeout = 500ms`:

```
ERROR: deadlock detected
DETAIL: Process 41170 waits for ShareLock on transaction 5923498; blocked by process 41171.
        Process 41171 waits for ShareLock on transaction 5923496; blocked by process 41170.
        Process 41170:  INSERT INTO bookings ...
        Process 41171:  INSERT INTO bookings ...
```

**Both victims are INSERTs, each waiting on the other's transaction** — the speculative-insert
pattern: concurrent inserters of the same unique key register an index entry, then wait on the other
transaction to resolve. When those transactions already hold row locks from an earlier `FOR UPDATE`
scan, two of them can each hold what the other needs.

## B. The invariant is enforced three times

| Mechanism | Covers | Atomic? |
|---|---|---|
| `SELECT … FOR UPDATE` range scan in `assertBookingConflictFree` | provider slot **± buffer window** | No |
| `bookings_provider_scheduled_active_key` (partial unique) | exact `(provider_id, scheduled_date)` | Yes |
| `bookings_provider_slot_excl` (GiST exclusion) | provider slot **range** | Yes |

Neither index can express the buffer rule, and the scan is not atomic, so all three genuinely exist
for different reasons. The deadlock lives in their **interaction**, not in any one of them.

---

## C. Where my first diagnosis was wrong

I concluded the fix was an ordered lock and reported the raw-SQL probe going from 10 deadlocks to 0.
**That measurement was invalid**: the probe issues its own SQL and never calls
`assertBookingConflictFree`, so it could not have exercised the change. The drop was run-to-run
variance.

Re-testing through the **real service path** showed something different:

| N=250, real service path | succeeded | cleanly rejected | deadlocks | raw constraint errors |
|---|---|---|---|---|
| Without the fix | 1 | 242 | **0** | **7** |
| With the fix | 1 | **249** | **0** | **0** |

At 250-way concurrency the service path **does not deadlock either way** — because the real path
populates `provider_slot_start/end`, so the GiST exclusion constraint rejects cleanly before the
speculative-insert cycle can form. My raw probe omitted those columns, which is why it fell through
to the unique index and deadlocked.

**So the advisory lock is not the deadlock fix I first called it.** What it demonstrably does is
convert **7 raw Postgres constraint errors into 7 clean typed `PROVIDER_UNAVAILABLE` rejections** —
a real improvement in error semantics, and a smaller claim than the one I made.

---

## D. The A/B on the actual suite

Earlier in this investigation I reported "8 with-fix trials, 8 clean." **Two of those eight trials
cannot be produced.** The job that ran them printed only its completion marker and its per-trial logs
were not retained, so the numbers existed only in my own summary. Rather than cite them, I re-ran the
whole comparison as a **symmetric 6-vs-6 with every log kept on disk.**

Each trial is one full run of `release-blocker-elimination.test.ts`, which drives 50- to 500-way
concurrency at a single provider slot.

| Trial | With the ordered lock | Without it |
|---|---|---|
| 1 | 10 pass / 0 fail / **0** deadlocks | 5 pass / 6 fail / **497** deadlocks |
| 2 | 10 pass / 0 fail / **0** | 10 pass / 0 fail / 0 |
| 3 | 10 pass / 0 fail / **0** | 10 pass / 0 fail / 0 |
| 4 | 10 pass / 0 fail / **0** | 10 pass / 0 fail / 0 |
| 5 | 10 pass / 0 fail / **0** | 7 pass / 3 fail / **69** deadlocks |
| 6 | 10 pass / 0 fail / **0** | 5 pass / 6 fail / **426** deadlocks |
| **Totals** | **6/6 clean · 0 deadlocks · 0 failures** | **3/6 clean · 992 deadlocks · 15 failures** |

Both arms ran on the same tree, same database, same machine, back to back. The only difference was
the presence of the eight-line lock. The without-fix file was produced by deleting exactly that
block, and the with-fix file was restored from a checksum-verified copy afterwards
(`96c85ac410365bd509be7386b3d51699`, identical before and after).

### How strong is this?

Stated as a test rather than an impression. Under the null hypothesis that the lock makes no
difference, the chance that all three storms land in the without-fix arm is:

```
C(6,3) / C(12,3) = 20 / 220 = 0.091      one-tailed Fisher exact, p = 0.09
```

**On this set alone the result is suggestive, not significant at 0.05.** Pooling the fresh trials
with the earlier without-fix set whose counts survive in a retained job log (298 and 498 deadlocks,
one clean run) gives 12 clean / 0 storms with the lock against 5 clean / 5 storms without:

```
C(10,5) / C(22,5) = 252 / 26,334 = 0.0096     pooled one-tailed Fisher exact, p = 0.01
```

That pooled figure is the stronger claim, and it carries the weaker provenance — two of its five
storms come from a set whose per-trial logs no longer exist. **The 6-vs-6 above is the number I would
defend; the pooled figure is corroboration, not evidence in its own right.**

### Why it plausibly helps even though the service path does not deadlock at 250

The suite mixes creates, updates and reschedules against overlapping slots. Serialising every
transaction that touches one provider-slot on a single lock taken *first* removes the opportunity for
two lock orders to interleave, whatever the mix. The 250-way probe exercises creates only, which is
why it sees the constraint rejection path rather than the cycle.

---

## E. The fix

One statement, taken **before** any other lock in the conflict check:

```sql
SELECT pg_advisory_xact_lock(hashtext($providerId), hashtext($slotISO))
```

| Property | Why it matters |
|---|---|
| **Taken first** | Everyone contending for one slot queues on one lock in one order — no cycle can form |
| **Keyed on the resource** | Different slots hash differently and never meet; concurrency is **ordered, not reduced** |
| **Transaction-scoped** | Releases on commit *or* rollback, including a rollback the caller never sees. Nothing to leak |
| **Provider-scoped only** | Slot-less bookings skip it entirely |

### What was deliberately not done

§15 names these explicitly, and each was available and rejected:

- **Lowering the test's concurrency** — hides the cycle and removes the only place it is observable.
- **Adding sleeps** — makes the race less likely without making it impossible.
- **Widening the retry loop** (already 8 attempts) — spends more time in the cycle.
- **Catching `40P01` and reporting success** — converts a correctness failure into a silent one.
- **Dropping the `FOR UPDATE` scan** — it enforces the buffer rule, which no index expresses.

---

## F. Classification

| Question | Answer |
|---|---|
| Database design? | Partly — one invariant, three mechanisms |
| Transaction order? | **Yes** — the root cause. Two lock kinds acquired in varying order |
| Missing index? | No — three cover it |
| Lock granularity? | Contributory — a range `FOR UPDATE` plus per-key index locks |
| Retry design? | Contributory — retries re-enter with different lock state |
| Test harness? | Partly — the suite drives 500-way single-slot contention no real user pattern produces |
| Application concurrency? | Yes, in the suite |

---

## G. Honest residuals

- **Causation is supported, not proven.** The clean 6-vs-6 lands at p = 0.09 — under the
  conventional bar. The pooled p = 0.01 clears it but leans on trials whose logs are gone. More
  trials would settle it; I stopped at twelve.
- **I over-claimed once and corrected it twice.** The first root-cause statement rested on a probe
  that never called the changed function, and the "8/8" trial count included two runs I cannot
  produce. Both are recorded above rather than quietly dropped.
- **The measured benefit I can defend unconditionally** is the error-semantics one: 7 raw Postgres
  constraint errors to 0, at 250-way concurrency, reproducibly, in both directions.
- **The suite drives contention no real user pattern produces.** 500 customers booking one
  provider-second is a stress test, not a workload. The lock is still correct to have.
- **Deadlocks elsewhere are untested.** The wallet and reschedule paths also appear in failing runs
  and were not investigated here.
