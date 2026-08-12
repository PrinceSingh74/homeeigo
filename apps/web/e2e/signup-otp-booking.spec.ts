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
    await ensureDefaultAddress(token);

    await mockRazorpayCheckout(page);
    await page.goto("/book", { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText(/loading booking/i)).toBeHidden({ timeout: 60_000 });

    await confirmBookingAndWait(page);
  });
});
