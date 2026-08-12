# Customer Enterprise E2E Report

**Generated:** 2026-06-26T07:25:08.315Z

## Result: FAIL ❌

| Metric | Value |
|--------|-------|
| Tests passed | 0 |
| Tests failed | 1 |
| Duration | 279.5s |
| Exit code | 1 |

## Execution log (tail)

```

  x  1 [chromium] › e2e\enterprise\customer-enterprise.spec.ts:28:7 › Enterprise customer E2E › signup → OTP verify (2.3m)
  -  2 [chromium] › e2e\enterprise\customer-enterprise.spec.ts:57:7 › Enterprise customer E2E › forgot password flow
  -  3 [chromium] › e2e\enterprise\customer-enterprise.spec.ts:79:7 › Enterprise customer E2E › login → search → wallet → referral → membership → notifications
  -  4 [chromium] › e2e\enterprise\customer-enterprise.spec.ts:148:7 › Enterprise customer E2E › support ticket create
  -  5 [chromium] › e2e\enterprise\customer-enterprise.spec.ts:168:7 › Enterprise customer E2E › booking with mocked payment
  -  6 [chromium] › e2e\enterprise\customer-enterprise.spec.ts:194:7 › Enterprise customer E2E › account deletion schedule (disposable user)


  1) [chromium] › e2e\enterprise\customer-enterprise.spec.ts:28:7 › Enterprise customer E2E › signup → OTP verify 

    TimeoutError: page.waitForResponse: Timeout 45000ms exceeded while waiting for event "response"

      34 |     await fillOtp(page, otp);
      35 |
    > 36 |     const verifyRes = page.waitForResponse(
         |                            ^
      37 |       (r) =>
      38 |         r.request().method() === "POST" &&
      39 |         (r.url().includes("/api/auth/verify-otp") || r.url().includes("/api/auth/register")) &&
        at C:\Users\Kapiissh Green\OneDrive\Desktop\homigo\apps\web\e2e\enterprise\customer-enterprise.spec.ts:36:28

    attachment #1: screenshot (image/png) ──────────────────────────────────────────────────────────
    test-results\enterprise-customer-enterp-6f254-mer-E2E-signup-→-OTP-verify-chromium\test-failed-1.png
    ────────────────────────────────────────────────────────────────────────────────────────────────

    attachment #2: video (video/webm) ──────────────────────────────────────────────────────────────
    test-results\enterprise-customer-enterp-6f254-mer-E2E-signup-→-OTP-verify-chromium\video.webm
    ────────────────────────────────────────────────────────────────────────────────────────────────

    Error Context: test-results\enterprise-customer-enterp-6f254-mer-E2E-signup-→-OTP-verify-chromium\error-context.md

  1 failed
    [chromium] › e2e\enterprise\customer-enterprise.spec.ts:28:7 › Enterprise customer E2E › signup → OTP verify 
  5 did not run
(node:31012) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:31012) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Validation scope

- API responses verified inline per test
- Console errors tracked (non-hydration)
- Failed /api/ requests (4xx+) fail the suite
