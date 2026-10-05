import { expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { partnerLogin, partnerToken, recoverDevChunkAbort, test } from "./enterprise/fixtures";
import { assertAxeSerious } from "./helpers/p0-a11y";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
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

async function assertNoLayoutBreak(page: import("@playwright/test").Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label} overflow`).toBeLessThanOrEqual(24);
}

test.describe("Section 09 partner notifications", () => {
  test("notification center and settings axe + canonical preferences", async ({ page, monitor }) => {
    await partnerLogin(page);

    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /notification/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    await assertAxeSerious(page, "partner notification center");

    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /^profile$/i })).toBeVisible({ timeout: 30_000 });
    await page.locator("nav").getByRole("button", { name: /^notifications$/i }).click();
    await expect(page.getByText(/choose how homeeigo reaches you/i)).toBeVisible({
      timeout: 30_000,
    });
    await assertAxeSerious(page, "partner notification settings");

    const token = await partnerToken();
    const mandatory = await fetch(`${API}/api/notifications/preferences`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "EMAIL", category: "SECURITY", enabled: false }),
    });
    expect(mandatory.status).toBe(422);

    const optionalOff = page.locator("#pref-OPTIONAL-PUSH, #pref-OPTIONAL-EMAIL, #pref-OPTIONAL-IN_APP").first();
    if (await optionalOff.isEnabled().catch(() => false)) {
      const save = page.waitForResponse(
        (r) => r.url().includes("/api/notifications/preferences") && r.request().method() === "PUT",
        { timeout: 15_000 },
      );
      await optionalOff.click();
      const saved = await save;
      expect(saved.status()).toBe(200);
      const after = await fetch(`${API}/api/notifications/preferences`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json()) as {
        data?: { matrix?: Array<{ category: string; channel: string; enabled: boolean }> };
      };
      expect((after.data?.matrix ?? []).some((c) => c.category === "OPTIONAL")).toBe(true);
    }

    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    monitor.assertClean();
  });

  test("12-width matrix for notifications and settings", async ({ page }) => {
    test.setTimeout(600_000);
    await partnerLogin(page);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await page.goto("/notifications", { waitUntil: "domcontentloaded" });
      await recoverDevChunkAbort(page);
      await expect(page.getByRole("heading", { name: /notification/i }).first()).toBeVisible({
        timeout: 30_000,
      });
      await assertNoLayoutBreak(page, `notifications ${vp.width}`);
      await page.screenshot({ path: path.join(ART, `notifications-${vp.width}.png`), fullPage: true });

      await page.goto("/settings", { waitUntil: "domcontentloaded" });
      await recoverDevChunkAbort(page);
      await expect(page.getByRole("heading", { name: /^profile$/i })).toBeVisible({ timeout: 30_000 });
      await page.locator("nav").getByRole("button", { name: /^notifications$/i }).click();
      await expect(page.getByText(/choose how homeeigo reaches you/i)).toBeVisible({
        timeout: 30_000,
      });
      await assertNoLayoutBreak(page, `settings ${vp.width}`);
      await page.screenshot({ path: path.join(ART, `settings-${vp.width}.png`), fullPage: true });
    }
  });
});
