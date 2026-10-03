import { expect } from "@playwright/test";
import { partnerLogin, test } from "./enterprise/fixtures";
import { assertAxeSerious } from "./helpers/p0-a11y";

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

const SCORE = {
  policyVersion: "partner.score.v1",
  overallScore: 92,
  band: "EXCELLENT",
  components: {
    quality: { value: 96, weight: 0.2 },
    reliability: { value: 94, weight: 0.15 },
    completion: { value: 98, weight: 0.2 },
    onTime: { value: 95, weight: 0.1 },
    customerSatisfaction: { value: 90, weight: 0.15 },
    compliance: { value: 100, weight: 0.1 },
    safety: { value: 100, weight: 0.1 },
  },
  sample: { completedJobs: 40, ratings: 20, arrivals: 38, assignments: 40 },
  calculatedAt: new Date().toISOString(),
  trends: {
    "7d": { delta: null, insufficient: true },
    "30d": { delta: -2, insufficient: false },
    "90d": { delta: 1, insufficient: false },
  },
};

async function mockSection06(page: import("@playwright/test").Page) {
  await page.route("**/api/providers/me/score**", async (route) => {
    const url = route.request().url();
    if (url.includes("/history")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            items: [
              {
                id: "h1",
                previousScore: 94,
                newScore: 92,
                previousBand: "EXCELLENT",
                newBand: "EXCELLENT",
                delta: -2,
                reasons: [{ code: "COMPONENT_DOWN", component: "onTime", delta: -2, detail: "1 late arrival", evidenceCount: 1 }],
                calculatedAt: new Date().toISOString(),
              },
            ],
            page: 1,
            total: 1,
          },
        }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: SCORE }) });
  });
  await page.route("**/api/providers/me/career**", async (route) => {
    const url = route.request().url();
    if (url.includes("/history")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { items: [], page: 1, total: 0 } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          currentLevel: "PROFESSIONAL",
          nextLevel: "EXPERT",
          progressPct: 50,
          remainingRequirements: [{ id: "jobs", label: "Completed jobs", current: 18, target: 30, met: false, unit: "jobs" }],
          requirements: [
            { id: "jobs", label: "Completed jobs", current: 18, target: 30, met: false, unit: "jobs" },
            { id: "rating", label: "Rating", current: 4.5, target: 4.5, met: true, unit: "rating" },
            { id: "completion", label: "Completion rate", current: 95, target: 95, met: true, unit: "percent" },
            { id: "cert", label: "Certification or academy module", current: 0, target: 1, met: false, unit: "count" },
          ],
          qualificationState: "IN_PROGRESS",
          benefitsActive: true,
          careerPriorityBoost: 4,
          badges: [{ code: "trusted", label: "Reliable Partner", awardedAt: new Date().toISOString(), reason: "trusted" }],
        },
      }),
    });
  });
  await page.route("**/api/providers/me/lifecycle**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          lifecycleState: "ACTIVE",
          allowedTransitions: ["PAUSED", "UNDER_REVIEW"],
          dispatchEligible: true,
          availability: { isOnline: false, pausedAt: null, currentStatus: "offline" },
          isApproved: true,
          isActive: true,
        },
      }),
    });
  });
}

test.describe("Section 06 scorecard a11y + responsive", () => {
  test("score and career have no serious axe issues", async ({ page }) => {
    await mockSection06(page);
    await partnerLogin(page);
    await page.goto("/performance-hq/scorecard");
    await expect(page.getByRole("heading", { name: /partner score/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("/100")).toBeVisible();
    await expect(page.getByText("Why did my score change?")).toBeVisible();
    await assertAxeSerious(page, "section06-scorecard");
    await page.goto("/performance-hq/career");
    await expect(page.getByRole("heading", { name: "Career" })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "Progress to next career level" })).toBeVisible();
    await assertAxeSerious(page, "section06-career");
  });

  for (const vp of VIEWPORTS) {
    test(`scorecard ${vp.width}x${vp.height} no overflow`, async ({ page }) => {
      await page.setViewportSize(vp);
      await partnerLogin(page);
      await mockSection06(page);
      await page.goto("/performance-hq/scorecard");
      await expect(page.getByRole("heading", { name: /partner score/i })).toBeVisible({ timeout: 30_000 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      expect(overflow).toBe(false);
    });
  }
});
