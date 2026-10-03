# PHASE 15 — Test Evidence

Every figure below is a measured result. Where a test was wrong before it was right, that is
recorded — a guard that has been silently corrected is a guard nobody can trust.

**Environment:** `homigo_test` for the suite, `homigo_db` read-only for the model evaluation,
`homigo_p39` for probes. Date: 2026-09-05.

---

## A. Phase-15 suite

```
bun test src/__tests__/phase15-advanced-intelligence.test.ts
  33 pass
   0 fail
```

| Group | Tests | Property held |
|---|---|---|
| Scenario simulation | 9 | No fabricated confidence · assumptions named · reproducible ids · honest freshness · read-only · no currency conversion |
| AI workflow drafting | 14 | Allowlists non-empty · ACTION refused · unknown ids refused · no contact detail · bounds · review discipline · concurrency |
| Cancellation model | 6 | Leakage exclusions · temporal split · two baselines · materiality separate · limitations stated · refuses thin holdouts |
| Audit integrity & chaos | 4 | Governance act fails closed on audit outage **and compensates** · low-risk reads unaffected · table outage visible · empty registry warns |

```
bun test src/__tests__/phase14-governance.test.ts
  26 pass / 0 fail      (includes the widened provider-host bypass guard)
```

---

## B. Guards proven by deletion

A guard that has never been shown failing is not evidence. Both critical guards were verified by
reintroducing exactly what they exist to catch.

### B1 — Provider bypass guard

| State | Result |
|---|---|
| `checkAndReserveBudget(` removed from `vision-intelligence.service` | **FAILS** — `services/vision-intelligence.service.ts` appears in the offender list |
| Restored | **29 pass / 0 fail** |

**Two earlier versions of this guard passed while a real bypass was present**, and both failure
modes are worth naming:

1. It accepted an `import` of `checkAndReserveBudget` as evidence of governance, so deleting the
   *call* left it green. Fixed by matching calls (`/checkAndReserveBudget\s*\(/`), not mentions.
2. Its regex contained a **literal backspace byte** — a word-boundary escape mangled during
   authoring — so it matched nothing and asserted `[] === []`. Fixed, and the guard now asserts its
   own coverage (it must find the adapter file and the one governed exception) *before* asserting
   the offender list is empty.

### B1b — Provider **host** guard (added this pass)

The adapter-name guard could not see a raw `fetch`. `knowledge-embedding.service` reached Gemini's
`embedContent` endpoint that way — ungoverned, on every RAG query.

| State | Result |
|---|---|
| `recordEmbeddingSpend(` removed from `knowledge-embedding.service` | **FAILS** — the file appears in the offender list |
| Restored | **26 pass / 0 fail** (Phase-14 suite) |

The guard now matches provider **hosts** as well as adapter names, and asserts it found the
embedding service among the scanned files before checking the offender list.

### B2 — ACTION-step refusal

| State | Result |
|---|---|
| `"ACTION"` added to `ALLOWED_STEP_TYPES` | **FAILS** — 2 failures |
| Restored | **29 pass / 0 fail** |

---

## C. Adversarial cases — all refused

Ten attacks against the workflow drafter, each asserting a specific finding code:

| Attack | Refused with |
|---|---|
| `ACTION` step naming `finance.refund` | `STEP_TYPE_ACTION_REFUSED` |
| Unregistered condition id | `CONDITION_UNKNOWN` |
| Unregistered trigger | `TRIGGER_UNKNOWN` |
| Notification carrying `phone` + `body` | `NOTIFICATION_CARRIES_CONTENT` |
| Recipient `attacker@example.com` | `RECIPIENT_INVALID` |
| 41 steps | `STEPS_TOO_MANY` |
| 400-day WAIT | `WAIT_TOO_LONG` |
| Duplicate step ids | `STEP_ID_DUPLICATE` |
| Approving an invalid draft | `REVALIDATION_FAILED` |
| Approving with a 2-char note | `NOTE_REQUIRED` |

---

## D. Concurrency

```
two reviewers, same draft, Promise.all(APPROVE, REJECT)
  succeeded : 1
  codes     : one RECOVERED-equivalent, one LOST_RACE
  final state: exactly one of APPROVED / REJECTED
```

Decided by an optimistic `updateMany … where status = DRAFT` — the same discipline Phase 14 used
for workflow recovery.

---

## E. Read-only isolation, verified by counting

```
before: bookings / payments / ledger_entries
run   : scenario(+200% demand, -90% supply, festival) and whatIf(-50% demand, rain)
after : identical
```

Structural as well as tested: `scenario-simulation.service` imports the digital twin, metrics and
the logger — no repository, no finance service, no workflow entry point.

---

## F. Cancellation model — the measured result

```
status         : EVALUATED
split          : TEMPORAL  train=270 test=117 testPositives=32
train window   : 2026-06-09 -> 2026-08-24
test window    : 2026-08-24 -> 2026-09-04

candidate      : AUC 0.7085  Brier 0.2158
base-rate      : AUC 0.5000  Brier 0.2404
prior-rate rule: AUC 0.6945  Brier 0.2216

beats baseline : true   (auc:true brier:true)
materiality    : materiallyBetter=false  margin=0.014  SE=0.057  (0.24 SE)
verdict        : "within the noise of this holdout ... NOT distinguishable from the baseline rule"
top weights    : prior_cancel_rate=2.3676  is_first_booking=0.6595
                 lead_time_hours_log=0.4169  is_weekend=0.3702
```

**The model beats both baselines and must not be promoted.** That is the finding.

**The materiality check did not exist in the first implementation.** The first run reported
`beatsBaseline: true` with no error bar — arithmetically correct, practically meaningless, and
exactly the kind of result this phase forbids shipping. The Hanley–McNeil standard error was added
afterwards, and the Prometheus gauge publishes the materiality rather than the bare comparison.

**Refusal threshold verified:** `evaluate(0.01)` — a 1% holdout — returns `DATA_INSUFFICIENT`
naming the holdout rather than computing metrics on a handful of positives.

---

## G. Typecheck

```
bunx tsc --noEmit -p tsconfig.json
  3 errors — all in src/__tests__/partner-four-axis.test.ts
  0 errors from Phase-15 code
```

That file is **untracked**, created 2026-09-05 01:26 between the two Phase-14 passes by neither of
them, and tests `PARTNER_AXIS` literals from a module this phase never touched. Someone's work in
progress; left alone rather than silently edited.

---

## H. Cross-phase regression — fresh, after the second pass

```
half 1 (70 files) : 1158 pass /  13 fail
half 2 (70 files) :  808 pass /   9 fail
COMBINED          : 1966 pass /  22 fail across 140 files (1988 tests)
248 Postgres deadlocks
```

### The 22 failures are pre-existing

**Zero are Phase-15 tests. Zero are knowledge, RAG or embedding tests** — checked explicitly,
because this pass modified `knowledge-embedding.service`, which the RAG suites exercise.

All 22 sit in four concurrency suites:

| Suite | Unique failures |
|---|---|
| Release blocker elimination | 7 |
| Chaos & resilience certification | 4 |
| Enterprise scalability — concurrent reschedule | 3 |
| Pass 11 money matrix certification | 2 |
| unnamed | 2 |
| in-suite duplicates | 4 |

### On the count moving from 16 to 22

An earlier run in this same session produced 16. That movement is the point, not a problem:
`release-blocker-elimination` produced **2 unique failures in one run and 7 in another on the same
tree**. Phase 14 measured the extreme of this directly — run **alone**, with the database to
itself, that file produced **278 deadlocks and 8 failures**, roughly three times its batch result.

The suite deadlocks against itself under 50- to 500-way concurrent booking creation, and how many
of its assertions the timeouts take down varies run to run. A raw pass count from this suite is not
a signal; the *identity* of the failing suites is, and that has not changed across four runs
spanning Phase 14 and Phase 15.

**No code path** — nothing in Phase 15 touches `booking.service.ts` or its transaction.

---

## I. Production safety

| Guarantee | Evidence |
|---|---|
| `homigo_db` never written **by this phase** | `ai_workflow_drafts` table **absent**; 0 rows matching `p15%`. The 17 audit rows and 7 bookings written during the phase were real application traffic — websocket connects, token refresh, a partner application, booking `HOMIGO-20260905-00003` — from a separate running dev backend, not from any probe here |
| Business state moved only by real traffic | bookings 522 → **529** and payments 327 over the phase, all from live application use. Every Phase-15 write went to `homigo_p39` or `homigo_test`; the only Phase-15 query against `homigo_db` was the model evaluation, which is a read |
| Migration scope | `homigo_p39` and `homigo_test` only |
| Production deployment | **none** |

---

## J. Forensic sweep over new code

`TODO · FIXME · HACK · mock · fake · stub · placeholder · Math.random · eval( · process.exit`
across the three new services and the routes file:

**Zero hits**, apart from one comment in `cancellation-risk.service.ts` using the phrase "fake
intelligence" to explain why the materiality check exists. Hardcoded-confidence search: two hits,
both comments explaining why the engine's `0.8` is rejected.
