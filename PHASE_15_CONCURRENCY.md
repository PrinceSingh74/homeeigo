# PHASE 15 — Concurrency

Every result below is from a real concurrent execution, not a reasoned argument about locking.

---

## A. Phase-15 concurrent paths

| # | Operation | Contention | Mechanism | Result |
|---|---|---|---|---|
| 1 | Two operators review one draft | `Promise.all(APPROVE, REJECT)` | Optimistic `updateMany … where status = DRAFT` | **1 wins, 1 `LOST_RACE`**; exactly one terminal state |
| 2 | Second review of a decided draft | sequential | Status guard | `ALREADY_REVIEWED` |
| 3 | Concurrent draft creation | independent inserts | none needed | Each is a distinct proposal — see §C |
| 4 | Concurrent scenario runs | read-only | none needed | Deterministic; same inputs + snapshot ⇒ same `scenarioId` |
| 5 | Concurrent model evaluations | read-only | none needed | No stored state |
| 6 | Ten concurrent audit writes, one trace | `Promise.all` × 10 | none — the unique index was the bug | **10 / 10 stored** |

---

## B. Inherited paths re-verified

| # | Operation | Result |
|---|---|---|
| 7 | 30 concurrent AI budget reservations against a cap sized for 5 | **5 allowed, 25 denied, committed `$0.138000` = the limit exactly** |
| 8 | Two operators recover one stuck workflow instance | 1 `RECOVERED`, 1 `LOST_RACE`, **1** wake-up job queued |
| 9 | Ten concurrent governance events on one trace, on a **clone of real production data** | **10 / 10 stored** where production today permits 1 |

The budget case is the one that matters most: a read-then-write check would let all 30 observe the
same headroom. The single atomic `UPDATE … WHERE reserved + settled + amount <= limit` is what makes
the cap hold, and it holds to the cent.

---

## C. Where idempotency is deliberately absent

**Draft creation is not idempotent, on purpose.** Two identical intents submitted twice produce two
drafts. Deduplicating them would discard evidence: a resubmitted intent is a second proposal, and
whether someone asked twice is exactly the kind of thing a reviewer of machine-generated automation
wants to see.

Draft *review* is idempotent — the second attempt returns `ALREADY_REVIEWED` rather than moving the
row again.

---

## D. The audit-ordering race, found and fixed

The review path must resolve the two-reviewer race **before** auditing, because the optimistic
update is what decides the winner. That ordering left a window:

```
before : status commits → audit throws → draft APPROVED with nobody's name on it
after  : status commits → audit throws → compensate to DRAFT → rethrow
```

Found by the chaos suite renaming the audit table away — a real outage, not a stub. The fix is
compensation, not reordering: reordering would break the race resolution that makes §A-1 correct.

If the compensation itself fails, the draft genuinely is decided-but-unaudited, and that is logged
at `error` as `ai_workflow_draft_review_unaudited` — the one state nobody could reconstruct later.

---

## E. Regression-suite concurrency failures — classified

The full suite reports failures in four concurrency suites. §26 requires proving the classification
rather than asserting "pre-existing".

**Evidence they are infrastructure behaviour, not product defects:**

1. **They are timeouts from Postgres deadlocks (`40P01`)**, not assertion failures. The assertions
   that do fail are post-timeout consequences — "1 success, 0 duplicates" checked after the
   transaction was killed.
2. **The count is unstable on an unchanged tree.** `release-blocker-elimination` produced 2 unique
   failures in one run and 7 in another with no code change between them.
3. **Isolation makes it worse, not better.** Run alone with the database to itself, that file
   produced **278 deadlocks and 8 failures** — roughly three times its batch result. Contention from
   other test files therefore cannot be the cause; the suite deadlocks against itself.
4. **No code path.** Nothing in Phase 15 touches `booking.service.ts` or its transaction. The
   suites exercise 50- to 500-way concurrent booking creation and rescheduling.
5. **Suite identity is stable across four runs** spanning Phase 14 and Phase 15, even as the count
   moves.

**Classification: `PRE_EXISTING` — infrastructure concurrency behaviour**, proven by (2) and (3)
rather than assumed. A raw pass count from these suites is not a signal; the identity of the failing
suites is, and it has not changed.

**What this does not claim:** that the deadlocks are acceptable. A platform that cannot push 250
concurrent bookings through Postgres row locks inside 60 seconds has a real scalability
characteristic worth addressing — it is simply not Phase-15 scope, and hiding it inside a
"pre-existing" label without the evidence above would be the failure §26 warns about.

---

## F. Not tested

- **Sustained load** on Phase-15 services. Simulation is a cached read and drafting is a single
  insert; neither is on a traffic-serving path, and a synthetic benchmark would be less honest than
  saying so.
- **Concurrent model promotion** — nothing promotes; both models are offline.
- **Concurrent voice / recommendation serving** — not built.
