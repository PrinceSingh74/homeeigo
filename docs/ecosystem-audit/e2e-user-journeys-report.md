# End-to-End User Journeys Report

**Audit date:** 2026-06-10  
**Rule:** Each step must succeed with API + DB + UI evidence to mark WORKING.

---

## Journey 1: Signup → Verify Email → Book → Pay → Accept → Complete → Review

| Step | Status | Evidence |
|------|--------|----------|
| Signup | ❌ FAIL | Playwright timeout on `send-otp` |
| Verify email | ⚠️ NOT RUN | — |
| Book service | ❌ BLOCKED | depends on signup |
| Pay | ⚠️ DEV ONLY | Razorpay not configured |
| Provider accept | ❌ NOT RUN | no booking fixture |
| Provider complete | ❌ NOT RUN | — |
| Review | ❌ NOT RUN | — |

**Verdict:** ❌ **BROKEN** — primary funnel fails at step 1.

---

## Journey 2: Wallet Topup → Booking Via Wallet

| Step | Status | Evidence |
|------|--------|----------|
| Wallet topup order | ✅ TEST | adversarial test creates `order_dev_*` |
| Wallet credit | ✅ TEST | atomic update with FOR UPDATE |
| Ledger on success | ✅ TEST | integrity 100/100 |
| Book with wallet | ⚠️ NOT RUN | no live booking+wallet E2E |
| Demo user balance | ✅ LIVE | 5700 INR |

**Verdict:** ⚠️ **PARTIALLY WORKING** — topup path tested in unit/adversarial tests; booking spend not E2E.

---

## Journey 3: Membership Purchase

| Step | Status | Evidence |
|------|--------|----------|
| List plans | ✅ LIVE | `/api/subscriptions/plans` 200 |
| Current subscription | ✅ LIVE | demo user `active: true` |
| Entitlements | ✅ SMOKE | 10/10 pass |
| Purchase flow | ⚠️ NOT RUN | Razorpay required |
| Cashback settlement | ❌ FAIL | smoke-membership-premium TypeError |

**Verdict:** ⚠️ **PARTIALLY WORKING**

---

## Journey 4: Referral Share → Signup → Reward

| Step | Status | Evidence |
|------|--------|----------|
| Referral code | ✅ LIVE | `TESTREF1` |
| Referral count | ✅ LIVE | count=1, pending=1 |
| Reward credit | ⚠️ | totalEarned=0 |
| Withdraw | ❌ DATA BUG | withdrawn=100, balance=-100 |

**Verdict:** ❌ **BROKEN** (withdrawal invariant violated)

---

## Journey 5: Support Ticket

| Step | Status | Evidence |
|------|--------|----------|
| Create ticket | ⚠️ NOT RUN | API exists; UI on :3001 loads |
| Admin view | ⚠️ NOT RUN | admin API support routes exist |
| Lifecycle test | ✅ | account lifecycle touches support model cleanup |

**Verdict:** ⚠️ **PARTIALLY CONNECTED**

---

## Journey 6: Gift Card Purchase + Redeem

| Step | Status | Evidence |
|------|--------|----------|
| Purchase | ❌ NOT RUN | `/api/giftcards` exists |
| Redeem | ❌ NOT RUN | brute-force protection unit tested only |

**Verdict:** ❌ **NOT VERIFIED**

---

## Journey 7: Account Deletion

| Step | Status | Evidence |
|------|--------|----------|
| Schedule deletion | ✅ LIVE | `smoke-account-lifecycle.ts` |
| User deactivated | ✅ LIVE | `is_active` false |
| Auth blocked | ✅ LIVE | 401 after delete |
| Audit log | ✅ LIVE | deletion action logged |
| Export before delete | ✅ LIVE | JSON + ZIP export |

**Verdict:** ✅ **WORKING** — 10/10 smoke pass

---

## Summary

| Journey | Verdict |
|---------|---------|
| 1 Full booking | ❌ BROKEN |
| 2 Wallet booking | ⚠️ PARTIAL |
| 3 Membership | ⚠️ PARTIAL |
| 4 Referral | ❌ BROKEN |
| 5 Support | ⚠️ PARTIAL |
| 6 Gift card | ❌ NOT VERIFIED |
| 7 Account deletion | ✅ WORKING |

**E2E readiness:** 1/7 fully working under execution evidence rules.
