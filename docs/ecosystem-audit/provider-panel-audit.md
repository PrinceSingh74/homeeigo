# Provider Panel Audit Report

**App:** `apps/partner-web` — port **3002**  
**Audit date:** 2026-06-10

---

## Execution Evidence

| Test | Result |
|------|--------|
| `smoke-partner-routes.ts` | ✅ 21/21 PASS |
| `smoke-provider-api.ts` | ✅ 21/21 PASS (same script family) |
| Partner registration in `verify-full-stack.ts` | ✅ step1 201, OTP 200, services 200, IDOR 403 |
| `npm run build` | ✅ PASS |
| UI server `:3002` | ❌ NOT RUNNING (timeout in full-stack verify) |

---

## API-Verified Provider Flows

| Flow | Endpoint | Result |
|------|----------|--------|
| Provider login | `/api/auth/login` | 200 |
| Profile | GET `/api/providers/me` | 200 |
| Dashboard | GET `/api/providers/me/dashboard` | 200 |
| Earnings | GET `/api/providers/me/earnings` | 200 |
| Bookings list | GET `/api/providers/me/bookings` | 200 |
| Reviews | GET `/api/providers/me/reviews` | 200 |
| Payouts | GET `/api/providers/me/payouts` | 200 |
| Invoices | GET `/api/providers/me/invoices` | 200 |
| Tax summary | GET `/api/providers/me/tax-summary` | 200 |
| Wallet balance | GET `/api/wallet/balance` | 200 |
| Wallet transactions | GET `/api/wallet/transactions` | 200 |
| Notifications | GET `/api/notifications` | 200 |
| Membership plans | GET `/api/subscriptions/plans` | 200 |
| Go online | PUT `/api/providers/me/online` | 200 |
| Profile update | PUT `/api/users/me` | 200 |
| Upcoming bookings | GET `/api/bookings/upcoming` | 200 |
| Notifications WS | connect + close | 1000 |

---

## Registration & KYC (API)

| Step | Result |
|------|--------|
| Step 1 registration | 201 |
| OTP + token issuance | 200 |
| Services selection (authed) | 200 |
| IDOR on other provider's registration | 403 |

**UI KYC upload:** code in `Step3KYC.tsx`; file upload to local `FILE_UPLOAD_DIR` — **not live-tested**.

---

## Booking Actions (Accept/Reject/Complete)

**Not executed in smoke scripts.** Provider booking mutation endpoints exist in `bookings.ts` but require an active booking fixture — **NOT VERIFIED** in this audit.

---

## Withdrawals

Payout endpoints return 200 in smoke (read paths). Withdrawal **submission** not probed.

---

## UI Routes (build)

Dashboard, requests, earnings, payouts, wallet, ledger, membership, invoices, reviews, analytics, ai, notifications, profile, map, availability, register, login.

---

## Issues

### ISSUE-PROV-001 — Partner UI not running
- **Severity:** MEDIUM
- **Impact:** Accept/reject/complete UI not verified
- **Fix:** Start `:3002` dev server; manual booking lifecycle test

### ISSUE-PROV-002 — Booking lifecycle mutations untested
- **Severity:** HIGH
- **Impact:** Core provider workflow unverified end-to-end
- **Fix:** Create booking fixture; smoke accept→complete→earnings credit

### ISSUE-PROV-003 — KYC document upload not probed
- **Severity:** MEDIUM
- **Impact:** Partner onboarding may fail on file storage
- **Fix:** Upload test PDF via registration UI + verify DB record

---

## Provider Score: 80/100

Read-path APIs excellent; write-path booking/KYC not execution-verified.
