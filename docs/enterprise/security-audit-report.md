# HOMIGO — Security Audit Report

**Generated:** 2026-06-09
**Method:** Live adversarial HTTP attacks against the running server (`scripts/security-adversarial-audit.ts`) + integration RBAC tests (`adversarial-integration.test.ts`).
**Verdict after fix:** **15/15 checks PASS — NO BYPASS REPRODUCED.**

---

## 1. CRITICAL FINDING — SEC-001: Admin API privilege escalation (FIXED)

This is the headline result of the audit and a real, exploitable vulnerability that the adversarial run reproduced.

- **Root Cause:** `admin-rbac.ts` registered its enforcement via `.onBeforeHandle(...)` **without a scope**. In Elysia, lifecycle hooks are *local* by default — they run only for routes defined on the same instance. Because `adminRbacPlugin` defines no routes of its own, the guard never executed for the consuming `adminApiRoutes`. Every `/api/admin/*` route was reachable **unauthenticated**.
- **Execution Evidence (reproduce):**
  ```
  GET /api/admin/users   (no token)   →  HTTP 200   ← FAIL (data returned to anonymous caller)
  ```
- **Impact:** CRITICAL. Anonymous read of all users/providers/bookings and access to admin actions — full admin data exposure and privilege escalation.
- **Fix:** scope the hook so it propagates to consuming routes:
  ```ts
  .onBeforeHandle({ as: "scoped" }, async ({ request, set, requireRole, adminContext }) => { ... })
  ```
- **Execution Evidence (proof fixed):**
  ```
  GET /api/admin/users   (no token)              →  HTTP 401  ← PASS
  GET /api/admin/users   (forged admin JWT)      →  HTTP 401  ← PASS
  ```
- **Regression guard:** `adversarial-integration.test.ts` confirms the positive path is intact —
  `D2 finance admin allowed past RBAC (not 403)` and `E1 legacy ADMIN without AdminUser row denied (403)` both pass, so legitimate admins keep access while attackers and under-privileged admins are blocked.
- **Risk:** LOW (scoping is the intended Elysia pattern; positive-path tested). **Rollback:** revert the `{ as: "scoped" }` argument.
- **Confidence:** HIGH.

## 2. Full Adversarial Matrix (live, post-fix)

| Category | Attack | Result | Status |
|---|---|---|---|
| JWT | empty bearer | 401 | PASS |
| JWT | forged signature | 401 | PASS |
| JWT | `alg=none` | 401 | PASS |
| RBAC | admin route unauthenticated | 401 | PASS |
| Privilege Escalation | forged admin JWT on admin route | 401 | PASS |
| IDOR | other user's booking unauthenticated | 401 | PASS |
| Webhook Replay | tampered Razorpay signature | 401 | PASS |
| Webhook Replay | unsigned webhook | 401 | PASS |
| SQL Injection | `' OR 1=1;--` in category | 200, no error/leak (parameterized) | PASS |
| SQL Injection | `1;DROP TABLE…` in limit | 200, neutralized | PASS |
| Mass Assignment | `role=ADMIN`,`isAdmin`,`walletBalance` on register | 400; role/balance NOT granted | PASS |
| SSRF | avatar URL → `169.254.169.254` | 401 (no unauth fetch) | PASS |
| Payment Tampering | unauth create-order w/ amount | 401 | PASS |
| Gift Card Abuse | unauth redeem | 401 | PASS |
| Rate Limiting | 40× login burst | 429 throttled | PASS |

```
total checks: 15 | passed: 15 | failed: 0
VERDICT: NO BYPASS REPRODUCED
```

## 3. Additional Coverage (existing passing suites)

- **Webhook idempotency / replay:** `webhook-dedup.service` returns `SKIP` for processed events — proven in DR drill scenario C and `release-blocker-wave2`.
- **Gift card concurrent redemption:** single-debit guaranteed (`release-blocker-wave2`: "gift card concurrent redemption — single debit").
- **Coupon / booking abuse:** campaign & coupon usage limits enforced via `campaign-limits.service` (unit-covered).
- **PII / encryption:** `p4-part-a-security.test.ts` (masking, retention mapping, integrity hashes) — 22/22 pass.
- **Token security & WS channel access:** `ws-channel-access.test.ts`, token revocation — pass.

## 4. Confidence

**HIGH** for everything reproduced live. CSRF is mitigated by the stateless Bearer-token model (no ambient cookies on the API), but a dedicated CSRF reproduction for any cookie-based admin surface is recommended as follow-up.
