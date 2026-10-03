import { test, expect } from "@playwright/test";

/**
 * Admin enterprise journey (fresh-env Playwright): Login → Ops Map → Heatmap → Geofence.
 * Runs against the PRODUCTION admin server. Real chromium, real backend.
 */
const SEED_ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };

test.describe.configure({ mode: "serial" });

test.describe("Admin journey", () => {
  test("Login → Ops Map → Heatmap → Geofence", async ({ page }) => {
    test.setTimeout(120_000);

    // 1) Login
    await page.goto("/login");
    await page.locator("#admin-email").fill(SEED_ADMIN.email);
    await page.locator("#admin-password").fill(SEED_ADMIN.password);
    await page.getByRole("button", { name: /enter business hq/i }).click();
    await expect(page.getByRole("heading", { name: /Executive HQ|business overview/i })).toBeVisible({ timeout: 30_000 });

    // Canonical routes (collapsed HQ accordion must not intercept). Same surfaces as signoff-journey.
    await page.goto("/operations", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/operations/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /operations/i }).first()).toBeVisible({ timeout: 20_000 });

    await page.goto("/heatmap", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /heatmap/i }).first()).toBeVisible({ timeout: 20_000 });

    await page.goto("/geofences", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/geofences/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: /zone control|geofence/i }).first()).toBeVisible({
      timeout: 20_000,
    });

    await page.screenshot({ path: "e2e/__artifacts__/journey-admin.png", fullPage: true });
  });
});
