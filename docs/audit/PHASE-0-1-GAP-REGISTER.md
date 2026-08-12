# Phase 0 + Phase 1 — Gap Register

**HEAD:** `34cdc5a` · **Date:** 2026-08-08 · **Mode:** read-only — no gap below was fixed in this pass.

**P0 count: 0.** Neither phase carries a blocker that can lose events, duplicate financial effects, corrupt data, bypass security, break a migration, or leave an active invalid producer.

---

## P0 — Critical Blockers

**None.**

Explicitly checked and cleared:

| P0 risk | Finding |
|---|---|
| Lost events | 0 PENDING, 0 stuck; live event published in 1 attempt |
| Duplicate financial effects | 925 consumer receipts; unique `eventId`; no dupes on live test |
| Corrupted data | warehouse 296 rows vs 295 source, ratio 1.00; DQ avg score 99.54 |
| Security bypass | analytics RBAC enforced; PII hashed; no secrets in events |
| Broken deployment | HEAD self-consistent; Phase 0/1 fully tracked; `prisma validate` clean |
| Unrecoverable DLQ | DLQ writes proven from both consumer and publisher paths |
| Broken migrations | `event_foundation` + `phase1_ml_data_platform` tracked; no DROP |
| Active invalid producer | zero in 24h+ (see disclosure below) |
| ETL data corruption | no schema drift; `updated_at` present; partitioned + clustered |

---

## P1 — Important, Non-Blocking

### P1-A · Lazily-registered metrics create NO-DATA gaps
**Phase:** 0 and 1
**Problem:** Four metric series only appear on `/metrics` after their first observation:
`homigo_outbox_processing_duration_seconds`, `homigo_scheduled_job_executions_total`,
`homigo_forecast_runtime_seconds`, `homigo_feature_generation_total`.
**Impact:** Prometheus cannot alert on a series that does not exist. A subsystem that has never run looks identical to one that is broken — the exact failure mode `metrics-init.ts` was written to prevent for other metrics.
**Evidence:** `/metrics` scrape (102,124 bytes) — the four names are absent while their siblings are present.
**Root cause:** `metrics-init.ts` zero-initialises `homigo_scheduled_jobs_pending` and `homigo_scheduled_job_lag_seconds` but not these four.
**Recommended:** add zero-initialisation alongside the existing entries.
**Complexity:** Low.

### P1-B · ETL executions orphaned in `RUNNING`
**Phase:** 1
**Problem:** 46 `etlJobExecution` rows sit in `RUNNING`; **6 are older than 1h** (oldest 24.4h). Distribution: `etl.dimensions` 19, `etl.audit` 15, `etl.aggregates` 11, `etl.payment` 1.
**Impact:** Audit-trail hygiene, **not data loss** — watermarks are the real recovery mechanism and are healthy (0 inverted, 0 stale). But execution-status dashboards and any "is ETL healthy" query are skewed by permanently-RUNNING rows.
**Root cause:** unlike the outbox, which has `recoverStaleClaims()` lease expiry, `etlJobExecution` has no sweeper. A crashed or timed-out run leaves its row RUNNING forever.
**Recommended:** a lease-recovery sweeper mirroring `recoverStaleClaims()`, finalising stale RUNNING rows to FAILED or RECOVERING.
**Complexity:** Low.

### P1-C · Append-mode duplicates accumulate unaddressed
**Phase:** 1
**Problem:** Incremental ETL uses `WRITE_APPEND`, so an updated source row is re-appended rather than merged. The DQ engine correctly flags this on **every run** — `dq.duplicate_booking` (57 failures), `dq.duplicate_payment` (56), `dq.eta_duplicate_trip` (63) — and nothing deduplicates.
**Impact:** Currently trivial (1 duplicate in 296 rows; ratio 1.00) but **monotonic**. Downstream consumers reading `fact_bookings` directly will double-count unless they dedupe by `booking_id` + latest `updated_at`.
**Evidence:** 169 failing DQ checks in the last 24h, each with the repair suggestion *"Deduplicate by booking_id using latest updated_at"*.
**Recommended:** either a MERGE-based load strategy, or deduplicating views over the fact tables so consumers cannot read duplicates.
**Complexity:** Medium.

---

## P2 — Medium

### P2-A · Training-data version awareness unexercised
**Phase:** 1 · `dataVersion` holds 64 `pipeline` and 9 `feature` rows but **0 `training`** and **0 `dataset`**. `featureStore.exportTrainingDataset()` creates them and has never been invoked. Consequence: the roadmap's required lineage — source → transformation → feature version → training version → model — cannot be demonstrated end-to-end today. *Complexity: Low (exercise the path).*

### P2-B · Model metric applicability is narrower than the roadmap list
**Phase:** 1 · `ML.EVALUATE` on ARIMA_PLUS returns time-series diagnostics (`non_seasonal_p/d/q`, seasonal periods, AIC, variance) — **not** MAE/RMSE/MAPE and **not** Precision/Recall/F1/AUC. Those are not applicable to ARIMA_PLUS as exposed by BigQuery ML; claiming them would be fabrication. Recorded as a documentation gap, not a defect. *Complexity: Low (document per-model applicability).*

### P2-C · Three use cases PARTIAL, one NOT_VERIFIED
**Phase:** 1 · Partner Demand, Surge and Earnings have models and APIs but their data paths to consuming surfaces were not traced. Digital Twin is NOT_VERIFIED. *Complexity: Medium (trace and evidence each path).*

### P2-D · 6 stale `eta.*` outbox rows
**Phase:** 0 · Terminal FAILED, never dead-lettered because they predate the publisher→DLQ wiring. **Inert** — attempts frozen at ~7175, last touched 97 minutes before this audit, confirming the `f58be06` re-claim fix holds. Disposition deferred by prior decision. *Complexity: Low.*

---

## P3 — Nice-to-have

| ID | Gap | Phase |
|---|---|---|
| P3-A | No per-aggregate event ordering guarantee — claims use global `created_at ASC`. Acceptable for current consumers; would matter for strict per-booking sequencing. | 0 |

---

## NOT_VERIFIED — recorded honestly, neither pass nor fail

| Item | Why |
|---|---|
| Performance / latency / P95 / P99 / throughput | No benchmark run in this read-only pass. No SLO compliance is claimed. |
| Digital Twin data path | Admin page exists; forecast→twin flow not traced. |
| Alert notification delivery | Rules exist and were counted; Alertmanager delivery not exercised. |
| Full concurrent-ETL safety under load | Leader lock verified structurally; not load-tested. |

---

## Audit Artifacts — disclosure

Left in place deliberately; the standing rule forbids deleting outbox rows.

| Artifact | Origin |
|---|---|
| 1 `dlqtest.invalid.namespace` outbox row (FAILED, attempts 5) | Seeded by me earlier to prove the publisher→DLQ path. **This is the sole invalid-namespace row created in the last 6h** — it is an audit fixture, not an application producer. |
| 1 unresolved `EventDeadLetter` entry | Produced by the above; it is the evidence that the DLQ path works. |
| 1 `cert-p0-*` synthetic `booking.created` outbox row (PUBLISHED) | This pass's live-chain verification. |
| Small number of PUBLISHED `homigo.eta.*` rows | Earlier verification runs; ages out under 14-day published retention. |

Removing them would require deleting outbox rows, which is prohibited. Say the word and I can remove the two `dlqtest`/synthetic fixtures specifically.

---

## Remediation Priority

| # | Item | Priority | Complexity | Blocks freeze? |
|---|---|---|---|---|
| 1 | P1-A — zero-initialise 4 metrics | P1 | Low | No |
| 2 | P1-B — ETL execution lease sweeper | P1 | Low | No |
| 3 | P1-C — dedupe strategy for append-mode facts | P1 | Medium | No |
| 4 | P2-A — exercise training-version path | P2 | Low | No |
| 5 | P2-B — document per-model metric applicability | P2 | Low | No |
| 6 | P2-C — trace the four use-case data paths | P2 | Medium | No |
| 7 | Performance benchmark | — | Medium | No |

**Nothing in this register blocks freezing Phase 0 or Phase 1.**
