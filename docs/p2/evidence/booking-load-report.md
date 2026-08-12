# Evidence — Booking Load Test Report

**Generated:** 2026-06-08T17:46:00Z  
**Tool:** `scripts/load-test/runner.ts` (k6 **NOT INSTALLED** — fallback runner used)  
**Target:** `http://localhost:3000`  
**Verdict:** 🟡 **PARTIAL** — infra endpoints pass; domain booking scenario **FAIL**

> **Honest limitation:** The built-in runner hits `/api/v1/status` for the `booking`
> scenario label — not real booking CRUD flows. k6 scripts with authenticated flows
> exist but were not executed (k6 missing). Results below are **real measured
> output**, not fabricated.

## Results by Concurrency

### 100 concurrent workers × 5 requests = 500 req/scenario

| Scenario | p95 (ms) | p99 (ms) | Error rate | Throughput (rps) | Verdict |
|---|--:|--:|--:|--:|:--:|
| health | 145 | 186 | 0% | 1623 | ✅ PASS |
| ready | 66 | 67 | 0% | 2304 | ✅ PASS |
| metrics | 64 | 64 | 0% | 2203 | ✅ PASS |
| booking (`/api/v1/status`) | 69 | 69 | **99.6%** | 1786 | ❌ FAIL |
| websocket (`/api/v1/ws/stats`) | 322 | 322 | **100%** | 708 | ❌ FAIL |
| **Summary avgP95** | **121.6** | — | maxErrorRate **100%** | — | ❌ |

### 500 concurrent

| Scenario | p95 (ms) | Error rate |
|---|--:|--:|
| health | 214 | 0% ✅ |
| ready | 187 | 0% ✅ |
| metrics | 172 | 0% ✅ |
| booking | 238 | **100%** ❌ |
| **avgP95** | **204.3** | maxErrorRate **100%** |

### 1000 concurrent

| Scenario | p95 (ms) | Error rate |
|---|--:|--:|
| health | 414 | 0% ✅ |
| ready | 411 | 0% ✅ |
| metrics | 249 | 0% ✅ |
| booking | 423 | **99.28%** ❌ |
| **avgP95** | **391.6** | maxErrorRate **100%** |

## Capacity Estimate (infra endpoints only)

At 1000 VUs, health/ready/metrics sustain **~2800–4400 rps** with p95 ≤ 414 ms and 0% errors. This proves the API process handles concurrent load on liveness endpoints; **booking flow capacity is NOT VERIFIED**.

## Post-load side effect (real)

After load + pentest, auth endpoints returned `429 RATE_LIMIT_EXCEEDED` — rate limiting is **actively enforcing** under burst (evidence for pentest RL-1 ✅).

## Required to PASS booking load test

1. Install k6
2. Run `k6 run -e STAGE=1000 -e LOGIN_EMAIL=… -e LOGIN_PASSWORD=… scripts/load-test/k6/booking.js`
3. Or fix runner to hit `/api/services`, `/api/bookings` with auth tokens
