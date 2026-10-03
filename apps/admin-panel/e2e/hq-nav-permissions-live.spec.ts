import { test, expect } from "@playwright/test";
import { HQ_SECTIONS } from "../src/lib/hq-navigation";

const SEED_ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };

/**
 * P1-4 — live-browser confirmation (real login, real backend, real RBAC response) that the
 * seed admin account (SUPER_ADMIN) sees every HQ section after nav changes, and that the
 * sidebar's dynamic "N HQs" count matches what's actually rendered.
 */
test("SUPER_ADMIN sees all HQ sections and an accurate live section count", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#admin-email").fill(SEED_ADMIN.email);
  await page.locator("#admin-password").fill(SEED_ADMIN.password);
  await page.getByRole("button", { name: /enter business hq/i }).click();
  await expect(page.getByRole("heading", { name: /Executive HQ|business overview/i })).toBeVisible({ timeout: 30_000 });

  const sidebar = page.locator("[data-admin-shell]");
  await expect(sidebar).toBeVisible();

  for (const section of HQ_SECTIONS) {
    await expect(sidebar.locator(`[data-hq-section="${section.id}"]`)).toBeVisible();
  }

  await expect(sidebar.getByText(new RegExp(`${HQ_SECTIONS.length} HQs`))).toBeVisible();
});
