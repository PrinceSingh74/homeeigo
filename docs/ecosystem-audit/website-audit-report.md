# Website Audit Report (Customer Web)

**App:** `apps/web` — `http://localhost:3001`  
**Audit date:** 2026-06-10  
**Method:** HTTP probes, `npm run build`, Playwright e2e (1 test), API cross-checks

---

## Page Inventory & Results

| Page | HTTP | Auth Redirect | API Data | Forms | Status |
|------|------|---------------|----------|-------|--------|
| Home `/` | 200 | — | featured services (2) | — | ✅ |
| Services `/services` | 200 | — | service catalog | — | ✅ |
| Booking `/book` | 307 | → login | — | — | ✅ protected |
| Wallet `/wallet` | 307 | → login | balance=5700 when authed | payment methods | ✅ |
| Membership `/membership` | 307 | → login | subscription active | purchase/cancel UI | ✅ |
| Referral `/referrals` | 307 | → login | balance=-100 ⚠️ | withdraw/share | ⚠️ |
| Notifications `/notifications` | 307 | → login | total=0 | mark read/delete | ✅ |
| Support `/support` | **200** | public-readable shell | tickets API | create ticket | ⚠️ see note |
| Profile `/profile` | 307 | → login | user/me | edit profile | ✅ |
| Settings `/settings` | 307 | → login | export/delete | account forms | ✅ |
| Bookings `/bookings` | 307 | → login | 0 bookings demo | — | ✅ |
| Providers `/providers` | 200 | — | provider list | — | ✅ |
| Login `/login` | 200 | — | — | login form | ✅ |
| Signup `/signup` | 200 | — | — | signup+OTP | ⚠️ e2e fail |
| Verify email `/verify-email` | not probed | — | — | resend | ⚠️ |
| Legal privacy/terms/cookies/refund | 200 each | — | static | — | ✅ |
| Sitemap `/sitemap.xml` | 200 | — | — | — | ✅ |
| Robots `/robots.txt` | 200 | — | — | — | ✅ |
| 404 unknown route | **connection abort** | — | — | — | ❌ |

**Note on `/support`:** Returns 200 without session (page shell loads). Ticket APIs require auth — middleware does not protect this route. May expose empty state publicly; ticket creation likely fails without token.

---

## Build Verification

```
npm run build → PASS (2026-06-10)
30 routes, middleware 32.2 kB, sitemap + robots included
```

---

## E2E Execution

```
npx playwright test → 1 failed
Test: signup → OTP verify → book a service
Failure: TimeoutError waiting for POST /api/auth/send-otp (45s)
Artifact: apps/web/test-results/signup-otp-booking-*/screenshot + video
```

**Verdict:** Primary acquisition funnel **NOT execution-verified**.

---

## State Coverage

| State | Verified | Evidence |
|-------|----------|----------|
| Loading states | Code review only | React Query skeletons present |
| Empty states | Partial | notifications=0, bookings=0 via API |
| Error states | Partial | `error.tsx` exists per route group |
| Error boundary | `error.tsx` at app root | not crash-tested |

---

## Mobile Responsive

**Not executed** — no viewport automation run. Tailwind responsive classes present in components (code inspection only).

---

## SEO Metadata

| Check | Result |
|-------|--------|
| Root layout metadata | ✅ enriched (prior implementation) |
| Per-page metadata | ✅ membership, referrals, notifications, settings, support, 404 |
| `sitemap.ts` | ✅ 200 |
| `robots.ts` | ✅ 200 |
| 404 `robots: noindex` | ✅ in `not-found.tsx` |

---

## Accessibility

**Not executed** — no axe/Lighthouse run in this audit.

---

## Issues

### ISSUE-WEB-001 — 404 route connection abort
- **Severity:** MEDIUM
- **Root cause:** `GET /nonexistent` closes connection unexpectedly in dev server (not standard 404 HTTP response)
- **Impact:** Poor UX; crawlers may see errors; monitoring false positives
- **Fix:** Investigate Next.js dev server + middleware interaction; verify `not-found.tsx` in production `next start`
- **Rollback:** Revert middleware matcher changes
- **Confidence:** MEDIUM (dev-only; prod not tested)

### ISSUE-WEB-002 — Signup E2E failure
- **Severity:** HIGH
- **Root cause:** OTP request not observed by Playwright
- **Impact:** Cannot certify signup→book funnel
- **Fix:** Debug e2e `baseURL`, ensure signup form triggers API; check rate limits
- **Confidence:** HIGH

### ISSUE-WEB-003 — Support page not auth-gated
- **Severity:** LOW
- **Root cause:** `/support` absent from `PROTECTED_ROUTE_PREFIXES`
- **Impact:** Public page shell; API calls fail silently for anonymous users
- **Fix:** Add `/support` to protected routes or handle anonymous state explicitly
- **Confidence:** HIGH

### ISSUE-WEB-004 — Referral negative balance displayed
- **Severity:** HIGH
- **Root cause:** Backend allows over-withdrawal (see API report)
- **Impact:** User sees -₹100 balance
- **Fix:** Backend guard + frontend clamp display
- **Confidence:** HIGH

---

## Website Score Components

| Area | Score /100 |
|------|-----------|
| Page availability | 85 |
| API integration | 80 |
| Auth/middleware | 90 |
| E2E journeys | 20 |
| SEO | 88 |
| A11y/responsive | 40 (untested) |

**Overall Website: 72/100** — builds and APIs work; E2E and 404 probe failures block higher score.
