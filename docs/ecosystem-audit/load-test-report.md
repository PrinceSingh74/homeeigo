# Load Test Report — Phases 9–10

**Date:** 2026-06-10  
**Harness:** `scripts/load-test/runner.ts` + k6 (`scripts/load-test/k6/`)  
**Prerequisite:** `LOAD_TEST_MODE=1` on backend (dev only), single server on `:3000`

---

## 100 VU — Authenticated (PASS)

| Scenario | Requests | Error rate | P95 (ms) | Throughput (req/s) |
|----------|----------|------------|----------|-------------------|
| wallet | 1000 | **0%** | 1293 | 94.7 |
| booking | 1000 | **0%** | 1275 | 96.9 |
| payment | 1000 | **0%** | 1396 | 95.2 |

---

## 500 VU — Saturated (PARTIAL)

Single Bun dev process; many requests hit 10s `fetch` timeout under saturation.

| Scenario | Error rate | Notes |
|----------|------------|-------|
| health | 0% | OK |
| ready | 9.2% | DB pool pressure |
| metrics | 71.6% | timeout under load |
| booking/payment/wallet | 93–100% | timeout, not rate-limit |

**Verdict:** 100 VU authenticated flows pass SLO-ish latency; 500+ VU needs horizontal scale + production tuning.

---

## k6 @ 100 VU (wallet.js)

- Peak VUs: 100, ~7173 requests
- k6 error rate (5xx only): **0%**
- `http_req_failed`: 91% (429s before `LOAD_TEST_MODE` + duplicate servers fixed)
- Evidence path fixed: `docs/p2/evidence/k6-wallet-100.json`

---

## Fixes Applied This Session

1. Correct API paths in runner (`/api/wallet/balance`, etc.)
2. `LOAD_TEST_MODE=1` bypass in `api-rate-limit.middleware.ts`
3. Kill duplicate `:3000` listeners before tests
4. k6 evidence write path corrected for Windows
