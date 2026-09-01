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

const ART = path.join(__dirname, "__artifacts__", "section08");
fs.mkdirSync(ART, { recursive: true });

async function assertNoLayoutBreak(page: import("@playwright/test").Page, width: number) {
  const broken = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflowX = doc.scrollWidth > doc.clientWidth + 8;
    return { overflowX, scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(broken.overflowX, `overflow at ${width}: ${JSON.stringify(broken)}`).toBe(false);
}

test.describe.configure({ mode: "serial" });

test.describe("Section 08 partner intelligence", () => {
  test("AI assistant, demand, earnings coach, intelligence, axe, viewports", async ({ page, monitor }) => {
    test.setTimeout(360_000);
    await partnerLogin(page);

    const chatRes = page.waitForResponse(
      (r) => r.url().includes("/api/ai/partner") && r.request().method() === "POST",
      { timeout: 60_000 },
    );
    await page.goto("/ai", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /ai assistant/i })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel(/ask the partner copilot/i).fill("How much did I earn this week?");
    await page.getByRole("button", { name: /send/i }).click();
    const chat = await chatRes;
    expect(chat.status(), "partner AI").toBe(200);
    const payload = (await chat.json()) as { success?: boolean; data?: { content?: string; mode?: string } };
    expect(payload.success).toBe(true);
    expect(payload.data?.content?.length).toBeGreaterThan(10);
    await expect(page.getByText(payload.data!.content!.slice(0, 24), { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.goto("/ai-hq/demand-forecast", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /demand forecast/i })).toBeVisible({ timeout: 30_000 });

    await page.goto("/ai-hq/earnings-coach", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /earnings intelligence/i })).toBeVisible({ timeout: 30_000 });

    await page.goto("/intelligence", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /earnings intelligence/i })).toBeVisible({ timeout: 30_000 });

    await page.goto("/territory-hq", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /territory hq/i })).toBeVisible({ timeout: 30_000 });

    await page.goto("/ai-hq/route-optimization", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /route/i })).toBeVisible({ timeout: 30_000 });

    await page.goto("/ai", { waitUntil: "domcontentloaded" });
    await page.getByLabel(/ask the partner copilot/i).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Escape");
    await assertAxeSerious(page, "section08-ai");

    for (const vp of VIEWPORTS) {
      await page.setViewportSize(vp);
      await assertNoLayoutBreak(page, vp.width);
      await page.screenshot({ path: path.join(ART, `ai-${vp.width}.png`) });
    }

    monitor.assertClean();
  });
});
