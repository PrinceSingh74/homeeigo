# Admin Enterprise E2E Report

**Generated:** 2026-06-26T07:25:08.315Z

## Result: FAIL ❌

| Metric | Value |
|--------|-------|
| Tests passed | 2 |
| Tests failed | 1 |
| Duration | 285.3s |
| Exit code | 1 |

## Execution log (tail)

```

Running 5 tests using 1 worker

  ok 1 [chromium] › e2e\enterprise\admin-enterprise.spec.ts:9:7 › Enterprise admin E2E › login → dashboard analytics (26.4s)
  ok 2 [chromium] › e2e\enterprise\admin-enterprise.spec.ts:26:7 › Enterprise admin E2E › provider approval queue (1.3m)
  x  3 [chromium] › e2e\enterprise\admin-enterprise.spec.ts:45:7 › Enterprise admin E2E › refund approval queue (2.2m)
  -  4 [chromium] › e2e\enterprise\admin-enterprise.spec.ts:59:7 › Enterprise admin E2E › compliance — account deletions
  -  5 [chromium] › e2e\enterprise\admin-enterprise.spec.ts:73:7 › Enterprise admin E2E › support ticket management


  1) [chromium] › e2e\enterprise\admin-enterprise.spec.ts:45:7 › Enterprise admin E2E › refund approval queue 

    [31mTest timeout of 120000ms exceeded.[39m

    Error: page.goto: net::ERR_ABORTED; maybe frame was detached?
    Call log:
    [2m  - navigating to "http://localhost:3003/finance/refunds", waiting until "load"[22m


      45 |   test("refund approval queue", async ({ page, monitor }) => {
      46 |     await adminLogin(page);
    > 47 |     await page.goto("/finance/refunds");
         |                ^
      48 |     const res = page.waitForResponse(
      49 |       (r) => r.url().includes("/api/admin/finance/refunds") && r.ok(),
      50 |       { timeout: 30_000 },
        at C:\Users\Kapiissh Green\OneDrive\Desktop\homigo\apps\admin-panel\e2e\enterprise\admin-enterprise.spec.ts:47:16

    Error Context: test-results\enterprise-admin-enterpris-d118f-n-E2E-refund-approval-queue-chromium\error-context.md

  1 failed
    [chromium] › e2e\enterprise\admin-enterprise.spec.ts:45:7 › Enterprise admin E2E › refund approval queue 
  2 did not run
  2 passed (4.5m)
(node:32228) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32228) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

```

## Validation scope

- API responses verified inline per test
- Console errors tracked (non-hydration)
- Failed /api/ requests (4xx+) fail the suite
