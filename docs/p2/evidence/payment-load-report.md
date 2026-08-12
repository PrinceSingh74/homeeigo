# Evidence — Payment Load Test Report

**Generated:** 2026-06-08T17:46:00Z  
**Environment:** Local dev (Razorpay keys unset — mock mode)  
**Verdict:** ❌ **FAIL** (load runner) · 🟡 **PARTIAL** (security probes)

## Load Test Results (`runner.ts` — payment scenario → `/api/v1/status`)

| Concurrency | p95 (ms) | p99 (ms) | Error rate | Throughput |
|---|--:|--:|--:|--:|
| 100 | 89 | 114 | **100%** | 1445 rps |
| 500 | 215 | 247 | **100%** | 2510 rps |
| 1000 | 420 | 442 | **100%** | 2856 rps |

**Not a real payment load test** — endpoint under test returns errors at scale. Sandbox Razorpay order creation / webhook processing **NOT EXECUTED** (no `ALLOW_WRITES`, no k6).

## Security Probes (live API — from pentest run)

| Test | Result | Evidence |
|---|:--:|---|
| Webhook without signature | ❌ **VULNERABLE** | Returns **503** instead of 4xx rejection |
| Webhook bad signature | ❌ **VULNERABLE** | Returns **503** instead of 4xx rejection |
| Auth rate limit under burst | ✅ SECURE | 25 rapid logins → `429` observed |
| JWT tampering | ✅ SECURE | alg=none → 401; bad signature → 401 |

## Duplicate / Race Protection

| Check | Status | Evidence |
|---|:--:|---|
| Concurrent payment attempts (load) | ⚪ NOT VERIFIED | No real payment orders created |
| Webhook idempotency | ⚪ NOT VERIFIED | No webhook secret configured |
| Refund race (unit tests) | ✅ (code) | `p0-financial-races.test.ts` exists — not re-run this session |

## Required to PASS

1. Configure `RAZORPAY_KEY_ID/SECRET` + `RAZORPAY_WEBHOOK_SECRET` in staging
2. Run k6 `payment.js` with `ALLOW_WRITES=1` and `BOOKING_ID`
3. Fix webhook handler to return 401/400 on missing/invalid signature (currently 503)
