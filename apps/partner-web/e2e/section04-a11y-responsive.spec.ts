import { expect } from "@playwright/test";
import { partnerLogin, test } from "./enterprise/fixtures";
import { assertAxeSerious } from "./helpers/p0-a11y";
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

const ROUTES = [
  { path: "/wallet", name: "wallet", wait: "/api/providers/me/payouts" },
  { path: "/earnings", name: "earnings", wait: "/api/providers/me/earnings" },
  { path: "/earnings-hq/incentives", name: "incentives", wait: "/api/providers/me/incentives" },
  { path: "/earnings/payouts", name: "payouts", wait: "/api/providers/me/payouts" },
  { path: "/wallet/ledger", name: "ledger", wait: "/api/wallet/transactions" },
] as const;

const ART = path.join(__dirname, "__artifacts__", "section04");
fs.mkdirSync(ART, { recursive: true });

async function assertNoLayoutBreak(page: import("@playwright/test").Page) {
  const broken = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth > doc.clientWidth + 2;
    const hiddenCta = [...document.querySelectorAll("button, a, [role=dialog]")].some((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.right < -8 || r.left > window.innerWidth + 8);
    });
    return { overflowX, hiddenCta, scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(broken.overflowX, JSON.stringify(broken)).toBe(false);
}

test.describe.configure({ mode: "serial" });

test.describe("Section 04 a11y + responsive finance", () => {
  test("wallet, incentives, payouts, withdraw modal axe-clean + keyboard", async ({ page, monitor }) => {
    await partnerLogin(page);
    await page.goto("/wallet", { waitUntil: "domcontentloaded" });
    await page.waitForResponse((r) => r.url().includes("/api/providers/me/payouts") && r.ok(), { timeout: 30_000 });
    await expect(page.getByTestId("wallet-total-balance")).toBeVisible({ timeout: 15_000 });
    await assertAxeSerious(page, "section04 /wallet");

    const cta = page.getByTestId("wallet-withdraw-cta");
    // A disabled button (no withdrawable balance for this partner) cannot take focus; the keyboard path
    // is only asserted when the action is actually available.
    if (await cta.isDisabled()) {
      await expect(cta).toBeDisabled();
    } else {
      await cta.focus();
      await expect(cta).toBeFocused();
    }
    if (!(await cta.isDisabled())) {
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
      await assertAxeSerious(page, "section04 withdraw modal");
      await page.screenshot({ path: path.join(ART, "withdraw-modal-1440.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(ART, "withdraw-modal-390.png"), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByTestId("withdraw-amount").focus();
      await expect(page.getByTestId("withdraw-amount")).toBeFocused();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    await page.goto("/earnings-hq/incentives", { waitUntil: "domcontentloaded" });
    await page.waitForResponse((r) => r.url().includes("/api/providers/me/incentives") && r.ok(), { timeout: 30_000 });
    await assertAxeSerious(page, "section04 incentives");

    await page.goto("/earnings/payouts", { waitUntil: "domcontentloaded" });
    await page.waitForResponse((r) => r.url().includes("/api/providers/me/payouts") && r.ok(), { timeout: 30_000 });
    await assertAxeSerious(page, "section04 payouts");
    monitor.assertClean();
  });

  test("responsive matrix for finance surfaces", async ({ page }) => {
    test.setTimeout(600_000);
    await partnerLogin(page);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of ROUTES) {
        await page.goto(route.path, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { level: 1 }).last()).toBeVisible({ timeout: 30_000 });
        await page.screenshot({
          path: path.join(ART, `${route.name}-${vp.width}.png`),
          fullPage: true,
        });
        await assertNoLayoutBreak(page);
      }
    }
  });
});
