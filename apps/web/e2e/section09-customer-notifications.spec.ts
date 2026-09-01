import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import fs from "node:fs";
import {
  test,
  SEED_CUSTOMER,
  gotoAuthedCustomer,
  apiLogin,
} from "./enterprise/fixtures";

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

const PARTNER_PRIVATE = /partner\.(sos|payout|incentive|referral|kyc|job)|homigo\.partner\./i;

async function assertAxeSerious(page: import("@playwright/test").Page, context: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(
    blocking,
    `${context}\n${JSON.stringify(blocking.map((v) => ({ id: v.id, impact: v.impact, help: v.help })), null, 2)}`,
  ).toEqual([]);
}

test.describe("Section 09 customer notifications", () => {
  test("settings and inbox use canonical APIs without partner leakage", async ({ page, monitor }) => {
    await gotoAuthedCustomer(page, "/settings", SEED_CUSTOMER);

    const session = await apiLogin(SEED_CUSTOMER.email, SEED_CUSTOMER.password);
    const matrixRes = await fetch(`${API}/api/notifications/preferences`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(matrixRes.status).toBe(200);
    const matrixJson = (await matrixRes.json()) as {
      data?: { matrix?: Array<{ category: string; mandatory: boolean; editable: boolean }> };
    };
    const security = (matrixJson.data?.matrix ?? []).filter((c) => c.category === "SECURITY");
    expect(security.length).toBeGreaterThan(0);
    expect(security.every((c) => c.mandatory && !c.editable)).toBe(true);

    const mandatoryDisable = await fetch(`${API}/api/notifications/preferences`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: "EMAIL", category: "SECURITY", enabled: false }),
    });
    expect(mandatoryDisable.status).toBe(422);

    await expect(page.getByText(/notification preferences/i)).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/booking confirmations, receipts, service updates and security codes are always sent/i),
    ).toBeVisible();
    await assertAxeSerious(page, "customer notification settings");

    const emailSwitch = page.getByRole("switch", { name: /email notifications/i });
    await expect(emailSwitch).toBeVisible();
    const before = await emailSwitch.getAttribute("aria-checked");
    const prefSave = page.waitForResponse(
      (r) => r.url().includes("/api/users/preferences") && r.request().method() === "PUT",
      { timeout: 20_000 },
    );
    await emailSwitch.click();
    expect((await prefSave).status()).toBe(200);
    const after = await emailSwitch.getAttribute("aria-checked");
    expect(after).not.toBe(before);

    const list = await fetch(`${API}/api/notifications?limit=50`, {
      headers: { Authorization: `Bearer ${session.token}` },
    }).then((r) => r.json()) as {
      data?: { notifications?: Array<{ type?: string; title?: string; message?: string }> };
    };
    const leaked = (list.data?.notifications ?? []).filter((n) =>
      PARTNER_PRIVATE.test(`${n.type ?? ""} ${n.title ?? ""} ${n.message ?? ""}`),
    );
    expect(leaked, JSON.stringify(leaked)).toEqual([]);

    await gotoAuthedCustomer(page, "/notifications", SEED_CUSTOMER);
    await expect(page.getByRole("heading", { name: /notification/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    await assertAxeSerious(page, "customer notification inbox");
    monitor.assertClean();
  });

  test("12-width matrix for customer notifications and settings", async ({ page }) => {
    test.setTimeout(600_000);
    await gotoAuthedCustomer(page, "/settings", SEED_CUSTOMER);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await gotoAuthedCustomer(page, "/settings", SEED_CUSTOMER);
      await expect(page.getByText(/notification preferences/i)).toBeVisible({ timeout: 30_000 });
      const overflowSettings = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflowSettings, `settings overflow at ${vp.width}`).toBeLessThanOrEqual(24);
      await page.screenshot({ path: path.join(ART, `settings-${vp.width}.png`), fullPage: true });

      await gotoAuthedCustomer(page, "/notifications", SEED_CUSTOMER);
      await expect(page.getByRole("heading", { name: /notification/i }).first()).toBeVisible({
        timeout: 30_000,
      });
      const overflowInbox = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflowInbox, `inbox overflow at ${vp.width}`).toBeLessThanOrEqual(24);
      await page.screenshot({ path: path.join(ART, `notifications-${vp.width}.png`), fullPage: true });
    }
  });
});
