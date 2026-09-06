import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { adminLogin, adminApiToken, test } from "./enterprise/fixtures";
import path from "node:path";
import fs from "node:fs";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ART = path.join(__dirname, "__artifacts__", "section04");
fs.mkdirSync(ART, { recursive: true });

async function assertAxeSerious(page: import("@playwright/test").Page, context: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(blocking, `${context}\n${JSON.stringify(blocking.map((v) => v.id))}`).toEqual([]);
}

const FINANCE_ROUTES = [
  { path: "/finance/dashboard", wait: "/api/admin/finance/dashboard", name: "dashboard" },
  { path: "/finance/payouts", wait: "/api/admin/finance/payouts", name: "payouts" },
  { path: "/finance/reconciliation", wait: "/api/admin/finance/reconciliation", name: "reconciliation" },
  { path: "/finance/settlement-sync", wait: "/api/admin/finance/settlement-sync", name: "settlement" },
] as const;

test.describe("Section 04 admin finance E2E", () => {
  test("CFO dashboard, payouts, reconciliation, settlement load backend data", async ({ page, monitor }) => {
    await adminLogin(page);
    for (const route of FINANCE_ROUTES) {
      const wait = page.waitForResponse((r) => r.url().includes(route.wait) && r.ok(), { timeout: 45_000 });
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      const res = await wait;
      expect(res.ok()).toBe(true);
      await page.screenshot({ path: path.join(ART, `admin-${route.name}-1440.png`), fullPage: true });
    }
    monitor.assertClean();
  });

  test("finance dashboard axe-clean at desktop", async ({ page, monitor }) => {
    await adminLogin(page);
    await page.goto("/finance/dashboard", { waitUntil: "domcontentloaded" });
    await page.waitForResponse((r) => r.url().includes("/api/admin/finance/dashboard") && r.ok(), { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /cfo dashboard/i })).toBeVisible({ timeout: 15_000 });
    await assertAxeSerious(page, "admin finance dashboard");
    monitor.assertClean();
  });

  test("responsive matrix for admin finance surfaces", async ({ page }) => {
    test.setTimeout(600_000);
    const viewports = [
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
      { width: 320, height: 568 },
    ] as const;
    await adminLogin(page);
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of FINANCE_ROUTES) {
        await page.goto(route.path, { waitUntil: "domcontentloaded" });
        const nextOverlay = page.locator("[data-nextjs-dialog], nextjs-portal").or(
          page.getByRole("heading", { name: /^runtime error$/i }),
        );
        if (await nextOverlay.first().isVisible({ timeout: 800 }).catch(() => false)) {
          const overlayText = (await nextOverlay.first().textContent().catch(() => "")) ?? "";
          throw new Error(
            `Next overlay blocked ${route.path}@${vp.width} (not a missing h1): ${overlayText.slice(0, 400)}`,
          );
        }
        await expect(page.locator("h1")).toBeVisible({ timeout: 30_000 });
        await page.screenshot({
          path: path.join(ART, `admin-${route.name}-${vp.width}.png`),
          fullPage: true,
        });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
        );
        expect(overflow, `${route.name}@${vp.width}`).toBe(false);
      }
    }
  });

  test("integrity validate endpoint reports from backend", async () => {
    const token = await adminApiToken();
    expect(token.length).toBeGreaterThan(10);
    const res = await fetch(`${API}/api/admin/finance/integrity/validate`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.ok).toBe(true);
    const json = (await res.json()) as { success?: boolean; data?: { ok?: boolean; issues?: unknown[] } };
    expect(json.success).toBe(true);
  });

  test("authenticated admin finance APIs succeed; unauthenticated and partner are denied", async () => {
    const adminToken = await adminApiToken();
    const adminRes = await fetch(`${API}/api/admin/finance/dashboard`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(adminRes.ok, `admin dashboard ${adminRes.status}`).toBe(true);

    const unauth = await fetch(`${API}/api/admin/finance/dashboard`);
    expect([401, 403]).toContain(unauth.status);

    const partnerLogin = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "partner@homigo.demo",
        password: "Homigo@123",
        setAuthCookies: false,
      }),
    });
    const partnerJson = (await partnerLogin.json()) as { data?: { accessToken?: string } };
    const partnerToken = partnerJson.data?.accessToken ?? "";
    expect(partnerToken.length).toBeGreaterThan(10);
    const partnerRes = await fetch(`${API}/api/admin/finance/payouts`, {
      headers: { Authorization: `Bearer ${partnerToken}` },
    });
    expect([401, 403]).toContain(partnerRes.status);
  });

  test("payouts UI matches backend for a known withdrawal", async ({ page }) => {
    const token = await adminApiToken();
    const apiRes = await fetch(`${API}/api/admin/finance/payouts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(apiRes.ok).toBe(true);
    const apiJson = (await apiRes.json()) as {
      data?: {
        payouts?: Array<{ withdrawalNumber?: string; netAmount?: number; amount?: number }>;
        queue?: Array<{ withdrawalNumber?: string; netAmount?: number; amount?: number }>;
      };
    };
    const row = (apiJson.data?.queue ?? []).find((r) => r.withdrawalNumber) ??
      (apiJson.data?.payouts ?? []).find((r) => r.withdrawalNumber);
    expect(row, "expected at least one withdrawal in finance payouts").toBeTruthy();
    const number = String(row!.withdrawalNumber).slice(0, 12);
    await adminLogin(page);
    await page.goto("/finance/payouts", { waitUntil: "domcontentloaded" });
    await page.waitForResponse((r) => r.url().includes("/api/admin/finance/payouts") && r.ok(), { timeout: 45_000 });
    await expect(page.getByText(number, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  });

  test("payments (earnings) and academy incentives load backend data", async ({ page, monitor }) => {
    await adminLogin(page);
    const paymentsWait = page.waitForResponse(
      (r) => r.url().includes("/api/admin/finance/dashboard") && r.ok(),
      { timeout: 45_000 },
    );
    await page.goto("/payments", { waitUntil: "domcontentloaded" });
    expect((await paymentsWait).ok()).toBe(true);
    await page.screenshot({ path: path.join(ART, "admin-earnings-1440.png"), fullPage: true });

    const incentivesWait = page.waitForResponse(
      (r) => r.url().includes("/api/admin/incentives") && r.ok(),
      { timeout: 45_000 },
    );
    await page.goto("/academy", { waitUntil: "domcontentloaded" });
    expect((await incentivesWait).ok()).toBe(true);
    await page.screenshot({ path: path.join(ART, "admin-incentives-1440.png"), fullPage: true });
    monitor.assertClean();
  });
});
