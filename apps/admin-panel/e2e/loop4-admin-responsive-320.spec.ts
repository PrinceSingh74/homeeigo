import { expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { adminLogin, test } from "./enterprise/fixtures";

const ART = path.join(__dirname, "__artifacts__", "loop4-responsive");
fs.mkdirSync(ART, { recursive: true });

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 414, height: 896 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

const ROUTES = [
  { path: "/command-center", name: "overview" },
  { path: "/vendors", name: "partners" },
  { path: "/bookings", name: "jobs" },
  { path: "/earnings", name: "earnings" },
  { path: "/finance/payouts", name: "payouts" },
  { path: "/kyc", name: "kyc" },
  { path: "/trust-safety", name: "safety" },
  { path: "/referrals", name: "referrals" },
  { path: "/incentives", name: "incentives" },
  { path: "/audit", name: "audit" },
  { path: "/finance/dashboard", name: "finance" },
] as const;

test.describe("Loop 4 admin PHASE 1A responsive widths", () => {
  test("critical admin routes remain usable across required widths", async ({ page }) => {
    test.setTimeout(600_000);
    await adminLogin(page);

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of ROUTES) {
        await page.goto(route.path, { waitUntil: "domcontentloaded" });
        const nextOverlay = page.locator("[data-nextjs-dialog], nextjs-portal").or(
          page.getByRole("heading", { name: /^runtime error$/i }),
        );
        if (await nextOverlay.first().isVisible({ timeout: 800 }).catch(() => false)) {
          const overlayText = (await nextOverlay.first().textContent().catch(() => "")) ?? "";
          throw new Error(
            `Next overlay blocked ${route.path}@${vp.width}: ${overlayText.slice(0, 400)}`,
          );
        }
        await expect(page.locator("h1").first(), `h1 ${route.name}@${vp.width}`).toBeVisible({
          timeout: 30_000,
        });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
        );
        expect(overflow, `${route.name}@${vp.width}`).toBe(false);
        await page.screenshot({
          path: path.join(ART, `${route.name}-${vp.width}.png`),
          fullPage: true,
        });
      }
    }
  });
});
