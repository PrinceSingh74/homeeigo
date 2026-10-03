import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin } from "./enterprise/fixtures";
import { adminToken, createLeadAndInvite, uniquePhone } from "./helpers/p0-acquisition";

async function assertAxeSerious(page: Parameters<typeof adminLogin>[0], context: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  const summary = blocking.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 4).map((n) => n.target),
  }));
  expect(blocking, `${context}\n${JSON.stringify(summary, null, 2)}`).toEqual([]);
}

test.describe("P0 acquisition accessibility", () => {
  test("dashboard and lead inbox keyboard + axe", async ({ page }) => {
    await adminLogin(page);
    await page.goto("/partner-acquisition");
    await expect(page.getByRole("heading", { name: /partner acquisition/i })).toBeVisible({ timeout: 30_000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.getByRole("link", { name: /add lead/i })).toBeVisible();
    await assertAxeSerious(page, "acquisition dashboard");

    await page.goto("/partner-acquisition/leads");
    await expect(page.getByText(/lead crm/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^loading leads$/i)).toHaveCount(0, { timeout: 30_000 });
    const allFilter = page.getByRole("button", { name: /^all$/i }).first();
    await allFilter.focus();
    await expect(allFilter).toBeFocused();
    await page.keyboard.press("Enter");
    await assertAxeSerious(page, "lead inbox");
  });

  test("Start Application modal is keyboard dismissible", async ({ page, request }) => {
    const token = await adminToken(request);
    const phone = uniquePhone();
    const started = await createLeadAndInvite(request, token, {
      name: `A11y ${phone.slice(-4)}`,
      phone,
    });
    await adminLogin(page);
    await page.goto(`/partner-acquisition/leads/${started.leadId}`);
    await expect(page.getByRole("heading", { level: 1, name: new RegExp(`A11y ${phone.slice(-4)}`) })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: /start application/i }).first().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: /start application/i })).toBeVisible();
    await assertAxeSerious(page, "start application modal");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: /start application/i })).toHaveCount(0);
  });
});
