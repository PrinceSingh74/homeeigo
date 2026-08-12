# Enterprise Load Testing Report

**Generated:** 2026-06-26T07:29:07.255Z
**Base URL:** http://localhost:3000

## k6 Results

| Stage | Scenario | P50 | P95 | P99 | Error rate | HTTP fail | Pass |
|-------|----------|-----|-----|-----|------------|-----------|------|
| 100 | booking | 0 | 957.53 | 99999 | 0 | 0.25 | ❌ |
| 100 | wallet | 0 | 1843.71 | 99999 | 0 | 0 | ❌ |
| 100 | payment | 0 | 10641.46 | 99999 | 0 | 0.33 | ❌ |
| 500 | booking | 0 | 5809.28 | 99999 | 0 | 0.25 | ❌ |
| 500 | wallet | 0 | 4291.26 | 99999 | 0 | 0 | ❌ |
| 500 | payment | 0 | 5022.56 | 99999 | 0 | 0.33 | ❌ |

## Database probe

- Ungranted locks: **0**
- Probe duration: 3747ms

## Targets

- P95 < 500ms, P99 < 1200ms, error < 1%, HTTP 5xx = 0

## Verdict

**PARTIAL** — saturation or infra limits on higher VU (see evidence)
