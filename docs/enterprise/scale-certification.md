# Phase E — Scale Validation (k6)

**Date:** 2026-06-10  
**Evidence:** `docs/enterprise/load-evidence.json`  
**Verdict:** **FAIL** — P95 SLO not met on dev single-node Bun process

---

## Executed stages

| Stage | Scenario | P95 (ms) | Error % | HTTP 5xx % | Pass (P95 < 500ms, err < 1%) |
|-------|----------|----------|---------|------------|------------------------------|
| 100 | booking | 6312 | 0 | 0.25 | FAIL |
| 100 | wallet | 1916 | 0 | 0 | FAIL |
| 100 | payment | 1155 | 0 | 0.33 | FAIL |
| 500 | booking | 4091 | 0 | 0.25 | FAIL |
| 500 | wallet | 5225 | 0 | 0 | FAIL |
| 500 | payment | — | 0 | 0 | FAIL (0 requests — runner OOM exit 9) |

---

## NOT executed

- 1000 VU
- 2000 VU
- Admin / provider k6 scenarios in full matrix
- CPU / memory / Redis pool metrics under sustained load (runner crashed)

---

## Root cause (execution-bound)

Single Bun dev server on Windows host saturated; backend exited with code 9 (memory) during payment@100 stage in a later run.

---

## Classification

**NOT READY** for production scale. Re-run on scaled infra (≥2 API replicas, tuned PG pool, production build).
