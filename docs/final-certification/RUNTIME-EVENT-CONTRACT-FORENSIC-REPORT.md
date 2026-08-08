# Runtime Event Contract — Post-Fix Forensic Report

**Verdict:** `STALE OUTBOX EVENTS CONFIRMED — NO ACTIVE PRODUCER DEFECT`
**Certification gates:** **6 of 6 PASS** — after remediation R1 was approved and applied.
**Date:** 2026-08-08
**Branch:** `cursor/stage-e-step-13-certification`
**HEAD at investigation:** `914c7dde4ef592d511ac9f79a794aa81c9bc234f`

> **Reading note.** This report is written in investigation order. Sections up to *Root Cause* describe the system **as found**, when defect 2 was still live. Remediation R1 was subsequently approved and applied; see *Remediation Applied* and *Certification Gate* at the end for the resolved state.

---

## Executive Summary

The post-fix error logs are real, and my earlier `PASS` was wrong. But the logs are **not** caused by the namespace defect, and **not** caused by any active producer.

Two distinct defects are in play:

| # | Defect | Status |
|---|--------|--------|
| 1 | Phase 2 ETA events registered under `eta.*` instead of `homigo.*` | **FIXED** by 914c7dd, runtime-proven |
| 2 | Phase 0 outbox: terminal-`FAILED` rows are re-claimed forever | **FIXED** by R1 (approved), runtime-proven |

Defect 1 explains why those 6 rows can never publish. Defect 2 explains why they were still being *retried* 22 hours later, at 7,106 attempts against a configured ceiling of 5.

Both had to be found before any `PASS` was defensible. My earlier report found only the first and declared PASS anyway — that was wrong, and is corrected below. With both fixed, all six gates now pass on runtime evidence.

---

## Observed Failure

```
[ERROR] outbox_publish_failed {"eventType":"eta.feature.updated","attempts":7038,"error":"Invalid event type namespace: eta.feature.updated"}
[ERROR] outbox_publish_failed {"eventType":"eta.trip.completed","attempts":7000,"error":"Invalid event type namespace: eta.trip.completed"}
[ERROR] outbox_publish_failed {"eventType":"eta.label.created","attempts":7002,"error":"Invalid event type namespace: eta.label.created"}
```

Six distinct `eventId`s, cycling roughly every 5 seconds, attempts monotonically climbing.

---

## Release & Runtime Identity

| Field | Value |
|---|---|
| Git HEAD | `914c7dd` |
| Subject | fix(events): register Phase 2 ETA events with homigo namespace per Phase 0 contract |
| `event-types.ts` local drift | none — committed at HEAD |
| `etl-scheduler.ts` local drift | none — committed at HEAD |

**Runtime-loaded constants** (imported directly, not read from source):

```
EVENT_TYPES.ETA_LABEL_CREATED    = "homigo.eta.label.created"
EVENT_TYPES.ETA_TRIP_COMPLETED   = "homigo.eta.trip.completed"
EVENT_TYPES.ETA_FEATURE_UPDATED  = "homigo.eta.feature.updated"
```

**Proof the *running* process is on 914c7dd** — source inspection alone was not accepted. A single fresh event was emitted into the outbox and the already-running backend (PID 32528, never restarted) was left to handle it:

```
eventId  3830b4fb-d816-4c00-9270-306afb484ecc
type     homigo.eta.label.created
t+0s     PENDING    attempts=0
t+5s     PUBLISHED  attempts=1   error=none
```

The live process accepts and publishes the new namespace on the first attempt. **ROOT_CAUSE_F excluded.**

---

## Process Analysis

| PID | RSS | Command | Role | Port 3000 |
|-----|-----|---------|------|-----------|
| 23136 | 19.6 MB | `bun run dev` | script wrapper | no |
| 26276 | 10.9 MB | `bun --env-file=.env run --watch src/index.ts` | watch supervisor | no |
| **32528** | **294.2 MB** | `bun --env-file=.env run --watch src/index.ts` | **active backend** | **yes** |

Nothing was killed. Only one listener holds port 3000.

**Could a stale second instance be the producer?** No — and this is measured, not assumed. The observation window recorded **+36 attempts across 6 rows in 30s** = exactly **1 claim per row per 5s tick**, matching `EVENTS_OUTBOX_INTERVAL_MS` precisely. A second active processor would have roughly doubled that rate. The outbox is additionally gated by `runWithLeaderLock("maintenance:event_outbox")`. **ROOT_CAUSE_C excluded.**

A dormant old-namespace copy exists at `.step8-tmp/homigo-step8-c31f154/…/event-types.ts`. No process runs from that directory and nothing in the live tree imports it. Not a producer.

---

## Database Identity

| Field | Value |
|---|---|
| `current_database()` | `homigo_db` |
| server addr / port | `172.18.0.4` / `5432` (container, Docker bridge) |
| client URL | `postgresql://***@localhost:5433/homigo_db` (published host port) |
| env file | `.env` — **identical to the running backend's `--env-file`** |

The "backend → DB A, query → DB B" trap was explicitly ruled out by two live couplings:

1. The diagnostic watched `updatedAt` on the 6 rows advance in real time (last write 0.1 min before the read). Only the backend's processor produces those writes.
2. The backend consumed and published a row the diagnostic had just written.

Reading the backend's writes and having it act on ours proves a shared database. **ROOT_CAUSE_D excluded.**

---

## Outbox Analysis (read-only)

### Old namespace — `eta.*`

| eventId | type | status | attempts | createdAt |
|---|---|---|---|---|
| `fdf439c4…` | eta.label.created | FAILED | 7070 | 2026-08-07T06:53:44Z |
| `2156b539…` | eta.trip.completed | FAILED | 7068 | 2026-08-07T06:53:45Z |
| `85870be5…` | eta.feature.updated | FAILED | 7106 | 2026-08-07T06:53:48Z |
| `b2d9fa69…` | eta.label.created | FAILED | 6986 | 2026-08-07T06:58:39Z |
| `94abd6a9…` | eta.trip.completed | FAILED | 6987 | 2026-08-07T06:58:39Z |
| `5cb1b1c6…` | eta.feature.updated | FAILED | 6987 | 2026-08-07T06:58:39Z |

All 6: `source = homigo/eta-intelligence`, `status = FAILED`, `DEAD_LETTERED = 0`.

### New namespace — `homigo.eta.*`

4 rows, **all `PUBLISHED`, all `attempts = 1`**, zero errors.

### The number that cracked the case

```
EVENTS_OUTBOX_MAX_ATTEMPTS (configured) =     5
observed attempts                       = 7,106
```

Attempts exceeding the ceiling by 1,421× is structurally impossible under a correct retry bound. That single inconsistency is what exposed defect #2.

---

## Old vs New Events

| | old `eta.*` | new `homigo.eta.*` |
|---|---|---|
| newest `createdAt` | 2026-08-07T06:58:39Z | 2026-08-08T05:03:23Z |
| relative to fix | **~22h before** | after |
| status | FAILED (6) | PUBLISHED (4) |
| attempts | 6,986 – 7,106 | 1 |

The stale rows predate the fix by nearly a day. Their `createdAt` has not moved.

---

## Producer Analysis

**Requirement:** zero active producers of the old namespace. **Met.**

- Literal search for `"eta.label.created" | "eta.trip.completed" | "eta.feature.updated"` across **all file types, whole repo** → **0 matches**.
- Exactly **two** runtime paths write `event_outbox`: `emitInTransaction` and `emitStandalone`, both in `event-publisher.ts`, both persisting `event.type` from a `HomigoEvent` built via the `EVENT_TYPES` catalog.
- All three ETA builders (`eta.events.ts:64,68,72`) read from `EVENT_TYPES` — none hardcode a string.
- The remaining two `eventOutbox.create` calls live in `scripts/phase0-full-certification.ts` (fixtures, not runtime-reachable).

Since the catalog is fully migrated and every runtime write funnels through it, **no runtime path can emit `eta.*`**. **ROOT_CAUSE_B and ROOT_CAUSE_E excluded.**

---

## Event Flow (fresh event, stage by stage)

| Stage | Component | eventType |
|---|---|---|
| 1 | `eta-intelligence.service.ts` call site | delegated |
| 2 | `eta.events.ts:etaEnvelope` via `EVENT_TYPES` | `homigo.eta.label.created` |
| 3 | in-memory `HomigoEvent` | `homigo.eta.label.created` |
| 4 | `emitStandalone` → outbox row | `homigo.eta.label.created`, PENDING |
| 5 | `claimBatch` (running backend) | attempts → 1 |
| 6 | `validateEventEnvelope` | **ACCEPTED** |
| 7 | `dispatchEvent` → `markPublished` | **PUBLISHED** |

No divergence between the in-memory event and the persisted row. The persistence layer is faithful.

---

## Root Cause

### Primary — `ROOT_CAUSE_A`: stale historical outbox rows only

The 6 `eta.*` rows were written ~22 hours before the fix by the then-current code. They are permanently un-publishable because their *persisted payload* carries the old namespace — the fix corrected the **producer**, and correctly did not rewrite **history**. No active producer emits the old namespace.

### Secondary — `ROOT_CAUSE_G`: `FAILED` is not terminal (Phase 0, **unfixed**)

This is the actual source of the ongoing log spam.

```
claimBatch:  WHERE status IN ('PENDING','FAILED') AND available_at <= NOW()

markFailed:  if (attempts >= maxAttempts)
               → set status='FAILED'          // available_at NOT advanced
```

`available_at` stays frozen at its original value (e.g. `2026-08-07T06:59:15Z`), which is permanently `<= NOW()`. The row therefore satisfies the claim predicate on **every** tick and is re-claimed forever, incrementing `attempts` each time. The "terminal" branch is not terminal.

This is a pre-existing Phase 0 defect. It has nothing to do with ETA specifically — it would afflict **any** permanently-failing event.

---

## Impact

| Impact | Severity |
|---|---|
| Unbounded error-log spam (6 rows × 12 claims/min, indefinitely) | High |
| Unbounded DB write amplification on a hot table | High |
| `homigo_outbox_publish_total{result="failed_terminal"}` inflates forever — metric unusable for alerting | High |
| No event ever truly reaches dead-letter rest | High |
| Phase 2 ETA data loss for the 6 stale events | Medium — labels persist in `eta_training_label`; only the event fan-out was lost |
| New ETA event production | **None — healthy** |
| Non-ETA outbox traffic | **None — healthy** |

---

## Remediation Applied

### R1 — Make the terminal branch terminal ✅ *(approved, applied)*

One line in `outbox-processor.ts:claimBatch`:

```diff
- WHERE status IN ('PENDING'::"EventOutboxStatus", 'FAILED'::"EventOutboxStatus")
+ WHERE status = 'PENDING'::"EventOutboxStatus"
```

Verified safe **before** applying:

| Concern | Finding |
|---|---|
| Genuine retries | Unaffected — `markFailed`'s non-terminal branch sets `PENDING` with backoff; still claimed |
| Stale-claim recovery | Unaffected — `recoverStaleClaims` resets `PROCESSING` → `PENDING` |
| Operator replay | Unaffected — `replayOutboxEvent` looks up by `eventId` regardless of status, dispatches directly |
| DLQ | Unaffected — enum has no `DEAD_LETTERED`; dead-lettering is a separate table |
| Namespace validation | **Untouched** — not relaxed, not bypassed |

**Runtime proof** (backend hot-reloaded under `--watch`; two read-only 30s windows):

| | attempt delta / 30s | interpretation |
|---|---|---|
| before R1 | **+36** | 1 re-claim per row per 5s tick — storm active |
| after R1 | **+0** | fully quiescent — storm halted |

Fresh event still publishes: `467402a0…` → `PENDING → PUBLISHED` in 1 attempt, <5s. Publishing is unbroken.

### R3 — Prevent recurrence ✅ *(applied)*

Added to `event-foundation.test.ts`: a guard iterating **every** `EVENT_TYPES` value and asserting the `homigo.` prefix, plus an ETA registration/validation test. The guard was proven non-vacuous — applied to the pre-fix values it flags exactly the 3 old entries and passes the 2 valid ones.

Suites: **26 pass / 0 fail** across `event-foundation`, `event-bus`, `event-failure-scenarios`, `eta-intelligence`.

`event-integration.test.ts` was deliberately **not** run — it writes to the live `homigo_db`, a documented hazard in this project. Its coverage of insert → claim → publish was obtained instead from the fresh-lifecycle run against the real running backend, which is stronger evidence.

### R2 — Fate of the 6 stale rows ⏸ *(deferred by decision)*

No migration performed. The rows are now **inert** — terminal `FAILED`, no longer re-claimed — so there is no time pressure. When revisited, each needs a compatibility judgement: payload schema, event version, consumer tolerance, idempotency key, and whether re-delivering a 22-hour-old ETA label is meaningful. My read: **re-publishing is probably not desirable** — these are training-label fan-out events whose ETL window has passed, and the underlying labels already persisted in `eta_training_label`. Parking them in DLQ is likely correct, but that is your call.

### R4 — Housekeeping ⏸ *(open)*

Redundant bun processes (PIDs 23136, 26276) and the dormant `.step8-tmp` snapshot.

---

## Tests

| Test | Result |
|---|---|
| Runtime constants use `homigo.` prefix | PASS |
| Namespace guard over all `EVENT_TYPES` (new) | PASS — and proven non-vacuous |
| ETA registration + envelope validation (new) | PASS |
| Event suites: foundation, bus, failure-scenarios, eta-intelligence | PASS 26/26 |
| Fresh event → validation → outbox → publish, on the running backend | PASS (1 attempt, <5s) |
| No new `eta.*` rows over a 30s window | PASS (+0 rows) |
| Retry storm halted | **PASS** — +36 → **+0** attempts / 30s after R1 |

---

## Correction of the Prior Claim

The earlier `EVENT CONTRACT PASS` is **withdrawn**.

It was asserted from database state — new rows publishing cleanly — without reconciling that against live runtime logs still emitting namespace errors. Two contradictory observations were on the table and I reported only the favourable one. The correct move was to treat the contradiction as unexplained and keep digging, which is what surfaced the retry-termination defect.

The namespace fix itself is sound and runtime-proven. It simply was never the whole story.

---

## Certification Gate

`CERTIFIED` requires all six. Current state:

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | New ETA events use `homigo.eta.*` | ✅ | runtime constants + `fresh-event.json` |
| 2 | Publisher accepts them | ✅ | validation ACCEPTED, `error=null` |
| 3 | Outbox processes them | ✅ | `PENDING → PUBLISHED` in 1 attempt |
| 4 | Consumers receive them | ✅ | `dispatchEvent` → `markPublished` |
| 5 | No new `eta.*` events created | ✅ | row delta +0, `createdAt` frozen |
| 6 | Retry storm stops | ✅ | attempt delta **+36 → +0** after R1 |

**6 of 6 PASS**, each on runtime evidence rather than source inspection.

Two caveats on scope, stated plainly: this certifies the **event contract** on a **local** environment. It is not a Phase 5 Gold Certification and not a clearance to begin Phase 6 — neither was started, per instruction. R2 (disposition of the 6 inert stale rows) remains open by your decision.

---

## Actions Explicitly Not Taken

- No outbox rows deleted; no tables truncated; no database reset
- No namespace validation disabled or relaxed
- No retry behaviour altered **to suppress the symptom** — R1 tightens the contract by making a terminal state actually terminal, and was applied only with explicit approval after a documented safety analysis
- No blind migration of `eta.*` → `homigo.eta.*`
- No processes killed during the forensic pass
- No Phase 5 Gold Certification, no Phase 6
- Production untouched

**Disclosure — test artifacts left in place.** The diagnostic scripts created a handful of `PUBLISHED` `homigo.eta.*` outbox rows with synthetic booking IDs. They were **not** removed, because the standing instruction prohibits deleting outbox rows. They are terminal records and will age out under the normal published-retention policy (`EVENTS_OUTBOX_PUBLISHED_RETENTION_DAYS=14`).

---

## Evidence Index

`docs/evidence/runtime-event-contract/post-fix-forensic/`

| File | Contents |
|---|---|
| `runtime-identity.json` | Git SHA, runtime constants, proof the live process runs 914c7dd |
| `processes.json` | All bun processes, port-3000 ownership, multi-instance exclusion |
| `database-identity.json` | Safe DB metadata, proof of shared-database coupling |
| `outbox-event-types.json` | Full row-level breakdown, old vs new, status/attempt counts |
| `producer-search.json` | Repo-wide literal search, every outbox write path, reachability |
| `event-flow.json` | Stage-by-stage trace + the secondary defect mechanism |
| `before-after-count.json` | 30s observation window, deltas, rate analysis |
| `fresh-event.json` | Controlled lifecycle against the running backend |
| `retry-termination-fix.json` | R1: safety analysis, diff, before/after runtime proof |
| `final-classification.json` | Classification, exclusions, gates, prior-claim correction |

---

**Verdict:** `STALE OUTBOX EVENTS CONFIRMED — NO ACTIVE PRODUCER DEFECT`
**Certification gates:** **6 of 6 PASS** on runtime evidence, scoped to the event contract on a local environment.
**Open:** R2 (disposition of the 6 now-inert stale rows), R4 (housekeeping).
