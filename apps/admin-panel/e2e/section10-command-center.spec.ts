import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import fs from "node:fs";
import { adminLogin, attachEnterpriseMonitor } from "./enterprise/fixtures";
import { COMMAND_CENTER_SURFACES } from "../src/lib/command-center-ia";

const ART = path.join(__dirname, "__artifacts__", "section10");
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
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  const summary = blocking.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 4).map((n) => n.target),
  }));
  expect(blocking, `${context}\n${JSON.stringify(summary, null, 2)}`).toEqual([]);
}

test.describe("Section 10 command center", () => {
  test("overview IA, audit, logs, and partner detail surfaces", async ({ page }) => {
    const monitor = attachEnterpriseMonitor(page);
    await adminLogin(page);

    await page.goto("/command-center", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /command center/i })).toBeVisible({ timeout: 30_000 });
    const rail = page.getByRole("navigation", { name: /partner command center/i });
    await expect(rail).toBeVisible();
    for (const surface of COMMAND_CENTER_SURFACES) {
      await expect(rail.getByRole("link", { name: surface.label, exact: true })).toBeVisible();
    }
    await expect(rail.getByRole("link", { name: "Audit", exact: true })).toBeVisible();
    await expect(page.getByText(/^Partners$/i).first()).toBeVisible();
    await assertAxeSerious(page, "command center overview");

    await page.goto("/audit", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /audit explorer/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel("Filter action")).toBeVisible();
    await expect(page.getByLabel("Filter request id")).toBeVisible();
    await assertAxeSerious(page, "audit explorer");

    await page.goto("/observability/logs", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /log search/i })).toBeVisible({ timeout: 30_000 });
    await assertAxeSerious(page, "log search");

    await page.goto("/availability", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /live partner availability/i })).toBeVisible({
      timeout: 30_000,
    });

    await page.goto("/kyc", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /^kyc$/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: /verification queue/i })).toBeVisible();

    monitor.assertClean();
  });

  test("12-width matrix for command center and audit", async ({ page }) => {
    test.setTimeout(600_000);
    await adminLogin(page);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await page.goto("/command-center", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /command center/i })).toBeVisible({ timeout: 30_000 });
      const overflowCc = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflowCc, `command-center overflow at ${vp.width}`).toBeLessThanOrEqual(24);
      await page.screenshot({ path: path.join(ART, `command-center-${vp.width}.png`), fullPage: true });

      await page.goto("/audit", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /audit explorer/i })).toBeVisible({ timeout: 30_000 });
      const overflowAudit = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflowAudit, `audit overflow at ${vp.width}`).toBeLessThanOrEqual(24);
      await page.screenshot({ path: path.join(ART, `audit-${vp.width}.png`), fullPage: true });
    }
  });
});
