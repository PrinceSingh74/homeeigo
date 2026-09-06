import { test, expect } from "@playwright/test";

/**
 * Partner enterprise journey (fresh-env Playwright): Login → Bookings → Route Center.
 * Real chromium, real backend. (Job "completion" requires a live dispatched job; the
 * Route Center optimisation was certified separately — see partner-route-center cert.)
 */
const SEED_PARTNER = { email: "partner@homigo.demo", password: "Homigo@123" };

test.describe.configure({ mode: "serial" });

test.describe("Partner journey", () => {
  test("Login → Bookings → Route Center", async ({ page }) => {
    test.setTimeout(120_000);

    // 1) Login
    await page.goto("/login");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator("#partner-email").fill(SEED_PARTNER.email);
    await page.locator("#partner-password").fill(SEED_PARTNER.password);
    const loginResponse = page.waitForResponse(
      (res) => res.url().includes("/api/auth/login") && res.status() === 200,
      { timeout: 60_000 },
    );
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await loginResponse;
    await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });

    // 2) Bookings / requests dashboard
    await expect(page.getByRole("heading", { name: /new booking requests/i })).toBeVisible({ timeout: 60_000 });

    // 3) Route Center
    await page.goto("/route-center", { waitUntil: "networkidle" });
    await expect(page).toHaveURL(/\/route-center/, { timeout: 30_000 });

    await page.screenshot({
      path: `e2e/__artifacts__/journey-partner-${Date.now()}.png`,
      fullPage: true,
    });
  });
});
