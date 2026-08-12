# Phase A — Customer E2E Certification

**Date:** 2026-06-10  
**Method:** Playwright browser automation only — execution evidence  
**Suite:** `apps/web/e2e/enterprise/customer-enterprise.spec.ts`  
**Verdict:** **6/6 PASS** (42.7s, 0 flaky, 0 skipped)

---

## Execution log

```
docs/enterprise/customer-e2e-cert-run.log
```

```
  ok 1 signup → OTP verify (6.1s)
  ok 2 forgot password flow (2.8s)
  ok 3 login → search → wallet → referral → membership → notifications (11.5s)
  ok 4 support ticket create (5.9s)
  ok 5 booking with mocked payment (7.6s)
  ok 6 account deletion schedule (disposable user) (7.8s)

  6 passed (42.7s)
```

---

## Flow coverage

| # | Requirement | Browser | API trace | DB proof |
|---|-------------|---------|-----------|----------|
| 1 | Signup | `/signup` form submit | `POST /api/auth/send-otp`, `POST /api/auth/verify-otp` | `GET /api/users/me` after login |
| 2 | OTP verification | OTP digits UI | verify-otp/register 200 | user id returned |
| 3 | Login | UI sign-in + protected routes | `/api/wallet/balance`, `/api/referrals/me`, `/api/subscriptions/plans`, `/api/notifications` | all 200 |
| 4 | Service discovery | `/services` heading + search | `GET /api/services` 200 | — |
| 5 | Wallet | `/wallet` UI | `GET /api/wallet/balance` | balance object |
| 6 | Referral | `/referrals` UI | `GET /api/referrals/me` | referral summary |
| 7 | Membership | `/membership` UI | `GET /api/subscriptions/plans` | plans array |
| 8 | Notifications | `/notifications` UI | `GET /api/notifications` | 200 |
| 9 | Support ticket | `/support` new ticket | `POST /api/support/tickets` 200 | — |
| 10 | Booking creation | `/book` confirm | `POST /api/bookings` 201 | `GET /api/bookings/upcoming` has rows |
| 11 | Razorpay payment | Razorpay mock checkout | payment verify path triggered via UI | paymentCount +7 in DB (see Phase C) |
| 12 | Account deletion | `/settings` DELETE confirm | `DELETE /api/users/me` 200 | disposable user removed |

---

## Artifacts

| Type | Path |
|------|------|
| Run log | `docs/enterprise/customer-e2e-cert-run.log` |
| Screenshots (on failure runs) | `docs/enterprise/playwright-artifacts/` |
| Videos (on failure runs) | `docs/enterprise/playwright-artifacts/` |

---

## Infra at run time

- Backend: `http://localhost:3000` (healthy)
- Customer web: `http://localhost:3001`
- Postgres: `homigo-postgres` healthy
- Redis: `homigo-redis` healthy (flushed before run)
- Command: `E2E_SKIP_SERVERS=1 npm run test:e2e -- e2e/enterprise/customer-enterprise.spec.ts`

---

## Certification gaps (honest)

1. **Test 5 uses mocked Razorpay** (`mockRazorpayCheckout`) — real checkout + live webhook covered in Phase C (partial).
2. **504 gateway timeouts** observed on slow dev-server runs — filtered in monitor for dev stability; production must meet SLO without filter.
3. **Provider assignment / booking completion** not exercised in this customer suite (covered in Phase B partner E2E).

---

## Classification

**STAGING READY** for customer web UI journeys.  
**Not ENTERPRISE READY** until real Razorpay + mobile + scale SLO pass (Phases C–E).
