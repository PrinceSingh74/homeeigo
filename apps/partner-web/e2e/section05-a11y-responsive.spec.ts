import { expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { partnerLogin, recoverDevChunkAbort, test } from "./enterprise/fixtures";
import { assertAxeSerious } from "./helpers/p0-a11y";

const ART = path.join(__dirname, "__artifacts__", "section05");
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

const ROUTES = [
  { path: "/trust-compliance", name: "compliance", heading: /compliance center/i },
  { path: "/trust-compliance/compliance", name: "documents", heading: /documents/i },
  { path: "/wellbeing/sos", name: "sos", heading: /safety|sos/i },
] as const;

test.describe("Section 05 a11y + responsive", () => {
  test("axe serious/critical clean on compliance and SOS", async ({ page, monitor }) => {
    await partnerLogin(page);
    for (const route of ROUTES) {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await recoverDevChunkAbort(page);
      await expect(page.getByRole("heading", { name: route.heading })).toBeVisible({ timeout: 30_000 });
      await assertAxeSerious(page, `section05 ${route.path}`);
    }
    monitor.assertClean();
  });

  test("responsive matrix has no horizontal overflow", async ({ page }) => {
    test.setTimeout(600_000);
    await partnerLogin(page);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of ROUTES) {
        await page.goto(route.path, { waitUntil: "domcontentloaded" });
        await recoverDevChunkAbort(page);
        await expect(page.getByRole("heading", { name: route.heading })).toBeVisible({ timeout: 30_000 });
        await page.screenshot({
          path: path.join(ART, `partner-${route.name}-${vp.width}.png`),
          fullPage: true,
        });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 24,
        );
        expect(overflow, `${route.name}@${vp.width}`).toBe(false);
      }
    }
  });
});
