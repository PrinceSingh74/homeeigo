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

const ART = path.join(__dirname, "__artifacts__", "section07");
fs.mkdirSync(ART, { recursive: true });

async function assertNoLayoutBreak(page: import("@playwright/test").Page, width: number) {
  const broken = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth > doc.clientWidth + 8;
    const hiddenCta = [...document.querySelectorAll("button, a")].some((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.right < -8 || r.left > window.innerWidth + 8);
    });
    return { overflowX, hiddenCta, scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(broken.overflowX, `overflow at ${width}: ${JSON.stringify(broken)}`).toBe(false);
}

test.describe.configure({ mode: "serial" });

test.describe("Section 07 partner network live", () => {
  test("authenticated dashboard, invite, funnel, progress, axe, 12 viewports", async ({ page, monitor }) => {
    const networkRes = page.waitForResponse(
      (r) => r.url().includes("/api/providers/me/network") && r.request().method() === "GET" && r.status() === 200,
      { timeout: 60_000 },
    );
    await partnerLogin(page);
    await page.goto("/rewards/referrals", { waitUntil: "domcontentloaded" });
    const net = await networkRes;
    const payload = (await net.json()) as {
      data?: {
        code?: string;
        referrals?: Array<{ jobs: number; jobTarget: number; status: string; rewardAmount: number | null }>;
      };
    };
    expect(payload.data?.code?.startsWith("HP")).toBeTruthy();

    await expect(page.getByRole("heading", { name: /partner network/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(payload.data!.code!, { exact: true })).toBeVisible();
    for (const label of ["Invited", "Registered", "Verified", "Training", "Active", "First job", "Qualified", "Rewarded"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /copy invite link/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /send invite/i })).toBeVisible();

    const rewarded = payload.data?.referrals?.find((r) => r.status === "REWARD_RELEASED");
    if (rewarded) {
      await expect(page.getByText(`${rewarded.jobs} of ${rewarded.jobTarget} jobs`).first()).toBeVisible();
      await expect(page.getByText(/₹\s*500/).first()).toBeVisible();
    }

    const uniquePhone = `98${Date.now().toString().slice(-8)}`;
    await page.getByLabel(/full name/i).fill(`E2E Invite ${uniquePhone.slice(-4)}`);
    await page.getByLabel(/mobile/i).fill(uniquePhone);
    const inviteRes = page.waitForResponse(
      (r) => r.url().includes("/api/providers/me/network/invite") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: /send invite/i }).click();
    const invited = await inviteRes;
    expect(invited.status(), "live invite API").toBe(200);

    await assertAxeSerious(page, "partner network");

    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await expect(page.getByRole("heading", { name: /partner network/i })).toBeVisible();
      await assertNoLayoutBreak(page, vp.width);
      await page.screenshot({
        path: path.join(ART, `partner-network-${vp.width}.png`),
        fullPage: true,
      });
    }
    monitor.assertClean();
  });
});
