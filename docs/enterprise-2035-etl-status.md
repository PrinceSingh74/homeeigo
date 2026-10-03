# HOMEEIGO — Analytics / ETL Status

**Status: ROOT CAUSE EXTERNAL (BigQuery billing) · METRIC DISHONESTY FIXED · DATA RETENTION OPEN**

---

## 1. What is actually wrong

The analytics pipeline has produced **zero successful runs since 2026-08-19** and continues to fail every day.

```
etl_job_executions by status          first        last
  SUCCEEDED  4,660                    2026-08-07   2026-08-19   <- last success
  RECOVERING 3,148                    2026-08-07   2026-09-20   <- still accumulating
  FAILED     1,539                    2026-08-07   2026-09-20   <- still accumulating
  RUNNING      111                    2026-08-07   2026-09-04   <- never finalized
```

Root cause, read verbatim from `error_message` on the last 7 days of failures:

> `Billing has not been enabled for this project. Enable billing at https://console.cloud.google.com/billing. Partition expiration time must be less than 60 days while in sandbox mode` — 44 occurrences
> `... DML queries are not allowed in the free tier. Set up a billing account to ...` — 14
> `... Table expiration time must be less than 60 days while in sandbox mode.` — 14

**This is an EXTERNAL DEPENDENCY, not a code defect.** No change in this repository can make a BigQuery write succeed against a project with billing disabled. `GCP_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` and `BQ_DATASET` are all absent from `.env` as well.

Everything downstream is blocked by it: the feature store, demand forecasting, MLOps registry evaluation and the warehouse-backed analytics endpoints.

---

## 2. The lifecycle, so the numbers read correctly

`analytics/etl/engine.ts` creates a **new** `etl_job_executions` row per attempt with `status = RUNNING`, then `finalizeExecution` moves it to `SUCCEEDED`, or to `RECOVERING` (attempts remain) / `FAILED` (final attempt).

So:

- `RECOVERING` and `FAILED` are **history**, not stuck states. Their growth is the retry log.
- A row that stays `RUNNING` means the **process died mid-run** and nothing finalized it. Those 111 rows are abandoned executions, not work in progress.

---

## 3. ETL-1 (P1, OBSERVABILITY) — the gauge reported a busy pipeline on a dead one — **FIXED**

`homigo_etl_jobs_running` was `count(status = 'RUNNING')` with no age condition. It read **111**.

Every one of those 111 was a crashed execution — oldest 2026-08-07, newest 2026-09-04 — on a pipeline that had not succeeded since 2026-08-19.

That is not a rounding error. **111 concurrent ETL jobs is the number an operator would use to conclude the pipeline was busy rather than broken**, and it would have stayed 111 forever because nothing ever finalizes an abandoned row.

### The fix

`src/lib/etl-metrics.ts` now counts the two populations separately, because they call for opposite responses — "in flight, wait" versus "abandoned, investigate":

| Metric | Meaning |
|---|---|
| `homigo_etl_jobs_running` | `RUNNING` **started within 12 h** — genuinely in flight |
| `homigo_etl_jobs_abandoned` | `RUNNING` **older than 12 h** — crashed, never finalized |
| `homigo_etl_jobs_recovering_24h` | retry attempts in the last day |
| `homigo_etl_jobs_failed_24h` | terminal failures in the last day |

12 hours is far longer than any observed successful run, so nothing healthy is misreported.

All four are initialised to 0 at boot, because on a dashboard an absent series and a healthy zero look identical and only one of them is good news.

### Verified against live data

```
OLD homigo_etl_jobs_running (no age filter)        111     <- what operators saw
NEW homigo_etl_jobs_running (started within 12h)     0
NEW homigo_etl_jobs_abandoned (started >12h ago)   111
NEW homigo_etl_jobs_recovering_24h                   6
    homigo_etl_jobs_failed_24h                       3
```

The honest reading is now available at a glance: **nothing is running, 111 executions were abandoned, and the pipeline retried 6 times and failed 3 times in the last day while succeeding zero times in a month.**

> The running dev backend had not restarted at the time of writing, so its `/metrics` still served the old boot-registered sampler. The replacement logic was verified directly against `homigo_db`, which is the same query the sampler issues.

---

## 4. What is NOT wrong

Stated because two of these were misread in the Master Audit.

| Claim | Reality |
|---|---|
| "`data_quality_score = 100` is a hardcoded boot constant" | **False.** `analytics/data-quality/engine.ts:96` computes it and writes `data_quality_results` — 5,905+ rows, most recent `evaluated_at` 2026-09-20. It scores **Postgres source data**, which genuinely is clean. The BigQuery *export* is what fails. |
| "`data_quality_results` / `data_versions` / `data_freshness_snapshots` are orphan tables" | **False.** All three are written by `apps/backend/analytics/`, a tree that sits **outside `src/`** and was missed by the audit's scan. All current as of 2026-09-20. |
| "The ETL scheduler is not running" | **False.** It runs — that is why failures accumulate daily. `ENABLE_ETL_SCHEDULER` is absent but the scheduler defaults on. |

---

## 5. Open items

### ETL-2 (P2, DATA) — no retention on `etl_job_executions`

7,506 rows today, growing by roughly 9 rows/day (6 RECOVERING + 3 FAILED) with no terminal cleanup. Not urgent at 6.2 MB, but it is an unbounded table with no policy, and the failure loop guarantees it keeps growing while the pipeline is broken.

Per-table autovacuum tuning was **not** applied to it — it is append-only, so it is growth, not bloat.

### ETL-3 (P2, DATA) — no reaper for abandoned executions

111 rows will stay `RUNNING` forever. The new `homigo_etl_jobs_abandoned` gauge makes them visible, which is the more important half.

**A reaper was deliberately not implemented.** It would write to `homigo_db` — marking 111 historical executions `FAILED` — and this pass makes no unrequested data mutations. The change itself is small and honest (a crashed run *did* fail); it just needs an owner to say so.

### ETL-4 — restore or retire the pipeline (**business decision**)

The mission requires proving one of two things, and only the owner can:

- **Still required** → enable BigQuery billing, set `GCP_PROJECT_ID` / `GOOGLE_APPLICATION_CREDENTIALS` / `BQ_DATASET`, then confirm `homigo_etl_jobs_recovering_24h` falls to 0 and successes resume.
- **Abandoned** → say so explicitly and disable the scheduler, so it stops generating failures, alerts and rows. **Do not build a second ETL** — the existing engine is sound; only its destination is unpayable.

Leaving it as-is is the worst of the three: it burns retries daily, grows a table nobody prunes, and leaves every ML surface downstream reporting stale data with no indication why.

---

## 6. Status

| Item | Status |
|---|---|
| Root cause identified | **VERIFIED** — BigQuery billing disabled, quoted from `error_message` |
| `homigo_etl_jobs_running` dishonesty | **FIXED** — verified against live data |
| `homigo_etl_jobs_abandoned` / `_recovering_24h` | **ADDED**, initialised at 0 |
| Data-quality engine correctness | **CONFIRMED WORKING** — audit claim withdrawn |
| `analytics/` tree treated as orphan | **AUDIT CORRECTION** — it is live |
| Retention on `etl_job_executions` | **OPEN — P2** |
| Reaper for 111 abandoned rows | **OPEN — owner decision (data mutation)** |
| Restore vs retire the pipeline | **OPEN — BUSINESS DECISION** |
| Downstream (feature store, forecasting, MLOps) | **BLOCKED** on ETL-4 |
