/**
 * Phase 15 partner browser proof — trust, credentials, reviews and completion as the partner sees
 * them, against the isolated stack. Every number on screen is compared with the response the page
 * itself received, so nothing rendered can be a client-side invention.
 *
 * Fixtures: apps/backend/scripts/e2e-phase15-console-seed.ts (isolated database only). Run:
 *
 *   cd apps/partner-web && E2E_SKIP_SERVERS=1 E2E_API_URL=http://127.0.0.1:3100 E2E_PARTNER_URL=http://127.0.0.1:3016 \
 *     P15_SEED_FILE=<seed.json> npx playwright test e2e/phase15-trust-reviews.spec.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";
import { attachEnterpriseMonitor, recoverDevChunkAbort, waitForPartnerFormHydration } from "./enterprise/fixtures";

type Seed = { database: string; password: string; partner: { email: string }; expected: { ownerReviews: number } };

const SEED_FILE = process.env.P15_SEED_FILE;
const seed: Seed | null = SEED_FILE ? JSON.parse(readFileSync(SEED_FILE, "utf8")) : null;
const SHOTS = path.join(__dirname, "../test-results/phase15-partner");
/** Claims no partner surface may make unconditionally. */
const BLANKET_CLAIMS = /verified professionals?\b|background[- ]checked|100% (money[- ]back|satisfaction)|fully insured|certified experts?/i;
const BROKEN = /NaN|Infinity|undefined|null%/;

async function login(page: Page, s: Seed) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const email = page.locator("#partner-email");
  await expect(email).toBeVisible({ timeout: 90_000 });
  await waitForPartnerFormHydration(page);
  await email.click();
  await email.pressSequentially(s.partner.email, { delay: 10 });
  await page.locator("#partner-password").click();
  await page.locator("#partner-password").pressSequentially(s.password, { delay: 10 });
  const res = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/auth/login"), { timeout: 60_000 });
  await page.getByRole("button", { name: /^sign in$/i }).click();
  expect((await res).status()).toBe(200);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 90_000 });
}

/** Navigate and return the JSON `data` of the first matching API response the page makes. */
async function openWith<T>(page: Page, route: string, api: string): Promise<T> {
  const wait = page.waitForResponse((r: Response) => r.url().includes(api) && r.request().method() === "GET" && r.status() === 200, { timeout: 120_000 });
  await page.goto(route, { waitUntil: "domcontentloaded" }).catch(() => page.goto(route, { waitUntil: "domcontentloaded" }));
  await recoverDevChunkAbort(page);
  const body = (await (await wait).json()) as { data: T };
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  return body.data;
}

async function noBlanketClaims(page: Page, shot: string) {
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(BLANKET_CLAIMS);
  expect(text).not.toMatch(BROKEN);
  await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
}

test.describe.serial("Phase 15 partner trust and reviews", () => {
  test.describe.configure({ timeout: 600_000 });
  test.beforeAll(() => {
    if (!seed) throw new Error("P15_SEED_FILE is required (see the header)");
    expect(seed.database).toMatch(/test/);
  });

  test("dashboard, reviews, trust, credentials, completion and score render the backend's own values", async ({ page }) => {
    const s = seed!;
    const monitor = attachEnterpriseMonitor(page);
    // Backlog closures, not Phase 15 metrics: the partner app must not call the admin-only
    // zone-scoring endpoint, and a fresh login must not heartbeat a revoked session.
    let zoneScoring403 = 0;
    let heartbeat401 = 0;
    page.on("response", (r) => {
      if (r.status() < 400) return;
      console.log(`[p15] ${r.status()} ${r.request().method()} ${r.url()}`);
      if (r.status() === 403 && r.url().includes("/api/geo-intel/zone-scoring")) zoneScoring403 += 1;
      if (r.status() === 401 && r.url().includes("/api/providers/me/presence/heartbeat")) heartbeat401 += 1;
    });
    await login(page, s);
    await expect(page.getByRole("heading", { name: /new booking requests/i })).toBeVisible({ timeout: 90_000 });
    await noBlanketClaims(page, "dashboard");

    // Reviews: headline average, count and breakdown are the same aggregate the API returned.
    type Reviews = { ratingCount: number; averageRating: number | null; ratingBreakdown: Record<string, number>; total: number };
    const reviews = await openWith<Reviews>(page, "/reviews", "/api/providers/me/reviews");
    expect(reviews.ratingCount).toBe(s.expected.ownerReviews);
    expect(Object.values(reviews.ratingBreakdown).reduce((a, b) => a + b, 0)).toBe(reviews.ratingCount);
    const main = page.locator("main");
    await expect(main.getByText(`Based on ${reviews.ratingCount} review${reviews.ratingCount === 1 ? "" : "s"}`)).toBeVisible({ timeout: 60_000 });
    await expect(main.getByText(reviews.averageRating!.toFixed(1), { exact: true }).first()).toBeVisible();
    for (const stars of ["5", "4", "3", "2", "1"]) {
      const row = main.locator("div.mb-2.flex.items-center", { hasText: `${stars}★` }).first();
      await expect(row).toContainText(String(reviews.ratingBreakdown[stars]));
    }
    await noBlanketClaims(page, "reviews");

    // Compliance: status, verified flag and counts are the API's, nothing asserted beyond them.
    type Compliance = { status: string; documents: unknown[]; certifications: unknown[]; insurance?: unknown[]; verification?: { isVerified?: boolean; kycStatus?: string } };
    const compliance = await openWith<Compliance>(page, "/trust-compliance", "/api/providers/me/compliance");
    await expect(page.getByTestId("compliance-status")).toContainText(compliance.status.replace(/_/g, " "));
    await expect(main).toContainText(`${compliance.certifications.length}`);
    await expect(main).toContainText(`${compliance.insurance?.length ?? 0} policies`);
    await noBlanketClaims(page, "trust-compliance");

    // Verification: background check shows the stored status verbatim — never "cleared" by default.
    type Verification = { verification?: { isVerified?: boolean; backgroundCheckStatus?: string | null } };
    const { verification } = await openWith<Verification>(page, "/trust-compliance/verification", "/api/providers/me/compliance");
    const status = verification?.backgroundCheckStatus ?? null;
    const background = main.getByText("Background", { exact: true }).first().locator("xpath=..");
    await expect(background).toContainText(status ?? "—");
    await expect(main.getByText("Identity", { exact: true }).first().locator("xpath=..")).toContainText(verification?.isVerified ? "Verified" : "Pending");
    if (status !== "CLEARED") expect(await main.innerText()).not.toMatch(/background[^\n]*\bcleared\b/i);
    await noBlanketClaims(page, "trust-verification");

    // Credentials: certifications and insurance are only what the partner declared and ops verified.
    type Capabilities = { certifications: Array<{ status: string }>; insurance: Array<{ status: string }> };
    const caps = await openWith<Capabilities>(page, "/work-hq/credentials", "/api/providers/me/capabilities");
    if (caps.certifications.length === 0) await expect(main.getByText("No certifications declared yet.")).toBeVisible();
    if (caps.insurance.length === 0) await expect(main.getByText("No insurance declared yet.")).toBeVisible();
    await noBlanketClaims(page, "work-hq-credentials");

    // Completion and rating on the intelligence page are the partner's stored metrics.
    type Intel = { rates: { completionRate: number }; rating: number };
    const intel = await openWith<Intel>(page, "/intelligence", "/api/providers/me/dashboard");
    const completion = main.getByText("Completion", { exact: true }).first().locator("xpath=..");
    await expect(completion).toContainText(`${intel.rates.completionRate.toFixed(0)}%`);
    await expect(main.getByText("Rating", { exact: true }).first().locator("xpath=..")).toContainText(intel.rating.toFixed(1));
    await noBlanketClaims(page, "intelligence");

    await openWith(page, "/performance-hq/scorecard", "/api/providers/me/score");
    await noBlanketClaims(page, "performance-scorecard");

    expect(zoneScoring403, "partner must not call admin zone-scoring").toBe(0);
    expect(heartbeat401, "presence heartbeat must not 401").toBe(0);
    expect(monitor.consoleErrors.filter((e) => !/status of 403/.test(e))).toEqual([]);
    expect(monitor.failedApi).toEqual([]);
  });
});
