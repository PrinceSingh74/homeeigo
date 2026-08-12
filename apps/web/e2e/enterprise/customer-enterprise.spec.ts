import { expect } from "@playwright/test";
import {
  cancelUpcomingBookings,
  confirmBookingAndWait,
  ensureDefaultAddress,
  fillOtp,
  fillReactControlled,
  dismissCookieConsent,
  fillSignupForm,
  mockRazorpayCheckout,
  registerCustomerViaApi,
  submitSignupAndWaitForOtp,
  uniqueSignupUser,
} from "../helpers";
import {
  apiGet,
  apiLogin,
  gotoAuthedCustomer,
  loginCustomerUi,
  SEED_CUSTOMER,
  test,
} from "./fixtures";

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

test.describe("Enterprise customer E2E", () => {
  test("signup → OTP verify", async ({ page, monitor }) => {
    const user = uniqueSignupUser();
    await page.goto("/signup");
    await fillSignupForm(page, user);

    const otp = await submitSignupAndWaitForOtp(page);
    await fillOtp(page, otp);

    const verifyRes = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        (r.url().includes("/api/auth/verify-otp") || r.url().includes("/api/auth/register")) &&
        r.ok(),
      { timeout: 45_000 },
    );
    await page.getByRole("button", { name: /verify & create account/i }).click();
    await verifyRes;
    await page.waitForURL((u) => !u.pathname.includes("verify-otp"), { timeout: 30_000 });

    const { token } = await apiLogin(user.email, user.password);
    const me = await apiGet<{ success: boolean; data: { user: { id: string } } }>(
      "/api/users/me",
      token,
    );
    expect(me.success).toBe(true);
    expect(me.data.user.id).toBeTruthy();
    monitor.assertClean();
  });

  test("forgot password flow", async ({ page, monitor }) => {
    await page.goto("/forgot-password");
    await dismissCookieConsent(page);
    await fillReactControlled(
      page.getByRole("textbox", { name: "Email" }),
      SEED_CUSTOMER.email,
    );
    const fpRes = page.waitForResponse(
      (r) => r.url().includes("/api/auth/forgot-password"),
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: /send reset link/i }).click();
    const fp = await fpRes;
    expect([200, 429]).toContain(fp.status());
    if (fp.ok()) {
      await expect(page.getByRole("link", { name: /return to sign in/i })).toBeVisible({
        timeout: 15_000,
      });
    }
    monitor.assertClean();
  });

  test("login → search → wallet → referral → membership → notifications", async ({
    page,
    monitor,
  }) => {
    await loginCustomerUi(page, SEED_CUSTOMER.email, SEED_CUSTOMER.password);

    await page.goto("/services");
    await expect(page.getByRole("heading", { name: /services/i }).first()).toBeVisible({
      timeout: 30_000,
    });
    const searchRes = page.waitForResponse(
      (r) => r.url().includes("/api/services") && r.ok(),
      { timeout: 30_000 },
    );
    await searchRes;

    const { token } = await apiLogin(SEED_CUSTOMER.email, SEED_CUSTOMER.password);
    const balance = await apiGet<{ success: boolean; data: { balance: number } }>(
      "/api/wallet/balance",
      token,
    );
    expect(balance.success).toBe(true);

    const referrals = await apiGet<{ success: boolean; data: { code?: string } }>(
      "/api/referrals/me",
      token,
    );
    expect(referrals.success).toBe(true);

    const plans = await apiGet<{ success: boolean; data: unknown[] }>(
      "/api/subscriptions/plans",
      token,
    );
    expect(plans.success).toBe(true);

    const notifications = await apiGet<{ success: boolean }>("/api/notifications", token);
    expect(notifications.success).toBe(true);

    await gotoAuthedCustomer(page, "/wallet", SEED_CUSTOMER);
    await expect(page.getByText(/wallet|balance/i).first()).toBeVisible({ timeout: 30_000 });
    const refApi = page.waitForResponse(
      (r) => r.url().includes("/api/referrals") && r.ok(),
      { timeout: 60_000 },
    );
    await gotoAuthedCustomer(page, "/referrals", SEED_CUSTOMER);
    await refApi;
    await expect(page.getByText(/refer & earn|your referral code/i).first()).toBeVisible({
      timeout: 30_000,
    });
    const plansApi = page.waitForResponse(
      (r) => r.url().includes("/api/subscriptions") && r.ok(),
      { timeout: 60_000 },
    );
    await gotoAuthedCustomer(page, "/membership", SEED_CUSTOMER);
    await plansApi;
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    await expect(
      page.getByRole("heading", { name: /choose your plan|all plans|active membership|homigo premium/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
    const notifApi = page.waitForResponse(
      (r) => r.url().includes("/api/notifications") && r.ok(),
      { timeout: 60_000 },
    );
    await gotoAuthedCustomer(page, "/notifications", SEED_CUSTOMER);
    await notifApi;
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
    monitor.assertClean();
  });

  test("support ticket create", async ({ page, monitor }) => {
    await loginCustomerUi(page, SEED_CUSTOMER.email, SEED_CUSTOMER.password);
    await gotoAuthedCustomer(page, "/support", SEED_CUSTOMER);
    await page.getByRole("button", { name: /new ticket/i }).click();
    await page.getByPlaceholder("Subject").fill("E2E enterprise support");
    await page.getByPlaceholder("Describe your issue in detail").fill(
      "Automated enterprise E2E support ticket validation run.",
    );
    const ticketRes = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes("/api/support/tickets") &&
        r.ok(),
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: /submit ticket/i }).click();
    await ticketRes;
    monitor.assertClean();
  });

  test("booking with mocked payment", async ({ page, monitor }) => {
    const { token } = await apiLogin(SEED_CUSTOMER.email, SEED_CUSTOMER.password);
    await ensureDefaultAddress(token);
    await cancelUpcomingBookings(token);
    await loginCustomerUi(page, SEED_CUSTOMER.email, SEED_CUSTOMER.password);
    await mockRazorpayCheckout(page);
    await gotoAuthedCustomer(page, "/book", SEED_CUSTOMER);
    const servicesReady = page.waitForResponse(
      (r) => r.url().includes("/api/services") && r.ok(),
      { timeout: 60_000 },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await servicesReady;
    await expect(page.getByText(/loading booking/i)).toBeHidden({ timeout: 90_000 });
    await confirmBookingAndWait(page);

    const { token: verifyToken } = await apiLogin(SEED_CUSTOMER.email, SEED_CUSTOMER.password);
    const upcoming = await apiGet<{ success: boolean; data: { bookings?: unknown[] } }>(
      "/api/bookings/upcoming",
      verifyToken,
    );
    expect(upcoming.success).toBe(true);
    expect((upcoming.data.bookings ?? []).length).toBeGreaterThan(0);
    monitor.assertClean();
  });

  test("account deletion schedule (disposable user)", async ({ page, monitor }) => {
    const user = uniqueSignupUser();
    await registerCustomerViaApi(user);
    await gotoAuthedCustomer(page, "/settings", user);
    await dismissCookieConsent(page);
    const deleteConfirm = page.getByPlaceholder("Type DELETE to confirm");
    await deleteConfirm.scrollIntoViewIfNeeded();
    await fillReactControlled(deleteConfirm, "DELETE");
    const delRes = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes("/api/compliance/delete") &&
        r.ok(),
      { timeout: 30_000 },
    );
    await dismissCookieConsent(page);
    await page.getByRole("button", { name: /delete my account/i }).click({ force: true });
    await delRes;
    monitor.assertClean();
  });
});
