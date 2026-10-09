/**
 * Phase 15 admin browser proof — the real admin console against the isolated stack.
 *
 * Fixtures: apps/backend/scripts/e2e-phase15-console-seed.ts (isolated database only). The seed
 * writes one IST day of bookings with known business KPIs plus a TEST-origin booking that must not
 * move them. Run:
 *
 *   cd apps/backend && NODE_ENV=test bun --env-file=.env.test run scripts/e2e-phase15-console-seed.ts <run> <seed.json>
 *   cd apps/admin-panel && E2E_SKIP_SERVERS=1 E2E_API_URL=http://127.0.0.1:3100 E2E_ADMIN_URL=http://127.0.0.1:3018 \
 *     P15_SEED_FILE=<seed.json> npx playwright test e2e/phase15-analytics-console.spec.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { attachEnterpriseMonitor } from "./enterprise/fixtures";

type Seed = {
  database: string;
  day: string;
  password: string;
  superAdmin: { email: string };
  expected: { completionPct: number; cancellationPct: number; repeatPct: number; quoteToBookingPct: number; capturedGmv: number };
};

const SEED_FILE = process.env.P15_SEED_FILE;
const seed: Seed | null = SEED_FILE ? JSON.parse(readFileSync(SEED_FILE, "utf8")) : null;
const SHOTS = path.join(__dirname, "../test-results/phase15-admin");
const MISLEADING = /Growth Rate|NaN|Infinity|undefined%|null%/;

async function login(page: Page, s: Seed) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const email = page.locator("#admin-email");
  const password = page.locator("#admin-password");
  await expect(email).toBeEnabled({ timeout: 60_000 });
  await email.click();
  await email.pressSequentially(s.superAdmin.email, { delay: 10 });
  await password.click();
  await password.pressSequentially(s.password, { delay: 10 });
  const res = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/auth/login"));
  await page.getByRole("button", { name: /enter business hq/i }).click();
  expect((await res).status()).toBe(200);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
}

async function setRange(page: Page, from: string, to: string) {
  await page.getByRole("button", { name: /^custom$/i }).click();
  const analytics = page.waitForResponse((r) => r.url().includes("/api/admin/analytics") && r.url().includes(`startDate=${from}`) && r.url().includes(`endDate=${to}`), { timeout: 60_000 });
  await page.getByLabel("To", { exact: true }).fill(to);
  await page.getByLabel("From", { exact: true }).fill(from);
  const res = await analytics;
  expect(res.status()).toBe(200);
  return (await res.json()) as { data: { metrics: Record<string, number | null> } };
}

test.describe.serial("Phase 15 admin analytics console", () => {
  test.describe.configure({ timeout: 480_000 });
  test.beforeAll(() => {
    if (!seed) throw new Error("P15_SEED_FILE is required (see the header for the seed command)");
    expect(seed.database).toMatch(/test/);
  });

  test("analytics KPIs render the governed values, and an empty window renders as unmeasured", async ({ page }) => {
    const s = seed!;
    const monitor = attachEnterpriseMonitor(page);
    await login(page, s);

    const first = page.waitForResponse((r) => r.url().includes("/api/admin/analytics"), { timeout: 60_000 });
    await page.goto("/analytics", { waitUntil: "domcontentloaded" });
    expect((await first).status()).toBe(200);
    const main = page.locator("main");
    for (const label of ["Captured GMV", "Completed jobs", "Cancellations", "Repeat customers", "Quote to booking"]) {
      await expect(main.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    }

    const body = await setRange(page, s.day, s.day);
    expect(body.data.metrics.completionRatePct).toBe(s.expected.completionPct);
    expect(body.data.metrics.quoteToBookingPct).toBe(s.expected.quoteToBookingPct);
    await expect(main).toContainText(`${s.expected.completionPct.toFixed(1)}% of finished bookings`);
    await expect(main).toContainText(`${s.expected.cancellationPct.toFixed(1)}% of finished bookings`);
    await expect(main.getByText("Repeat customers", { exact: true }).first().locator("xpath=ancestor::*[contains(., '%')][1]")).toContainText(`${s.expected.repeatPct.toFixed(1)}%`);
    await expect(main.getByText("Quote to booking", { exact: true }).first().locator("xpath=ancestor::*[contains(., '%')][1]")).toContainText(`${s.expected.quoteToBookingPct.toFixed(1)}%`);
    await expect(main.getByText("Captured GMV", { exact: true }).first().locator("xpath=ancestor::*[contains(., '₹')][1]")).toContainText(String(s.expected.capturedGmv));
    // The TEST-origin ₹999 booking is in the same day and must not appear in the business total.
    await expect(main).not.toContainText("999");
    await expect(main).not.toContainText(MISLEADING);
    await page.screenshot({ path: `${SHOTS}/analytics-known-day.png`, fullPage: true });

    const empty = await setRange(page, "1999-01-01", "1999-01-01");
    expect(empty.data.metrics.completionRatePct).toBeNull();
    expect(empty.data.metrics.quoteToBookingPct).toBeNull();
    await expect(main.getByText("Repeat customers", { exact: true }).first().locator("xpath=ancestor::*[contains(., '—')][1]")).toContainText("—");
    await expect(main.getByText("Quote to booking", { exact: true }).first().locator("xpath=ancestor::*[contains(., '—')][1]")).toContainText("—");
    await expect(main).not.toContainText(MISLEADING);
    await page.screenshot({ path: `${SHOTS}/analytics-empty-window.png`, fullPage: true });

    monitor.assertClean();
  });

  test("executive, bookings, vendors and reviews surfaces carry the Phase 15 labels", async ({ page }) => {
    const s = seed!;
    const monitor = attachEnterpriseMonitor(page);
    await login(page, s);

    const surfaces: Array<{ route: string; labels: string[] }> = [
      { route: "/", labels: ["Captured GMV", "Net captured", "Bookings", "Completion", "Partner rating"] },
      { route: "/bookings", labels: ["Completion", "Cancellation"] },
      { route: "/vendors", labels: ["Completion"] },
      { route: "/reviews", labels: [] },
    ];
    for (const { route, labels } of surfaces) {
      // A dev-server compile can abort the first navigation; one retry, a real failure still fails.
      await page.goto(route, { waitUntil: "domcontentloaded" }).catch(() => page.goto(route, { waitUntil: "domcontentloaded" }));
      const main = page.locator("main");
      await expect(main).toBeVisible({ timeout: 60_000 });
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
      for (const label of labels) await expect(main.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
      await expect(main).not.toContainText(MISLEADING);
      // "Avg rating" was ambiguous between partner rating and review rating.
      await expect(main.getByText(/^Avg rating$/)).toHaveCount(0);
      // Completion must never be labelled as utilisation or growth.
      await expect(main.getByText(/^(Growth Rate|Utili[sz]ation)$/i)).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/surface${route === "/" ? "-home" : route.replace(/\//g, "-")}.png`, fullPage: true });
      if (route === "/") {
        await expect(main.getByText("All time ·", { exact: false }).first()).toBeVisible();
        await page.getByText("Weekly", { exact: true }).first().click();
        await expect(main.getByText("Cancellation", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
        await expect(main.getByText("Cancelled over finished bookings").first()).toBeVisible();
        await page.screenshot({ path: `${SHOTS}/surface-home-weekly.png`, fullPage: true });
      }
    }

    monitor.assertClean();
  });
});
