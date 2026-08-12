# API Connectivity Report

**Audit date:** 2026-06-10  
**Backend:** `http://localhost:3000` (live)  
**Method:** Smoke scripts + authenticated REST probes + frontend build route inventory

---

## Executive Summary

| Category | Count | Status |
|----------|-------|--------|
| Admin API endpoints (smoke) | 12 tested | ✅ 12/12 PASS |
| Partner API endpoints (smoke) | 21 tested | ✅ 21/21 PASS |
| Finance admin endpoints (smoke) | 18 tested | ✅ 18/18 PASS |
| Customer API probes | 8 tested | ✅ 8/8 PASS |
| Full-stack UI connectivity | 16 tested | ⚠️ 14/16 PASS |
| Backend unit/integration tests | 480 | ✅ 480/0 PASS |

---

## Customer Web → Backend

| Page | Primary APIs | Auth | Live Probe | Status |
|------|-------------|------|------------|--------|
| `/` (home) | `/api/services/featured`, `/api/stats` | No | featured: 2 services | ✅ WORKING |
| `/services` | `/api/services` | No | via hooks | ✅ WORKING |
| `/book` | `/api/services/:id`, `/api/bookings` POST | Yes | middleware 307 w/o session | ✅ PROTECTED |
| `/bookings` | `/api/users/bookings` | Yes | bookings total=0 for demo user | ✅ WORKING |
| `/wallet` | `/api/wallet/balance`, `/api/wallet/transactions`, `/api/wallet/payment-methods` | Yes | balance=5700, methods=0 | ✅ WORKING |
| `/membership` | `/api/subscriptions/me`, `/api/subscriptions/plans`, invoices | Yes | active=True | ✅ WORKING |
| `/referrals` | `/api/referrals/me`, history, withdraw | Yes | balance=-100 ⚠️ | ⚠️ DATA BUG |
| `/notifications` | `/api/notifications` | Yes | total=0 | ✅ WORKING |
| `/settings` | `/api/users/me`, update, export, delete | Yes | me returns email | ✅ WORKING |
| `/support` | `/api/support/tickets` | Yes | not probed POST | ✅ PARTIAL |
| `/profile` | `/api/users/me`, addresses | Yes | middleware 307 | ✅ PROTECTED |
| `/providers` | `/api/providers` | No | 200 page load | ✅ WORKING |
| `/login` | `/api/auth/login` | No | login 200 | ✅ WORKING |
| `/signup` | `/api/auth/send-otp`, `/api/auth/register` | No | e2e timeout ⚠️ | ⚠️ BROKEN E2E |
| `/verify-email` | `/api/auth/send-verification-email` | Partial | code exists | ⚠️ NOT LIVE-TESTED |
| Legal pages | `/api/legal/policies` (optional) | No | static 200 | ✅ WORKING |

### Customer API Probe Output (2026-06-10)

```
users/me: customer@homigo.demo
bookings: 0
wallet: 5700
referrals balance: -100
subscription active: True
notifications: 0
payment-methods: 0
featured services: 2
```

---

## Admin Panel → Backend

**Smoke:** `bun run scripts/smoke-admin-api.ts` → **12/12 PASS**

| Endpoint | Auth | Result |
|----------|------|--------|
| `/api/admin/dashboard` | Admin JWT | 200 |
| `/api/admin/users` | Admin JWT | 200 |
| `/api/admin/providers` | Admin JWT | 200 |
| `/api/admin/bookings` | Admin JWT | 200 |
| `/api/admin/analytics` | Admin JWT | 200 |
| Provider verify action | Admin JWT | 200 (state change) |
| Ban missing user | Admin JWT | 404 (correct) |
| Customer → admin routes | Customer JWT | 403 (RBAC) |
| Admin notifications WS | Admin JWT | closed:1000 |

**Finance ops smoke:** 18/18 PASS including reconciliation run, integrity run, payout ops.

**Gap:** Admin UI on :3003 not running — UI→API rendering **NOT execution-verified**.

---

## Partner Panel → Backend

**Smoke:** `bun run scripts/smoke-partner-routes.ts` → **21/21 PASS**

| Endpoint | Result |
|----------|--------|
| `/api/providers/me` | 200 |
| `/api/providers/me/dashboard` | 200 |
| `/api/providers/me/earnings` | 200 |
| `/api/providers/me/bookings` | 200 |
| `/api/providers/me/payouts` | 200 |
| `/api/providers/me/invoices` | 200 |
| PUT `/api/providers/me/online` | 200 |
| Partner registration step1 | 201 |
| Partner reg IDOR | 403 |

**Gap:** Partner UI on :3002 not running during audit.

---

## Mobile → Backend

| Screen | Expected API | Execution |
|--------|-------------|-----------|
| All tabs | `/api/*` via `homigo-mobile/src/services/core/api.ts` | Typecheck PASS only |
| Razorpay checkout | `/api/payments/*` | NOT executed on device |

**Status:** ⚠️ **PARTIALLY CONNECTED** — client code compiles; no runtime device verification.

---

## Dead / Unused / Broken APIs

### Broken (execution failure)

| API / Flow | Evidence | Severity |
|------------|----------|----------|
| `POST /api/auth/send-otp` via Playwright e2e | 45s timeout waiting for response | HIGH |
| `cashbackService.settleOnPayment` | `smoke-membership-premium.ts` TypeError — function undefined | HIGH |
| Referral withdraw without earnings | `customer@homigo.demo` balance=-100 (withdrawn=100, earned=0) | HIGH |

### Not Configured (blocked live path)

| Integration | `/ready` flag |
|-------------|---------------|
| Razorpay | `configured: false` |
| Razorpay webhook | `configured: false` |
| Email (Resend) | `configured: false` |
| SMS (Twilio) | `configured: false` |

### Schema / Data Mismatches

| Issue | Detail |
|-------|--------|
| Referral balance negative | API returns `balance: -100` with `totalEarned: 0, withdrawn: 100` — withdrawal guard missing or seed corruption |
| Finance validation run | `POST /api/admin/finance/validation/run` returns `result=FAIL` (smoke still counts endpoint reachable) |

### Unused (suspected — not exhaustively traced)

- Full `/api/compliance/*` surface — no frontend smoke in this audit
- `/api/hcoins/*` — limited customer UI wiring verified
- `/api/ai/*` — pages exist; deep flow not E2E tested

---

## Frontend → API → Database Chain Verification

| Flow | API | DB Change Verified | Status |
|------|-----|-------------------|--------|
| Customer login | `/api/auth/login` | session/token issued | ✅ |
| Wallet balance read | `/api/wallet/balance` | reads `users.wallet_balance` | ✅ |
| Account deletion | `/api/users/me` DELETE | `deletion_scheduled_at` set, auth 401 after | ✅ |
| Partner online toggle | PUT `/api/providers/me/online` | provider state updated | ✅ |
| Admin provider verify | admin action | 200 response | ✅ |
| Wallet top-up (dev) | adversarial test | ledger rollback on failure works | ✅ |
| Payment methods CRUD | prior session evidence | `SavedPaymentMethod` table | ✅ (prior session) |

---

## Issue Register

### ISSUE-API-001 — Referral over-withdrawal
- **Severity:** HIGH
- **Root cause:** Withdrawal allowed when `totalEarned < withdrawn`; no balance floor enforcement
- **Impact:** Negative referral balances; financial reporting incorrect
- **Fix:** Enforce `balance >= withdrawal_amount` in referral withdraw service; add DB constraint/check
- **Rollback:** Revert withdraw guard; manual balance correction for affected users
- **Confidence:** HIGH (live API response captured)

### ISSUE-API-002 — OTP E2E timeout
- **Severity:** HIGH
- **Root cause:** Playwright `waitForResponse` on `/api/auth/send-otp` never fires — possible CORS/base URL mismatch in e2e config or signup UI not triggering request
- **Impact:** Signup journey unverified; regression risk
- **Fix:** Align `PLAYWRIGHT_BASE_URL` and API proxy; add explicit network logging
- **Rollback:** N/A
- **Confidence:** HIGH (test failure artifact saved)

### ISSUE-API-003 — Membership cashback smoke broken
- **Severity:** MEDIUM
- **Root cause:** `cashbackService.settleOnPayment` undefined — export/refactor drift
- **Impact:** Premium cashback settlement path untested in smoke
- **Fix:** Restore or rename method on cashback service; update smoke script
- **Rollback:** N/A
- **Confidence:** HIGH
