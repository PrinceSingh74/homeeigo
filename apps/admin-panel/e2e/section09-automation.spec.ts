import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import fs from "node:fs";
import { adminLogin, attachEnterpriseMonitor } from "./enterprise/fixtures";

const ART = path.join(__dirname, "__artifacts__", "section09");
fs.mkdirSync(ART, { recursive: true });

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

async function assertAxeSerious(page: import("@playwright/test").Page, context: string) {
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

test.describe("Section 09 admin automation", () => {
  test("automation center and event explorer axe + governance honesty", async ({ page }) => {
    const monitor = attachEnterpriseMonitor(page);
    await adminLogin(page);

    await page.goto("/automation", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /automation center/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/registered workflows/i)).toBeVisible();
    await expect(page.locator("tbody td").filter({ hasText: /^LIVE$/ })).toHaveCount(0);
    await expect(page.getByText(/not executable/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /outbox/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /dead letter queue/i })).toBeVisible();
    await assertAxeSerious(page, "admin automation center");

    await page.goto("/automation/events", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /event explorer/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/demand\.spike|Registered, no producer|inert/i).first()).toBeVisible();
    await assertAxeSerious(page, "admin event explorer");
    monitor.assertClean();
  });

  test("12-width matrix for automation and event explorer", async ({ page }) => {
    test.setTimeout(600_000);
    await adminLogin(page);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await page.goto("/automation", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /automation center/i })).toBeVisible({
        timeout: 30_000,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `automation overflow at ${vp.width}`).toBeLessThanOrEqual(24);
      await page.screenshot({ path: path.join(ART, `automation-${vp.width}.png`), fullPage: true });

      await page.goto("/automation/events", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /event explorer/i })).toBeVisible({
        timeout: 30_000,
      });
      const overflowEvents = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflowEvents, `events overflow at ${vp.width}`).toBeLessThanOrEqual(24);
      await page.screenshot({ path: path.join(ART, `events-${vp.width}.png`), fullPage: true });
    }
  });
});
