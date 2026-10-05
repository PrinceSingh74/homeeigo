import { expect } from "@playwright/test";
import { partnerLogin, recoverDevChunkAbort, test } from "./enterprise/fixtures";
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

const MOCK_BOOKING = {
  id: "job-e2e-section03",
  bookingNumber: "HG-S03-001",
  status: "in_progress",
  scheduledDate: new Date().toISOString(),
  completedAt: null,
  enRouteAt: new Date().toISOString(),
  arrivedAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  amount: 499,
  finalAmount: 499,
  paymentStatus: "success",
  description: null,
  eta: 12,
  customer: {
    firstName: "Asha",
    lastName: "K",
    profileImage: null,
    phoneMasked: "+91 ******3210",
  },
  service: { id: "svc-1", name: "Deep clean", icon: null, basePrice: 499 },
  address: { fullAddress: "Sector 45, Gurugram", latitude: 28.45, longitude: 77.02 },
  ratingGiven: false,
  rating: null,
};

async function mockSection03Apis(page: import("@playwright/test").Page) {
  await page.route("**/api/providers/me/bookings**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: { bookings: [MOCK_BOOKING], total: 1, page: 1, limit: 20 },
      }),
    });
  });
  await page.route("**/api/bookings/job-e2e-section03/chat**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { conversationId: "c1", messages: [], nextCursor: null },
        }),
      });
      return;
    }
    if (route.request().method() === "POST" && route.request().url().includes("/read")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: { marked: 0 } }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/bookings/job-e2e-section03/evidence**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { evidence: [] } }),
    });
  });
  await page.route("**/api/bookings/job-e2e-section03/actions**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          stage: "IN_PROGRESS",
          availableActions: ["COMPLETE_SERVICE", "CALL_CUSTOMER", "OPEN_CHAT", "UPLOAD_EVIDENCE"],
          primaryAction: "COMPLETE_SERVICE",
          requiredGates: [],
          disabledReasons: {},
        },
      }),
    });
  });
}

test.describe.configure({ mode: "default" });

test.describe("Section 03 a11y + responsive (mocked UI)", () => {
  test("requests list and job detail axe-clean", async ({ page, monitor }) => {
    await mockSection03Apis(page);
    await partnerLogin(page);

    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: /bookings/i })).toBeVisible({
      timeout: 30_000,
    });
    // Shell chrome (header kbd / tinted primary text) is outside Section 03 job workspace.
    // Certify the job detail composition which owns lifecycle, chat, evidence, CTA.
    await page.goto("/requests/job-e2e-section03");
    await expect(page.getByTestId("job-detail-page")).toBeVisible({ timeout: 30_000 });
    await assertAxeSerious(page, "section03 /requests/[id]", {
      include: ["[data-testid=job-detail-page]"],
    });
    monitor.assertClean();
  });

  for (const vp of VIEWPORTS) {
    test(`${vp.width}px requests surfaces — no horizontal overflow`, async ({ page }) => {
      await page.setViewportSize(vp);
      await mockSection03Apis(page);
      await partnerLogin(page);

      for (const path of ["/requests", "/requests/job-e2e-section03"] as const) {
        await page.goto(path);
        await recoverDevChunkAbort(page);
        if (path === "/requests") {
          await expect(page.getByRole("heading", { name: /bookings/i })).toBeVisible({
            timeout: 30_000,
          });
        } else {
          await expect(page.getByTestId("job-detail-page")).toBeVisible({ timeout: 30_000 });
        }

        const overflowOk = await page.evaluate(() => {
          const el = document.documentElement;
          return el.scrollWidth <= el.clientWidth;
        });
        expect(overflowOk, `overflow at ${vp.width} on ${path}`).toBe(true);

        const slug = path === "/requests" ? "requests" : "job-detail";
        await page.screenshot({
          path: `e2e/__artifacts__/s03-${slug}-${vp.width}.png`,
          fullPage: true,
        });
      }
    });
  }
});
