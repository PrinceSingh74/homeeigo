# Load Testing Report

**Generated:** 2026-07-03T10:36:40.616Z  
**Environment:** Single Bun backend on localhost:3000 (development)  
**Auth:** customer@homigo.demo

## Results (runtime)

| Users (concurrent VUs) | Scenario | P50 (ms) | P95 (ms) | P99 (ms) | Error % | Verdict |
|---------------------:|----------|---------:|---------:|---------:|--------:|---------|
| 100 | /health | 209 | 422 | 422 | 0 | **PASS** |
| 100 | /api/bookings/upcoming | 988 | 1624 | 1959 | 0 | **PASS** |
| 1000 | /health | 1905 | 2940 | 3182 | 0 | PASS |
| 5000 | — | — | — | — | — | **NOT RUN** (exceeds local dev capacity) |
| 10000 | — | — | — | — | — | **NOT RUN** |
| 50000 | — | — | — | — | — | **NOT RUN** |
| 100000 | — | — | — | — | — | **NOT RUN** |

## Database (runtime)

| Metric | Value |
|--------|------:|
| Pool connections | 16 |
| Idle | 15 |
| Active | 1 |
| Long idle-in-txn | 0 |

## Redis (runtime)

| Metric | Value |
|--------|-------|
| Status | healthy |
| Latency | 10ms |

## Honest Scalability Assessment

| Target | Certified? | Evidence |
|--------|------------|----------|
| 1,000 daily active users | **YES** | 100 VU @ 0% error, booking p95=1624ms |
| 10,000 concurrent users | **NO** | 1000 VU shows 0% errors on single instance |
| 100,000 users | **NO** | Not tested; requires K8s HPA + Redis cluster per deploy/k8s/ |

**Note:** WebSocket load test in runner hits HTTP /api/v1/ws/stats — not real WS fanout. Use k6 WS scripts for WS certification.
