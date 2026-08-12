import { test, expect } from "@playwright/test";

/**
 * Minimal real-chromium smoke for the customer web app — proves the browser harness +
 * app render independently of the heavier monitored enterprise journeys.
 */
test.describe("Web app — browser smoke", () => {
  test("home renders in chromium", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/HOMIGO/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("login page renders with credential fields", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.locator('input[type="password"]')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "e2e/__artifacts__/web-login.png" });
  });
});
