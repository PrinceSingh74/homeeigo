import { test, expect } from "@playwright/test";
import { adminLogin, attachEnterpriseMonitor } from "./enterprise/fixtures";

/** Remaining widths after 1920–1024 already certified. Do not rerun those here. */
const VIEWPORTS = [
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

const SEED_PROVIDER_ID = process.env.E2E_PROVIDER_ID ?? "cmq9h687s0005tz8swhtkju1p";

async function assertReadableTypography(page: import("@playwright/test").Page, label: string) {
  const tiny = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll("h1, h2, button, [role='button'], .biz-card")];
    return nodes
      .filter((el) => {
        const style = window.getComputedStyle(el);
        const size = Number.parseFloat(style.fontSize);
        const visible = (el as HTMLElement).offsetParent !== null || style.position === "fixed";
        return visible && Number.isFinite(size) && size > 0 && size < 10;
      })
      .slice(0, 6)
      .map((el) => `${el.tagName}:${(el.textContent ?? "").trim().slice(0, 40)}`);
  });
  expect(tiny, `${label} tiny text`).toEqual([]);
}

async function assertNoOverflow(page: import("@playwright/test").Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, label).toBeLessThanOrEqual(24);
}

test.describe("P1 remaining visual matrix 834–360", () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.width}px acquisition surfaces have no overflow`, async ({ page }) => {
      test.setTimeout(180_000);
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
        await expect(page.locator("text=/Loading|Skeleton/i")).toHaveCount(0, { timeout: 5_000 }).catch(() => undefined);
        await assertNoOverflow(page, `${route.name} overflow at ${vp.width}`);
        await assertReadableTypography(page, `${route.name} ${vp.width}`);
        await page.screenshot({
          path: `e2e/__artifacts__/p1p2-${route.name}-${vp.width}.png`,
          fullPage: true,
        });
      }
      monitor.assertClean();
    });
  }

  test("360px vendor score/career/lifecycle quality", async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 360, height: 800 });
    const monitor = attachEnterpriseMonitor(page);
    await adminLogin(page);
    await page.goto(`/vendors/${SEED_PROVIDER_ID}`);
    await expect(page.getByText(/Score, career/i)).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("/100")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Partner score/i)).toBeVisible();
    await expect(page.getByText(/^Career$/)).toBeVisible();
    await expect(page.getByText(/^Lifecycle$/)).toBeVisible();
    const scoreText = await page.locator("text=/\\/100/").first().textContent();
    expect(scoreText, "score must be numeric not skeleton").not.toMatch(/…|\.\.\./);
    await assertNoOverflow(page, "vendor 360 overflow");
    await assertReadableTypography(page, "vendor 360");
    const pause = page.getByRole("button", { name: /^pause$/i });
    await expect(pause).toBeVisible();
    const box = await pause.boundingBox();
    expect(box, "pause CTA reachable").toBeTruthy();
    expect((box?.height ?? 0) >= 24, "pause CTA tall enough").toBeTruthy();
    await pause.click();
    await expect(page.getByText(/pause this partner/i)).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /cancel/i }).click();
    await expect(page.getByText(/pause this partner/i)).toHaveCount(0);
    await page.screenshot({
      path: "e2e/__artifacts__/section06/admin-vendor-360.png",
      fullPage: true,
    });
    monitor.assertClean();
  });
});
