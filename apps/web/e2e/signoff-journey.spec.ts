import { expect } from "@playwright/test";
import {
  confirmBookingAndWait,
  ensureDefaultAddress,
  mockRazorpayCheckout,
} from "./helpers";
import {
  apiLogin,
  loginCustomerUi,
  SEED_CUSTOMER,
  test,
} from "./enterprise/fixtures";

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

test.describe("Customer sign-off journey", () => {
  test("login", async ({ page, monitor }) => {
    await loginCustomerUi(page, SEED_CUSTOMER.email, SEED_CUSTOMER.password);
    await expect(page.getByText(/wallet|profile|book/i).first()).toBeVisible({
      timeout: 30_000,
    });
    monitor.assertClean();
  });

  test("booking + checkout (mocked payment)", async ({ page, monitor }) => {
    const { token } = await apiLogin(SEED_CUSTOMER.email, SEED_CUSTOMER.password);
    await ensureDefaultAddress(token);
    await loginCustomerUi(page, SEED_CUSTOMER.email, SEED_CUSTOMER.password);
    await mockRazorpayCheckout(page);
    await page.goto("/book");
    const servicesReady = page.waitForResponse(
      (r) => r.url().includes("/api/services") && r.ok(),
      { timeout: 60_000 },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await servicesReady;
    await expect(page.getByText(/loading booking/i)).toBeHidden({ timeout: 90_000 });
    await confirmBookingAndWait(page);
    monitor.assertClean();
  });

  test("tracking section on homepage", async ({ page, monitor }) => {
    await loginCustomerUi(page, SEED_CUSTOMER.email, SEED_CUSTOMER.password);
    await page.goto("/#tracking");
    await expect(page.locator("#tracking")).toBeVisible({ timeout: 30_000 });
    monitor.assertClean();
  });
});
