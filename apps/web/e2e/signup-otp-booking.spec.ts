import { test, expect } from "@playwright/test";
import {
  fillOtp,
  apiLoginCustomer,
  confirmBookingAndWait,
  ensureDefaultAddress,
  fillSignupForm,
  mockRazorpayCheckout,
  submitSignupAndWaitForOtp,
  uniqueSignupUser,
} from "./helpers";

test.describe("Customer journey", () => {
  test("signup → OTP verify → book a service", async ({ page }) => {
    const user = uniqueSignupUser();

    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();

    await fillSignupForm(page, user);

    const otp = await submitSignupAndWaitForOtp(page);

    await expect(page).toHaveURL(/\/verify-otp/);
    await fillOtp(page, otp);
    await page.getByRole("button", { name: /verify & create account/i }).click();

    await page.waitForURL(
      (url) =>
        !url.pathname.includes("verify-otp") && !url.pathname.includes("signup"),
      { timeout: 30_000 },
    );

    const token = await apiLoginCustomer(user.email, user.password);
    // Bathroom Cleaning is published for Delhi, not Gurugram. The address has to be a city the
    // service actually covers.
    await ensureDefaultAddress(token, {
      addressLine1: "Connaught Place",
      city: "Delhi",
      state: "Delhi",
      zipCode: "110001",
      latitude: 28.6315,
      longitude: 77.2167,
    });

    await mockRazorpayCheckout(page);
    await page.goto("/book", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/loading booking/i)).toBeHidden({ timeout: 60_000 });
    // /book opens on the service list. A time grid exists only after a service is chosen.
    await page.getByRole("button", { name: /Bathroom Cleaning/i }).first().click();

    await confirmBookingAndWait(page);
  });
});
