import { test, expect } from "@playwright/test";
import { adminLogin, attachEnterpriseMonitor } from "./enterprise/fixtures";

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

const ROUTES = [
  { path: "/partner-acquisition", name: "dashboard" },
  { path: "/partner-acquisition/leads", name: "crm" },
  { path: "/partner-acquisition/applications", name: "applications" },
  { path: "/partner-acquisition/verification", name: "verification" },
  { path: "/partner-acquisition/approvals", name: "approvals" },
  { path: "/partner-acquisition/analytics", name: "analytics" },
] as const;

test.describe("P1/P2 visual + responsive matrix", () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.width}px acquisition surfaces have no overflow`, async ({ page }) => {
      await page.setViewportSize(vp);
      const monitor = attachEnterpriseMonitor(page);
      await adminLogin(page);

      for (const route of ROUTES) {
        await page.goto(route.path);
        await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 30_000 });
        if (route.name === "dashboard") {
          await expect(page.getByText("Total leads")).toBeVisible({ timeout: 30_000 });
        }
        if (route.name === "analytics") {
          await expect(page.getByText(/cost attribution uses recorded spend/i)).toBeVisible({ timeout: 30_000 });
        }
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${route.name} overflow at ${vp.width}`).toBeLessThanOrEqual(24);
        await page.screenshot({
          path: `e2e/__artifacts__/p1p2-${route.name}-${vp.width}.png`,
          fullPage: true,
        });
      }
      monitor.assertClean();
    });
  }
});
