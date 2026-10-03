import { expect } from "@playwright/test";
import { partnerLogin, test } from "./enterprise/fixtures";

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

test.describe.configure({ mode: "default" });

test.describe("Section 03 job execution UI", () => {
  test("requests list loads and detail route shows chat composer", async ({ page, monitor }) => {
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

    await partnerLogin(page);

    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: /bookings/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Asha K|Deep clean/i).first()).toBeVisible({
      timeout: 30_000,
    });

    await page.goto("/requests/job-e2e-section03");
    await expect(page.getByTestId("job-detail-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("job-chat-panel")).toBeVisible();
    await expect(page.getByTestId("job-chat-composer")).toBeVisible();
    await expect(page.getByPlaceholder(/type a message/i)).toBeVisible();
    await expect(page.getByTestId("job-chat-panel").getByText(/\+91 .{4,8}3210/)).toBeVisible();
    await expect(page.getByTestId("call-customer-btn").first()).toBeVisible();

    monitor.assertClean();
  });
});
