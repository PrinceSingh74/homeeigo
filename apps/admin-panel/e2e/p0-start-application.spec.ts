import { test, expect } from "@playwright/test";
import { adminLogin, attachEnterpriseMonitor } from "./enterprise/fixtures";
import { adminToken, createLeadAndInvite, uniquePhone } from "./helpers/p0-acquisition";

test.describe("P0 acquisition Start Application", () => {
  test("dashboard and lead inbox render premium CRM chrome", async ({ page }) => {
    const monitor = attachEnterpriseMonitor(page);
    await adminLogin(page);
    await page.goto("/partner-acquisition");
    await expect(page.getByRole("heading", { name: /partner acquisition/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/total leads/i).first()).toBeVisible();
    await page.screenshot({ path: "e2e/__artifacts__/p0-acquisition-dashboard.png", fullPage: true });

    await page.goto("/partner-acquisition/leads");
    await expect(page.getByText(/lead crm/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/loading leads|^\d+ leads$/i).first()).toBeVisible();
    await expect(page.getByText(/^loading leads$/i)).toHaveCount(0, { timeout: 30_000 });
    await page.screenshot({ path: "e2e/__artifacts__/p0-lead-inbox.png", fullPage: true });
    monitor.assertClean();
  });

  test("Start Application creates invite without Provider", async ({ page, request }) => {
    const token = await adminToken(request);
    const phone = uniquePhone();
    const started = await createLeadAndInvite(request, token, {
      name: `CRM ${phone.slice(-4)}`,
      phone,
    });
    expect(started.lead.providerId ?? null).toBeNull();

    await adminLogin(page);
    await page.goto(`/partner-acquisition/leads/${started.leadId}`);
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`CRM ${phone.slice(-4)}`) })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: /start application/i })).toBeVisible();
    await page.getByRole("button", { name: /start application/i }).first().click();
    await expect(page.getByRole("heading", { name: /start application/i })).toBeVisible();
    await expect(page.getByText(/no operational partner is created/i)).toBeVisible();
    await page.screenshot({ path: "e2e/__artifacts__/p0-start-application-modal.png" });
  });
});
