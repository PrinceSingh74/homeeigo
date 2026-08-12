# Phase 2 — Final Independent Certification

**Verdict: `B. CERTIFIED WITH LIMITATIONS / FREEZE WITH LIMITATIONS`**

**HEAD:** `de605adabd4ed412e551e65f9b478c0e0d986c90` (= `de605ad`, the remediation commit)
**Branch:** `cursor/stage-e-step-13-certification` · **Date:** 2026-08-08
**Mode:** read-only. Nothing modified, seeded, mutated, trained, deployed, staged, or committed.

> **Auditor disclosure:** commits `4c4ffbf` and `de605ad` were both authored by me. This
> audit re-verified every claim against live Postgres, live BigQuery and the repository
> rather than against those commit messages. One claim was found to be **overstated** and
> one **new material finding** is reported below.

---

## 1. Executive Verdict

All three remediation targets are **independently confirmed closed**:

| Gap | Claim | Independent finding |
|---|---|---|
| P1-1 provenance to BigQuery | closed | **CONFIRMED** — `arrival_source` identical across Postgres and all four BQ layers |
| P1-2 idempotent warehouse writes | closed | **CONFIRMED** — all four tables MERGE; `rows == distinct` everywhere |
| P2-2 synthetic quarantine | closed | **CONFIRMED** — 1 fixture flagged, 0 reached the eligible view |

**11 of 12 automated data checks passed.** The single failure is not a regression in the
remediation — it is a **pre-existing contract inconsistency** the remediation exposed:

> **Postgres reports 4 labels `TRAINING_READY`. BigQuery reports 0 training-eligible.**

Per the audit's own classification rule this is a **CONTRACT INCONSISTENCY**, not merely
data maturity, because the rule causing the divergence is **undocumented**. It is *not*
freeze-blocking — no corruption, no ML active — but it makes the readiness signal
misleading and must be resolved before the 50-label training trigger is trusted.

---

## 2. Release Identity — PASS

```
HEAD            de605adabd4ed412e551e65f9b478c0e0d986c90
short           de605ad                     (matches expected)
branch          cursor/stage-e-step-13-certification
files           11_phase2_eta_remediation.sql (A), bq-client.ts (M),
                eta-synthetic-classifier.test.ts (A), eta-intelligence.service.ts (M)
uncommitted     none in any Phase 2 path
```

---

## 3. Architecture Verification — PASS (no duplication)

```
runEtlJob implementations       1
runWithLeaderLock implementations 1
etl.eta job definitions        1
loadRows refs in ETA service   0   (fully migrated to mergeRows)
```

`mergeRows()` was added **inside the existing `bq-client`** and delegates the typed load to
the existing `loadRows`. No second ETL engine, scheduler, outbox, retry, DLQ or feature
store was introduced.

---

## 4. P1-1 Provenance — PASS

Verified by **value comparison**, not column presence:

| booking | Postgres | eta_raw | eta_validated | eta_feature | eta_training |
|---|---|---|---|---|---|
| cmsikst7y… | (absent→gps_geofence) | gps_geofence | gps_geofence | gps_geofence | gps_geofence |
| cmsil6un1… | (absent→gps_geofence) | gps_geofence | gps_geofence | gps_geofence | gps_geofence |
| cmsilelez… | (absent→gps_geofence) | gps_geofence | gps_geofence | gps_geofence | gps_geofence |
| cmsk6rc6d… | job_start | job_start | job_start | job_start | job_start |

- Provenance identical across Postgres and all four layers: **PASS**
- Every value within `{gps_geofence, job_start}`: **PASS**

Three labels hold no explicit provenance in Postgres `features` (they predate `4c4ffbf`).
The warehouse carries `gps_geofence` for them, which is a **fact, not an assumption**: the
`job_start` capture path did not exist when those labels were created, so the GPS geofence
was the only route to `arrivedAt`.

---

## 5. Quality / Validation Propagation — PASS

`eta_training` now carries all four discriminators:

```
cmsikst7y…  src=gps_geofence  q=100  status=TRAINING_READY  synthetic=false
cmsil6un1…  src=gps_geofence  q= 90  status=TRAINING_READY  synthetic=false
cmsilelez…  src=gps_geofence  q= 90  status=TRAINING_READY  synthetic=false
cmsk6rc6d…  src=job_start     q= 85  status=TRAINING_READY  synthetic=true
```

A future trainer can distinguish REAL/SYNTHETIC, VALID/INVALID, quality tier, and
GPS-confirmed vs job-start-inferred arrival. **All fields populated on every row.**

---

## 6. P1-2 Idempotency — PASS (implementation) / limited runtime scope

**Business key independently proven, not assumed:**
- Postgres: `bookingId String @unique` on `EtaTrainingLabel` (schema.prisma:477)
- BigQuery: `booking_id STRING NOT NULL` on all 4 ETA tables (4 declarations)
- No separate label id exists in the warehouse

**Implementation verified at source** — all four canonical tables use `mergeRows`:
```
592  mergeRows("raw",       "eta_raw",       "booking_id", …)
595  mergeRows("validated", "eta_validated", "booking_id", …)
601  mergeRows("feature",   "eta_feature",   "booking_id", …)
624  mergeRows("analytics", "eta_training",  "booking_id", …)
```
`loadRows` references in the ETA service: **0** — no append bypass remains.

The MERGE de-duplicates its own source (`ROW_NUMBER() … QUALIFY __rn = 1`), so a batch
containing the same key twice still yields one row.

> **Runtime re-proof in this pass: NOT VERIFIED — MUTATION REQUIRED.** Re-running the
> repeated-merge test writes rows. Current state is *consistent* with idempotency
> (`rows == distinct` on all four tables), and the earlier remediation recorded
> 4→4→4→4 across three repeats, but that evidence is not independent of the commit
> under audit and is reported as such.

**FULL / INCREMENTAL / REPLAY / BACKFILL / RETRY:** all route through the same
`mergeRows` write path, so idempotency is a property of the write rather than of the
run mode. Design-level PASS; per-mode runtime proof would require mutation.

---

## 7. Warehouse Reconciliation — PASS

```
eta_raw        total=4  distinct=4  null_keys=0  synthetic=1  real=3   UNIQUE
eta_validated  total=4  distinct=4  null_keys=0  synthetic=1  real=3   UNIQUE
eta_feature    total=4  distinct=4  null_keys=0  synthetic=1  real=3   UNIQUE
eta_training   total=4  distinct=4  null_keys=0  synthetic=1  real=3   UNIQUE

Postgres ETA labels: 4    BigQuery distinct: 4    RECONCILED
Orphan warehouse rows (no Postgres label): 0
```

Prior state was 9 rows / 4 distinct (2.25×) in every table. **Duplication eliminated.**

---

## 8. P2-2 Synthetic Quarantine — PASS

**Authoritative mechanism:** only `nextBookingNumber()` (`src/lib/booking-number.ts`) can
mint a production booking number, and it always emits `HOMIGO-YYYYMMDD-NNNNN`. The
classifier is a **regex allowlist** (`/^HOMIGO-\d{8}-\d{5}$/`); anything else — including
any future fixture prefix — is synthetic by default, and null/empty fails closed.

Verified against live data: 289 `HOMIGO-*` bookings, 5 non-production (`RC`, `FM`, `ADV`,
`P2VERIFY`). Of labelled bookings, 3 real and 1 synthetic.

```
rows flagged synthetic                    : 1
synthetic rows reaching the eligible view : 0   (required 0)
```

11 dedicated tests cover production formats, six known fixture prefixes, seven
near-miss variants, and null/empty inputs.

---

## 9. Training Eligibility — LIMITED (0 eligible, every exclusion explained)

```
booking        dur   real valid label plaus qual prov   verdict
cmsikst7y…       1s   Y    Y     Y     .     Y    Y     duration 1s  < 60s floor
cmsil6un1…      46s   Y    Y     Y     .     Y    Y     duration 46s < 60s floor
cmsilelez…      35s   Y    Y     Y     .     Y    Y     duration 35s < 60s floor
cmsk6rc6d…    1500s   .    Y     Y     Y     Y    Y     synthetic

eligible: 0
```

Only two exclusion causes exist, both correct: one synthetic fixture, and three real
trips whose dispatch→arrival duration is physically implausible.

---

## 10. Minimum-Duration Contract — **CONTRACT INCONSISTENCY**

The audit asked five specific questions. Answers from evidence:

**A. Is the 60-second minimum an intentional training-data policy?**
**Probably yes.** It appears in three independent views spanning two phases, and
`02_training_views.sql:20` carries the comment `-- drop outliers`:
```
02_training_views.sql:20            BETWEEN 1 AND 240      (minutes = 60s..14400s)
10_phase2_eta_intelligence.sql:113  BETWEEN 60 AND 14400   (seconds)
10_phase2_eta_intelligence.sql:132  BETWEEN 1 AND 240      (minutes)
```
`git log -S` shows it was introduced by **`7ff5683` — the original Phase 2 certification
commit**, not by either remediation commit. `de605ad` only carried it forward.

**B. Is it documented?** **NO.** A repository-wide search for "minimum duration",
"MIN_TRAVEL", "60 second" across `docs/`, `analytics/` and `src/` returns **zero matches**.

**C. Is it enforced consistently?** **Within BigQuery, yes** — all three views agree.
**Across the stack, no** — `validation.ts` enforces `MAX_TRAVEL_SEC = 4h` and rejects
negatives, but has **no lower bound**. A 1-second trip scores **100** and is marked
`TRAINING_READY`.

**D. Does Postgres TRAINING_READY conflict with BigQuery eligibility?** **YES, on all 4
labels.** Postgres: 4 ready. BigQuery: 0 eligible. Disagreement: 4.

**E. Classification:** **CONTRACT INCONSISTENCY**, per the audit's own rule — Postgres
declares records training-ready while BigQuery silently rejects the same records under an
undocumented rule.

**Business impact.** `getReadinessReport()` and the `homigo_eta_training_ready` gauge count
`TRAINING_READY` labels against a 50-label threshold. Those counters therefore include
labels that can never train. When the gauge reaches 50 and someone acts on it, the
eligible set may still be empty. The trigger condition is measuring the wrong thing.

**Freeze-blocking? NO.** No corruption, no data loss, no ML active, and BigQuery is
enforcing the *physically correct* bound. This is a misleading-signal defect.

**Not fixed** — the remediation brief instructed not to change validation rules.
Recommended resolution: align the two contracts (either add a minimum to `validation.ts`,
or have readiness reporting count BigQuery-eligible labels) **and document the policy**.

---

## 11. ML Safety — PASS

```
eta_prediction_history rows : 0
BigQuery models named *eta* : NONE
```
No ETA model exists, no prediction has ever been written. Google Maps remains the
customer-facing ETA source (`booking.eta` drives it; no ML path present).

---

## 12. Phase 0 & Phase 1 Regression — PASS

**63 tests pass / 0 fail across 8 suites** (event foundation, event bus, failure
scenarios, scheduled jobs, ETA intelligence, arrival provenance, synthetic classifier,
demand forecast).

Phase 1 integrity: 1 ETL engine, 1 leader lock, `etl.eta` registered once. No parallel
ETA pipeline.

---

## 13. Privacy — PASS

```
eta_raw        hashed=[partner_hash, customer_hash]   raw_pii=[none]
eta_validated  hashed=[partner_hash, customer_hash]   raw_pii=[none]
eta_feature    hashed=[partner_hash]                  raw_pii=[none]
eta_training   hashed=[-]                             raw_pii=[none]
```
Scanned for `user_id`, `customer_id`, `provider_id`, `partner_id`, `email`, `phone`,
`address`, `password`, `token`, `secret`. **Zero raw identifiers in any ETA table.**
`eta_training` carries no identity column at all — only `booking_id`.

---

## 14–16. Not Verified

| Item | Status | Why |
|---|---|---|
| Observability (live) | **NOT VERIFIED** | Backend is **DOWN** — nothing listening on :3000, `/health` unreachable. Starting it is a state change, declined in a read-only audit. Source shows 8 ETA metrics and 5 ETA alerts defined. |
| Performance | **NOT VERIFIED — NO DEFINED SLO** | No Phase 2 SLO exists in the repository. Not inferred. |
| Production | **NOT VERIFIED** | No production access from this environment. Only local dev/BigQuery-dev was reachable. Never assumed. |

---

## 17. Final Scorecard

| Gate | Result |
|---|---|
| Release Identity | **PASS** |
| P1-1 Provenance | **PASS** |
| Quality Propagation | **PASS** |
| P1-2 Idempotent BQ | **PASS** (implementation); runtime re-proof NOT VERIFIED — mutation required |
| Duplicate Integrity | **PASS** |
| Synthetic Quarantine | **PASS** |
| Warehouse Reconciliation | **PASS** |
| Training Eligibility | **LIMITED** — 0 eligible, all exclusions explained |
| Minimum Duration Contract | **LIMITED** — contract inconsistency, undocumented, not freeze-blocking |
| ML Inference OFF | **PASS** |
| Google ETA Primary | **PASS** |
| Phase 0 Regression | **PASS** |
| Phase 1 Regression | **PASS** |
| Privacy | **PASS** |
| Observability | **NOT VERIFIED** (backend down) |
| Performance | **NOT VERIFIED** (no SLO defined) |
| Production | **NOT VERIFIED** (no access) |
| Git Integrity | **PASS** |

---

## 18. Remaining Limitations

| # | Limitation | Severity | Blocks freeze? |
|---|---|---|---|
| 1 | Postgres `TRAINING_READY` (4) vs BigQuery eligible (0) — undocumented 60s floor not mirrored in `validation.ts`; readiness metric therefore misleading | P1 | **No** |
| 2 | 0 training-eligible labels — 3 real trips have sub-minute durations | Data maturity | **No** |
| 3 | 60s floor undocumented anywhere in the repository | P2 | No |
| 4 | Live observability unverified (backend down) | P2 | No |
| 5 | Production state unverified (no access) | — | No |
| 6 | Runtime idempotency re-proof requires mutation | — | No |

---

## 19. Final Classification

# `B. CERTIFIED WITH LIMITATIONS / FREEZE WITH LIMITATIONS`

**Not A**, because a material limitation remains: two authoritative systems disagree about
which labels are training-ready, the governing rule is undocumented, and the operational
readiness signal is consequently wrong. That is a contract defect, not a data-volume
condition, and the rules reserve A for "no material limitations remain."

**Not C**, because no critical data-integrity defect exists. All three remediation targets
are independently proven closed: provenance survives end-to-end, the warehouse holds
exactly one canonical row per booking, and synthetic data cannot reach training.

```
PHASE 2
INFRASTRUCTURE   = PASS
DATA COLLECTION  = PASS
DATA QUALITY     = PASS (warehouse integrity) / LIMITED (0 trainable labels)
ML INFERENCE     = OFF
PRODUCTION       = NOT VERIFIED
```

**FREEZE PHASE 2 — WITH LIMITATIONS.**
**Phase 3 authorized**, provided limitation 1 is resolved before the 50-label training
trigger is acted upon.
