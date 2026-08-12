# P2 — Load Test Evidence (Phase 3)

**Date:** 2026-06-08 · **Tool:** k6 v2.0.0 (installed via winget) · **Script:** `scripts/load/health-load.js` · **Target:** single backend instance (Bun/Elysia) + Postgres in Docker Desktop, one host.

## What was tested — and why this endpoint
`GET /health` runs `SELECT 1` + a Redis check, so it exercises the real **server + Prisma/Postgres connection pool** end-to-end. It is unauthenticated and not rate-limited, so a single host can drive true concurrency without 429 noise.

**Why not booking/payment/wallet directly:** those are authenticated and **per-user rate-limited by design** (~120 req/min/user; `/api/*` also IP-limited). From a single host with one token, a 1000-VU run would be dominated by intentional 429s — not a representative capacity result. A faithful write-path load test needs many seeded users + a non-laptop target; that is called out as the remaining gap, not faked here.

## Results (ramping VUs, ~35s each)
| VUs | requests | throughput | avg | p95 | p99 | max | error rate |
|---|---|---|---|---|---|---|---|
| 100 | 123,449 | 3,526 rps | 22 ms | **41 ms** | 63 ms | 148 ms | **0.00%** |
| 500 | 175,350 | 5,010 rps | 78 ms | **145 ms** | 160 ms | 243 ms | **0.00%** |
| 1000 | 175,231 | 5,006 rps | 157 ms | **325 ms** | 363 ms | 541 ms | **0.00%** |

Thresholds (`p95<500ms`, `p99<1000ms`, `error<1%`) **passed at every tier**. 100% of checks (`status 200` + `"database":"ok"`) succeeded.

## Interpretation
- Throughput plateaus ~**5,000 rps** beyond 500 VU (single-host ceiling); latency grows **gracefully** with no errors — healthy back-pressure, no pool exhaustion or crashes through 1000 VU.
- The DB connection pool sustains 1000 concurrent clients at p95 = 325 ms with zero failures.

## Status
**PASS (read/DB path, error rate 0% ≪ 1%)** with a documented caveat: authenticated **write-path** (booking/payment/wallet) load at 1000 VU requires multi-user seeding + a representative (non-laptop) environment. Harness is in place (`scripts/load/`) to run those once such an environment is available.
