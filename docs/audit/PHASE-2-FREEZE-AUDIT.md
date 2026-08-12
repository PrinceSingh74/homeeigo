# Phase 2 — Final Closure / Freeze Audit

**Verdict: `B. CERTIFIED WITH LIMITATIONS / FREEZE WITH LIMITATIONS`**

**HEAD:** `4c4ffbf99957f7c87da02bfc73495b1af9e5dfff` (= certified commit)
**Branch:** `cursor/stage-e-step-13-certification` · **Parent:** `34cdc5a` · **Committed:** 2026-08-08 15:14:59 +0530
**Mode:** read-only. Nothing modified, migrated, seeded, trained, deployed, committed, or pushed.

> **Auditor disclosure:** commit `4c4ffbf` was authored by me earlier in this session. This
> audit therefore deliberately targets my own work, and the two P1 findings below are
> defects in that commit — including one that contradicts a claim in its own commit message.

---

## Executive Summary

Phase 2's **collection layer is correct**. The eligibility funnel proves the collector is not the bottleneck, the duration formula is enforced exactly, PII is hashed before reaching the warehouse, ML inference is verifiably OFF, and Phase 0/1 regression is clean at 58/58.

Two defects sit in the **warehouse projection**, and both were introduced or left unaddressed by the certified commit:

1. **Arrival provenance never reaches BigQuery.** `arrival_source` is absent from all four ETA tables. The commit message for `4c4ffbf` claims provenance is "persisted for training-time filtering" — true in Postgres, **false where training actually happens**.
2. **ETA warehouse tables carry 2.25× duplication** (9 rows / 4 distinct in every layer), structurally unbounded because each re-sync appends.

Neither corrupts the Postgres source of truth, and neither blocks anything today because ML training is Phase 3+ scope. But together they mean **the BigQuery training dataset is not fit for training as it stands**. For a phase whose entire purpose is producing that dataset, that is a material limitation — not a footnote.

---

## Final Gate Matrix

| Gate | Result | Evidence | Notes |
|---|---|---|---|
| Release Identity | **PASS** | HEAD = `4c4ffbf`, parent `34cdc5a` | no later commits touch Phase 2 paths |
| Commit 4c4ffbf | **PASS** | 6 files: validation, partner.events, booking/tracking/eta services, tests | matches Phase 2 scope |
| Working Tree | **PASS WITH LIMITATION** | Phase 2 paths clean; repo-wide dirty | no dirty file affects Phase 2 |
| Database | **PASS** | `20260807140000_phase2_eta_intelligence` tracked | 3 entities present |
| Event Namespace | **PASS** | catalog holds only `homigo.eta.*`; repo-wide old-namespace search = 0 | no active producer of old namespace |
| Eligibility | **PASS** | COMPLETED 108 → arrivedAt 3 → labels 4; gap = 0 | collector produces for every eligible booking |
| Arrival Provenance | **PASS WITH LIMITATION** | `job_start` populated on the new label | see P1-1 — stops at Postgres |
| GPS Arrival | **PASS** | `recordArrival(source:"gps_geofence")` from geofence path | radius + accuracy + speed + N-ping gates |
| Job-Start Arrival | **PASS** | quality 85 vs threshold 70, verified in source and data | −15 penalty configured in `validation.ts:104` |
| Idempotency | **PASS** | `updateMany … where arrivedAt: null`; Postgres `bookingId @unique` | single shared `recordArrival()` |
| Race Safety | **NOT VERIFIED** | — | concurrency proof requires mutation; declined per audit rules |
| Google ETA | **PASS** | 13 snapshots, all status OK; `eta` field drives customer ETA | remains primary |
| GPS Pipeline | **PASS** | 3 gzip-compressed tracks; coords rounded to 5dp | partner identity hashed |
| Feature Engineering | **PASS** | bearing/buckets/rush-hour/weather present on all labels | deterministic, pure function |
| BigQuery | **FAIL** | 5 duplicate rows per table; `arrival_source` absent everywhere | see P1-1, P1-2 |
| Feature Store | **PASS WITH LIMITATION** | `fs_eta_features_v2` view exists | inherits the duplication |
| ETL | **PASS** | `etl.eta` registered, 93 SUCCEEDED, watermark advancing (20 rows) | reuses Phase 1 engine, no duplicate stack |
| Training Readiness | **PASS** | 4 TRAINING_READY, threshold logic in `validation.ts:100` | 4/50 — data maturity |
| ML Inference OFF | **PASS** | `eta_prediction_history` = 0 rows; zero BQ models named `*eta*` | confirmed OFF |
| Phase 0 Regression | **PASS** | 58/58 tests across 7 suites | outbox/bus/DLQ/idempotency/jobs |
| Phase 1 Regression | **PASS** | included above; `etl.eta` healthy | no ETL duplication introduced |
| Observability | **NOT VERIFIED** | 8 metrics + 5 alerts defined in source | **backend was DOWN at audit time** |
| API/RBAC | **PASS WITH LIMITATION** | 5 ETA routes all `requireRole` | source-verified; live response NOT VERIFIED (backend down) |
| Security | **PASS** | secret scan CLEAN across Phase 2 files | no keys, no private keys |
| Privacy | **PASS** | `partner_hash`/`customer_hash` only; zero raw identifiers to BQ | `hashPii()` at every boundary |
| Production Untouched | **NOT VERIFIED** | no production access from this environment | cannot be independently proven |
| Evidence Reproducibility | **PASS WITH LIMITATION** | report + 2 evidence JSONs + 2 scripts present | predate `4c4ffbf`; do not cover the arrival fix |
| Data Integrity | **PASS WITH LIMITATION** | 0 orphans / 0 missing ts / 0 negative / 0 future | 1 synthetic audit booking contaminates the set — P2-2 |
| Scope Compliance | **PASS** | no ML inference, no agents, no ETA replacement | remains a collection platform |
| Performance | **NOT APPLICABLE** | no Phase 2 SLO defined in repository | not inferred |

---

## Findings

### P1-1 · Arrival provenance never reaches BigQuery — **must fix before ML training**

**Severity:** P1 · **File:** `apps/backend/src/services/eta-intelligence.service.ts:545-605` (`syncToBigQuery`)

The warehouse sync builds each row from an **explicit field list**. `arrivalSource` is in none of them:

```
homigo_analytics_raw.eta_raw               fields=12  arrival_source=NO  quality_score=NO
homigo_analytics_validated.eta_validated   fields=13  arrival_source=NO  quality_score=YES
homigo_analytics_feature.eta_feature       fields=16  arrival_source=NO  quality_score=NO
homigo_analytics_analytics.eta_training    fields=12  arrival_source=NO  quality_score=NO
```

The provenance chain breaks at the warehouse boundary:

```
arrival → event → label → features (Postgres)  ✓
                             → BigQuery         ✗
                             → training dataset ✗
```

**Business impact:** the stated purpose of the provenance work — filtering or weighting by arrival precision at training time — is **not achievable**, because training consumes `eta_training`, which has neither `arrival_source` nor even `quality_score`. A model would silently mix GPS-geofenced and job-start-inferred arrivals as if equally precise.

**Contradiction:** commit `4c4ffbf`'s message states *"label.features → arrivalSource persisted for training-time filtering."* That is accurate for Postgres only and overstates the outcome.

**Blocks freeze?** No — ML training is Phase 3+. **Blocks ML training? Yes.**

**Recommended:** add `arrival_source` (and `quality_score`) to the `eta_feature` / `eta_training` projections, plus the corresponding BigQuery columns. Not done in this pass.

### P1-2 · ETA warehouse tables carry 2.25× duplication

**Severity:** P1 · **File:** `eta-intelligence.service.ts:567-593` — `loadRows(..., WRITE_APPEND)`

```
eta_raw        rows=9  distinct=4  dupes=5
eta_validated  rows=9  distinct=4  dupes=5
eta_feature    rows=9  distinct=4  dupes=5
eta_training   rows=9  distinct=4  dupes=5
postgres       rows=4
```

Postgres is clean (`bookingId @unique`, verified 0 duplicates). Every re-collection re-appends to BigQuery with no MERGE and no dedup view. This is the source of the `dq.eta_duplicate_trip` rule failing on every Phase 1 pipeline run (63 recorded failures, 3 violations each).

Ratio context: `fact_bookings` sits at 1.00×; ETA tables at **2.25×** — materially worse, because labels are re-synced more often than bookings.

**Business impact:** duplicated trips over-weight themselves in any training set built directly from `eta_training`.

**Blocks freeze?** No. **Blocks ML training? Yes.**

### P2-1 · Legacy labels carry no provenance, and absent ≠ gps_geofence

3 of 4 labels have no `arrivalSource` in `features` (they predate `4c4ffbf`). The reader defaults absent → `gps_geofence`, but the **stored data does not**. A training query filtering `arrivalSource = 'gps_geofence'` silently drops all three historical labels.

**Recommended:** backfill explicit provenance, or have training queries treat absent as `gps_geofence` deliberately rather than by accident.

### P2-2 · Audit-artifact contamination in the training set — **created by me**

```
P2VERIFY-* bookings in DB : 1   (P2VERIFY-1786182192225, status IN_PROGRESS, arrivedAt set)
ETA labels from those      : 1   (TRAINING_READY, quality 85)
```

The synthetic booking created by my own runtime verification of `4c4ffbf` produced a **real TRAINING_READY label** that now sits in the dataset and has been synced to BigQuery. It is 1 of only 4 labels — **25% of the current training set is synthetic**.

I did not remove it: this is a read-only audit and deletion is a mutation. It must be removed before any training run.

This also skews the eligibility funnel above (`COLLECTION GAP: −1`), because the booking is `IN_PROGRESS` yet carries a label.

### P2-3 · ETA metrics are not zero-initialised

`metrics-init.ts` contains **0** references to `homigo_eta_*`, so all 8 ETA metrics only appear after first use. The 5 defined ETA alerts (`EtaMissingLabels`, `EtaLabelQualityLow`, `EtaGoogleLatencyHigh`, `EtaTrainingReadinessLow`, `EtaLabelFailureSpike`) cannot fire on an absent series — a silent ETA subsystem is indistinguishable from a broken one.

### P2-4 · ETA dashboard authored but not deployed

`homigo-eta-intelligence.json` exists only in `monitoring/grafana/dashboards/`. The running observability stack mounts `_obsstack/dashboards/`, which does not contain it.

### P3-1 · `rejectionReason` carries flags on non-rejected labels

A `TRAINING_READY` label stores `rejectionReason = "arrival_inferred_from_job_start"`. The field is really "validation flags"; the name misleads anyone reading the table directly. Cosmetic.

---

## NOT VERIFIED

| Item | Reason |
|---|---|
| Live observability (`/metrics`) | **Backend was DOWN** at audit time — no bun process, nothing on :3000. Not restarted: read-only audit. |
| Live API responses / RBAC enforcement | Same. Source-verified only (all 5 routes call `requireRole`). |
| Race / concurrency safety | Proving it requires concurrent mutation. Declined per audit rules. Idempotency guard verified in source. |
| Production status | No production access from this environment. **Never assumed.** |
| Performance | No Phase 2 SLO defined in the repository. Not inferred. |

---

## Verified Strengths

- **Eligibility funnel is honest**: 108 COMPLETED → 3 with `arrivedAt` → collection gap **0**. The collector was never the bottleneck; the lifecycle was, and `4c4ffbf` fixed it at the correct layer.
- **Duration formula enforced exactly**: 0 labels where `stored ≠ (arrival − dispatch)`.
- **Data integrity clean**: 0 orphans, 0 missing timestamps, 0 negative durations, 0 future arrivals.
- **ML inference provably OFF**: `eta_prediction_history` empty, zero BigQuery models named `*eta*`.
- **Privacy correct**: only `partner_hash` / `customer_hash` reach the warehouse; zero raw identifiers.
- **No duplicate infrastructure**: `etl.eta` rides the Phase 1 engine; `recordArrival()` is a single shared implementation used by both arrival signals.
- **Regression clean**: 58/58 across Phase 0, 1 and 2 suites.

---

## Phase 2 Status Lines

```
INFRASTRUCTURE  = PASS
DATA COLLECTION = PASS
DATA QUALITY    = LIMITED   (warehouse duplication + missing provenance + 1 synthetic label)
ML INFERENCE    = OFF
PRODUCTION      = UNKNOWN   (no access; not assumed)
```

**Data maturity:** 4 TRAINING_READY labels against a 50 threshold — **LIMITED, accumulating**. Per the roadmap this is expected and is *not* an architecture failure. With `4c4ffbf`, labels now accrue from every completed booking rather than the prior 2.8%.

---

## Recommendation

**FREEZE PHASE 2 — WITH LIMITATIONS.**

The collection contract is met and no critical defect exists. Freeze is appropriate.

**Phase 3 is authorized to start**, with one hard condition:

> **P1-1, P1-2 and P2-2 must be closed before any ETA model is trained.** Training on today's `eta_training` table would consume a 2.25×-duplicated dataset, blind to arrival precision, 25% of which is synthetic. That is a bad first model, not a bad pipeline — but it would be indistinguishable after the fact.

These are ML-training preconditions, not freeze blockers. Phase 3 work that does not train an ETA model is unaffected.

**Nothing in this audit was modified, migrated, seeded, trained, deployed, or committed.**
