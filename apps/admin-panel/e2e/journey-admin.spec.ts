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
    await expect(page.getByRole("heading", { name: /business overview/i })).toBeVisible({ timeout: 30_000 });

    // 2) Ops Map (Live Ops)
    await page.getByRole("link", { name: /Live Ops/i }).click();
    await expect(page).toHaveURL(/\/operations/, { timeout: 20_000 });
    await page.waitForLoadState("networkidle");

    // 3) Heatmap
    await page.getByRole("link", { name: /Demand Heatmap/i }).click();
    await expect(page.getByRole("heading", { name: /Demand Heatmap/i })).toBeVisible({ timeout: 20_000 });

    // 4) Geofence
    await page.getByRole("link", { name: /Zone Control/i }).click();
    await expect(page).toHaveURL(/\/geofences/, { timeout: 20_000 });
    await page.waitForLoadState("networkidle");

    await page.screenshot({ path: "e2e/__artifacts__/journey-admin.png", fullPage: true });
  });
});
