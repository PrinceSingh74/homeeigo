import { test, expect } from "@playwright/test";

/**
 * Enterprise-hardening browser journey — validates the Alert Center (WS push) + Demand
 * Heatmap (CSV/PDF export) pages render and wire up in a real chromium session.
 */
const SEED_ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /HOMIGO Business HQ/i })).toBeVisible();
  await page.locator("#admin-email").fill(SEED_ADMIN.email);
  await page.locator("#admin-password").fill(SEED_ADMIN.password);
  await page.getByRole("button", { name: /enter business hq/i }).click();
  await expect(page.getByRole("heading", { name: /business overview/i })).toBeVisible({ timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("Enterprise Hardening — Alert Center + Heatmap", () => {
  test("admin signs in", async ({ page }) => {
    await login(page);
  });

  test("Alert Center renders + connects to the realtime feed", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: /Alert Center/i }).click();
    await expect(page.getByRole("heading", { name: /Alert Center/i })).toBeVisible({ timeout: 20_000 });
    // The realtime status pill resolves to Live / Reconnecting / Polling.
    await expect(page.getByText(/Live|Reconnecting|Polling/).first()).toBeVisible({ timeout: 20_000 });
    // Filters present.
    await expect(page.getByRole("button", { name: /Mark all read/i })).toBeVisible();
    await page.screenshot({ path: "e2e/__artifacts__/alert-center.png", fullPage: true });
  });

  test("Demand Heatmap renders with CSV + PDF export", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: /Demand Heatmap/i }).click();
    await expect(page.getByRole("heading", { name: /Demand Heatmap/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /CSV/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /PDF/i })).toBeVisible();
    await page.screenshot({ path: "e2e/__artifacts__/heatmap.png", fullPage: true });
  });
});
