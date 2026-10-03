import { test, expect } from "@playwright/test";

/**
 * Login CSRF through the Google callback (2026-10-01).
 *
 * An attacker can start a Google sign-in with their OWN account and obtain a valid code + state (the
 * backend's state store is not bound to a browser). If a victim then opens
 * /auth/google/callback?code=<attacker code>&state=<attacker state>, the victim's tab holds no pending
 * OAuth state — it never began a sign-in. The callback used to treat that as "recoverable" and post
 * the code to the backend, signing the victim in as the attacker. It must refuse instead, before any
 * request to the backend's callback.
 */
test("a callback this tab did not start is refused before the code reaches the backend", async ({ page }) => {
  const callbackRequests: string[] = [];
  page.on("request", (req) => {
    if (/\/api\/auth\/google\/callback/.test(req.url())) callbackRequests.push(req.method());
  });

  await page.goto("/auth/google/callback?code=attacker-code&state=attacker-state");

  // The alert wraps the sentence in a paragraph, so getByText matches both and strict mode fails
  // even though the refusal rendered once. The role is the security signal under test.
  await expect(
    page.getByRole("alert").filter({ hasText: /OAuth session (expired|was invalid|could not be verified)|security check failed/i }),
  ).toBeVisible({
    timeout: 20_000,
  });
  // Give any deferred effect a chance to fire before asserting it did not.
  await page.waitForTimeout(1_500);
  expect(callbackRequests).toEqual([]);
});
