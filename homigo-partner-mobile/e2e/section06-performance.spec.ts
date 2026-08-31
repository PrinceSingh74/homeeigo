import { test, expect } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PARTNER = { email: "partner@homigo.demo", password: "Homigo@123" };

async function partnerLogin(page: import("@playwright/test").Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (document.querySelector("#root")?.childElementCount ?? 0) > 0, {
    timeout: 90_000,
  });
  await expect(page.getByText("Partner sign in")).toBeVisible({ timeout: 90_000 });
  await page.getByPlaceholder("partner@example.com").fill(PARTNER.email);
  await page.locator('input[type="password"]').fill(PARTNER.password);
  const login = page.waitForResponse(
    (r) => r.url().includes("/api/auth/login") && r.request().method() === "POST",
    { timeout: 60_000 },
  );
  await page.getByText("Continue to Partner OS").click();
  expect((await login).ok()).toBeTruthy();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 45_000 });
}

test.describe("Section 06 Expo Performance HQ live", () => {
  test("score, explanation, career, badges, lifecycle from live APIs", async ({ page }) => {
    test.setTimeout(240_000);
    const auth = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...PARTNER, setAuthCookies: false }),
    });
    const token = ((await auth.json()) as { data?: { accessToken?: string } }).data?.accessToken ?? "";
    expect(token.length).toBeGreaterThan(20);
    const headers = { Authorization: `Bearer ${token}` };
    const [scoreRes, careerRes, lifeRes] = await Promise.all([
      fetch(`${API}/api/providers/me/score`, { headers }),
      fetch(`${API}/api/providers/me/career`, { headers }),
      fetch(`${API}/api/providers/me/lifecycle`, { headers }),
    ]);
    expect(scoreRes.ok).toBeTruthy();
    expect(careerRes.ok).toBeTruthy();
    expect(lifeRes.ok).toBeTruthy();
    const score = (await scoreRes.json()) as { data?: { overallScore?: number | null; band?: string; policyVersion?: string } };
    const career = (await careerRes.json()) as { data?: { currentLevel?: string; careerPriorityBoost?: number } };
    const life = (await lifeRes.json()) as { data?: { lifecycleState?: string } };
    expect(score.data?.policyVersion).toBe("partner.score.v1");
    expect(score.data?.overallScore).not.toBeNull();
    expect(career.data?.currentLevel).toBeTruthy();
    expect(life.data?.lifecycleState).toBeTruthy();

    await partnerLogin(page);

    await page.goto("/hq/performance-scorecard", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Score")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(String(Math.round(score.data!.overallScore!)))).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Why did my score change/i)).toBeVisible();
    await expect(page.getByText(new RegExp(life.data!.lifecycleState!, "i"))).toBeVisible();
    await page.screenshot({ path: "e2e/__artifacts__/section06-expo-score.png", fullPage: true });

    await page.goto("/hq/performance-career", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Career")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(career.data!.currentLevel!)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Requirements|Badges|Priority boost/i).first()).toBeVisible();
    await page.screenshot({ path: "e2e/__artifacts__/section06-expo-career.png", fullPage: true });
  });
});
