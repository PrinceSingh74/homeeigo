# HOMIGO Enterprise Security Certification (PHASE 7)

**Date:** 2026-06-18 · **Method:** live attack probes against the running backend + code verification. Every row executed.

## Results

| Control | Test (executed) | Result | Verdict |
|---------|-----------------|--------|---------|
| **RBAC** | customer token → `/api/admin/dashboard`, `/users`, `/finance/dashboard` | **403** (all) | ✅ |
| RBAC | partner token → `/api/admin/dashboard` | **403** | ✅ |
| RBAC | customer token → `/api/v1/ws/stats` (admin-only) | **403** | ✅ |
| **Auth / JWT** | no token → `/api/wallet/balance` | **401** | ✅ |
| Auth / JWT | malformed token | **401** | ✅ |
| Auth / JWT | **valid token w/ tampered signature** | **401** | ✅ (signature verified) |
| **IDOR** | customer → `/api/admin/bookings/<uuid>` (cross-tenant) | **403** | ✅ |
| **SQL injection** | `?limit=5';DROP TABLE users;--` and `?search=' OR 1=1--` | **200, handled safely** | ✅ |
| SQL injection | `users` table after attempts | **still exists** | ✅ (Prisma parameterizes) |
| **Rate limiting** | 60 anon reqs vs `/api/services` (limit 30×1.2=36/min) | **25× 429 + 35× 200** | ✅ ENFORCED |
| Rate limiting | response headers | `X-RateLimit-Limit: 36`, `Remaining` decrements, `Retry-After` | ✅ |
| Rate limiting | login-fail limiter | Redis key `ratelimit:login-fail-email:…` recorded 60 failed logins | ✅ active |
| **Webhook verify** | `POST /api/payments/webhook` w/ bad signature | **401 rejected** | ✅ |
| **Security headers** | `/health` response | CSP `default-src 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection`, `Referrer-Policy` | ✅ |

## Code-verified controls
- **Webhook signature**: `razorpay.service.ts:verifyWebhookSignature` = HMAC-SHA256(`WEBHOOK_SECRET`)
  compared with **`crypto.timingSafeEqual`** (constant-time, anti-timing-attack). Route
  `payments.ts:68` rejects on mismatch.
- **Rate-limit tiers**: global (admin 200 / auth 100 / anon 30 per min, +20% burst, **per-user**
  keying so NAT'd users aren't collectively throttled), payments `create-order` 10/hr,
  search 100/min, login IP+email fail limits, OAuth + register limits. Redis-backed
  (`consumeRateLimitSmart`) with in-memory fallback. Standard `X-RateLimit-*` headers.
- **PII / secrets**: `pii-crypto.ts` HMAC pepper + field encryption; JWT via `JWTService`.

## 🟠 Real finding (not faked)
**`.env` ships `LOAD_TEST_MODE=1`**, and `api-rate-limit.middleware.ts:45` **bypasses the global
rate limiter** whenever `LOAD_TEST_MODE=1` (in non-prod). This is correct for load testing but
**must never be set in normal dev/staging** — while set, the global API limiter is OFF (login/
payment/search limiters still apply). The 429 proof above required temporarily setting
`LOAD_TEST_MODE=0`. **Recommendation:** remove `LOAD_TEST_MODE` from the committed `.env`
default; set it only for explicit load-test runs. The production guard (`NODE_ENV !== "production"`)
already prevents bypass in prod — verified in code.

## Verdict
**PASS** — RBAC, JWT/auth, IDOR, SQL-injection resistance, rate limiting (429 proven), webhook
HMAC verification, and security headers are all **execution-verified**. One config-hygiene finding
(`LOAD_TEST_MODE` in `.env`) logged with a fix. No injection succeeded; no auth bypass; no RBAC leak.
