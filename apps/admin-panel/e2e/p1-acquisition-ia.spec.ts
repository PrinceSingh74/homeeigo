import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin } from "./enterprise/fixtures";

async function assertAxeSerious(page: Parameters<typeof adminLogin>[0], context: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(blocking, `${context}\n${JSON.stringify(blocking.map((v) => v.id), null, 2)}`).toEqual([]);
}

test.describe("P1/P2 acquisition command center", () => {
  test("applications, verification, approvals, analytics, and CRM filters", async ({ page }) => {
    await adminLogin(page);

    await page.goto("/partner-acquisition/applications");
    await expect(page.getByRole("heading", { name: /applications/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /submitted/i })).toBeVisible();
    await assertAxeSerious(page, "applications");

    await page.goto("/partner-acquisition/verification");
    await expect(page.getByRole("heading", { name: /verification/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /needs attention/i })).toBeVisible();
    await assertAxeSerious(page, "verification");

    await page.goto("/partner-acquisition/approvals");
    await expect(page.getByRole("heading", { name: /approvals/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /ready for review/i })).toBeVisible();
    await assertAxeSerious(page, "approvals");

    await page.goto("/partner-acquisition/analytics");
    await expect(page.getByRole("heading", { name: /acquisition analytics/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/cost attribution uses recorded spend/i)).toBeVisible();
    await assertAxeSerious(page, "analytics");

    await page.goto("/partner-acquisition/leads?followUp=today");
    await expect(page.getByText(/lead crm/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /^today$/i }).first()).toBeVisible();
    await page.getByRole("button", { name: /filters/i }).click();
    await expect(page.getByRole("heading", { name: /advanced filters/i })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: /advanced filters/i })).toHaveCount(0);
  });
});
