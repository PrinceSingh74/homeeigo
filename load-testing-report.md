# Load Testing Report

**Generated:** 2026-09-21T07:18:30.873Z  
**Environment:** Single Bun backend on localhost:3000 (development)  
**Auth:** customer@homigo.demo

## Results (runtime)

| Users (concurrent VUs) | Scenario | P50 (ms) | P95 (ms) | P99 (ms) | Error % | Verdict |
|---------------------:|----------|---------:|---------:|---------:|--------:|---------|
| 100 | /health | 246 | 516 | 518 | 0 | **PASS** |
| 100 | /api/bookings/upcoming | 457 | 750 | 790 | 0 | **PASS** |
| 1000 | /health | 756 | 1225 | 1232 | 0 | PASS |
| 5000 | — | — | — | — | — | **NOT RUN** (exceeds local dev capacity) |
| 10000 | — | — | — | — | — | **NOT RUN** |
| 50000 | — | — | — | — | — | **NOT RUN** |
| 100000 | — | — | — | — | — | **NOT RUN** |

## Database (runtime)

| Metric | Value |
|--------|------:|
| Pool connections | 32 |
| Idle | 31 |
| Active | 1 |
| Long idle-in-txn | 0 |

## Redis (runtime)

| Metric | Value |
|--------|-------|
| Status | healthy |
| Latency | 3ms |

## Honest Scalability Assessment

| Target | Certified? | Evidence |
|--------|------------|----------|
| 1,000 daily active users | **YES** | 100 VU @ 0% error, booking p95=750ms |
| 10,000 concurrent users | **NO** | 1000 VU shows 0% errors on single instance |
| 100,000 users | **NO** | Not tested; requires K8s HPA + Redis cluster per deploy/k8s/ |

**Note:** WebSocket load test in runner hits HTTP /api/v1/ws/stats — not real WS fanout. Use k6 WS scripts for WS certification.
