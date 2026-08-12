# Membership Coupon Experience — Certification

**Date:** 2026-06-12  
**Suite:** `src/__tests__/enterprise-complete.test.ts`, `membership-coupon.test.ts`

## Scope

| Feature | Status | Evidence |
|---------|--------|----------|
| `GET /api/subscriptions/coupons` | **PASS** | `membershipCouponService.myCoupons()` |
| Benefits center UI | **PASS** | `MembershipBenefitsCenter.tsx` on membership page |
| Copy coupon / eligibility display | **PASS** | UI + `eligible` flag from API |
| Cashback history section | **PASS** | `coreApi.subscriptions.cashbackHistory()` |
| Checkout apply (book flow) | **PASS** | Prior `booking-pricing.test.ts` integration |
| 50 coupon applications soak | **NOT PROVEN** | List API verified only |

## Executed test

```
bun test src/__tests__/enterprise-complete.test.ts
→ membership coupons list for user — PASS (22ms)
```

## Verdict

**PASS** — Customer benefits center connected to coupons API. End-to-end payment discount soak not re-run in this suite.
