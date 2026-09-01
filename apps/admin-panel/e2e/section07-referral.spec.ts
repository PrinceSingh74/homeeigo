import { expect } from "@playwright/test";
import { adminLogin, test } from "./enterprise/fixtures";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import fs from "node:fs";

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 834, height: 1112 },
  { width: 768, height: 1024 },
  { width: 430, height: 932 },
  { width: 414, height: 896 },
  { width: 390, height: 844 },
  { width: 375, height: 812 },
  { width: 360, height: 800 },
] as const;

const ART = path.join(__dirname, "__artifacts__", "section07");
fs.mkdirSync(ART, { recursive: true });

test.describe.configure({ mode: "serial" });

test.describe("Section 07 referral HQ live", () => {
  test("authenticated overview, funnel, sources, filters, risk, axe", async ({ page }) => {
    await adminLogin(page);
    const overviewRes = page.waitForResponse(
      (r) => r.url().includes("/api/admin/partner-referrals/overview") && r.status() === 200,
      { timeout: 60_000 },
    );
    await page.goto("/referrals", { waitUntil: "domcontentloaded" });
    const overview = await overviewRes;
    const body = (await overview.json()) as { data?: { economics?: { rewardAmount?: number } } };
    expect(body.data?.economics?.rewardAmount).toBe(500);

    await expect(page.getByRole("heading", { name: /referral hq/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/reward liability/i)).toBeVisible();
    await expect(page.getByText(/reached funnel/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /^sources$/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /top referrers/i })).toBeVisible();

    await page.getByRole("tab", { name: /partner network/i }).click();
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Review" })).toBeVisible();

    await page.getByRole("tab", { name: /risk queue/i }).click();
    await expect(page.getByRole("tab", { name: /risk queue/i })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: /customer/i }).click();
    await expect(page.getByText("Customer referrals", { exact: true })).toBeVisible();

    await page.getByRole("tab", { name: /overview/i }).click();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(blocking, JSON.stringify(blocking.map((v) => v.id))).toEqual([]);

    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await expect(page.getByRole("heading", { name: /referral hq/i })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `overflow at ${vp.width}`).toBeLessThanOrEqual(8);
      await page.screenshot({
        path: path.join(ART, `admin-referral-hq-${vp.width}.png`),
        fullPage: true,
      });
    }
  });
});
