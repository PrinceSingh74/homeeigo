import { expect, type Locator, type Page } from "@playwright/test";

const E2E_PASSWORD = "Homigo@E2e1";
const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

export async function apiLoginCustomer(email: string, password: string) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const json = (await res.json()) as { data?: { accessToken?: string } };
  const token = json.data?.accessToken;
  if (!token) throw new Error("missing accessToken");
  return token;
}

export async function registerCustomerViaApi(user: ReturnType<typeof uniqueSignupUser>) {
  const phoneNumber = `+91${user.phoneLocal}`;
  const otpRes = await fetch(`${API}/api/auth/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber }),
  });
  if (!otpRes.ok) {
    throw new Error(`send-otp failed: ${otpRes.status} ${await otpRes.text()}`);
  }
  const otpJson = (await otpRes.json()) as { data?: { devOtp?: string } };
  const otp = otpJson.data?.devOtp;
  if (!otp) throw new Error("send-otp missing devOtp");

  const regRes = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: user.email,
      phoneNumber,
      firstName: user.firstName,
      lastName: user.lastName,
      password: user.password,
      confirmPassword: user.password,
      otp,
      agreeToTerms: true,
      setAuthCookies: false,
    }),
  });
  if (!regRes.ok) {
    throw new Error(`register failed: ${regRes.status} ${await regRes.text()}`);
  }
}

/** Cancel active upcoming bookings so E2E can create a fresh one (avoids 409 OVERLAPPING_BOOKING). */
export async function cancelUpcomingBookings(token: string) {
  const res = await fetch(`${API}/api/bookings/upcoming`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return;
  const json = (await res.json()) as {
    data?: { bookings?: Array<{ id: string; status?: string }> };
  };
  for (const booking of json.data?.bookings ?? []) {
    await fetch(`${API}/api/bookings/${booking.id}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reason: "E2E cleanup", cancelledBy: "user" }),
    });
  }
}

export async function ensureDefaultAddress(token: string) {
  const res = await fetch(`${API}/api/users/addresses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      label: "Home",
      addressLine1: "Sector 49, Gurugram",
      addressLine2: "E2E test address",
      city: "Gurugram",
      state: "Haryana",
      zipCode: "122018",
      latitude: 28.4595,
      longitude: 77.0266,
    }),
  });
  if (!res.ok) throw new Error(`address create failed: ${res.status} ${await res.text()}`);
}

/** Fill a field; SignupForm reads named inputs from the DOM on submit. */
export async function fillReactControlled(locator: Locator, value: string) {
  await locator.fill(value);
  await expect(locator).toHaveValue(value);
}

export async function fillSignupForm(
  page: Page,
  user: ReturnType<typeof uniqueSignupUser>,
) {
  await fillReactControlled(page.getByRole("textbox", { name: "First name" }), user.firstName);
  await fillReactControlled(page.getByRole("textbox", { name: "Last name" }), user.lastName);
  await fillReactControlled(page.getByRole("textbox", { name: "Email" }), user.email);
  await fillReactControlled(page.getByPlaceholder("98765 43210"), user.phoneLocal);
  await fillReactControlled(
    page.getByRole("textbox", { name: "Password", exact: true }),
    user.password,
  );
  await fillReactControlled(
    page.getByRole("textbox", { name: "Confirm password" }),
    user.password,
  );
  const terms = page.getByRole("checkbox", { name: /I agree to the Terms/i });
  if (!(await terms.isChecked())) {
    await terms.evaluate((el) => (el as HTMLInputElement).click());
  }
  await expect(terms).toBeChecked();

  await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue(user.email);
  await expect(page.getByPlaceholder("98765 43210")).toHaveValue(user.phoneLocal);
}

export function uniqueSignupUser() {
  const stamp = Date.now();
  return {
    firstName: "E2E",
    lastName: "Runner",
    email: `e2e.${stamp}@homigo.test`,
    phoneLocal: `9${String(stamp % 100_000_000).padStart(9, "0")}`,
    password: E2E_PASSWORD,
  };
}

/** Waits for POST /api/auth/send-otp and reads `data.devOtp` (dev / no Twilio). */
export async function waitForDevOtp(page: Page): Promise<string> {
  const response = await page.waitForResponse(
    (res) =>
      res.request().method() === "POST" && res.url().includes("/api/auth/send-otp"),
    { timeout: 45_000 },
  );
  if (!response.ok()) {
    throw new Error(`send-otp HTTP ${response.status()}: ${await response.text()}`);
  }
  const json = (await response.json()) as {
    data?: { devOtp?: string };
    devOtp?: string;
  };
  const otp = json.data?.devOtp ?? json.devOtp;
  if (!otp || !/^\d{6}$/.test(otp)) {
    throw new Error(
      "send-otp did not return devOtp. Start backend in dev (Twilio unset) and ensure DB is migrated.",
    );
  }
  return otp;
}

export async function dismissCookieConsent(page: Page) {
  const accept = page.getByRole("button", { name: /^accept$/i });
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) {
    await accept.click();
  }
}

export async function submitSignupAndWaitForOtp(page: Page): Promise<string> {
  await dismissCookieConsent(page);
  const otpPromise = waitForDevOtp(page);
  const navPromise = page.waitForURL(/\/verify-otp/, { timeout: 45_000 });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  try {
    const [otp] = await Promise.all([otpPromise, navPromise]);
    return otp;
  } catch (error) {
    const alerts = await page.locator("[role=alert]").allTextContents();
    throw new Error(
      `send-otp or verify-otp navigation failed. On-page alerts: ${alerts.join("; ") || "(none)"}. ${String(error)}`,
    );
  }
}

export async function fillOtp(page: Page, otp: string) {
  const digits = otp.replace(/\D/g, "").slice(0, 6);
  if (digits.length !== 6) throw new Error("OTP must be 6 digits");
  const first = page.getByLabel("Digit 1");
  await first.click();
  await first.fill(digits[0]!);
  for (let i = 1; i < 6; i++) {
    await page.getByLabel(`Digit ${i + 1}`).fill(digits[i]!);
  }
}

export async function confirmBookingAndWait(page: Page) {
  const confirm = page
    .getByRole("button", { name: /confirm booking securely|^confirm$/i })
    .first();
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  const bookRes = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().includes("/api/bookings") &&
      !r.url().includes("/cancel") &&
      r.ok(),
    { timeout: 45_000 },
  );
  const orderRes = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().includes("/api/payments/create-order") &&
      r.ok(),
    { timeout: 45_000 },
  );
  const verifyRes = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      r.url().includes("/api/payments/verify") &&
      r.ok(),
    { timeout: 60_000 },
  );
  await confirm.click();
  await bookRes;
  await orderRes;
  await verifyRes;
  await expect(page.getByRole("heading", { name: /booking confirmed/i })).toBeVisible({
    timeout: 45_000,
  });
}

/** Avoid opening real Razorpay during UI E2E — uses real order_id + server-signed HMAC. */
export async function mockRazorpayCheckout(page: Page) {
  const apiBase = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

  // Block the external checkout script so our mock cannot be replaced mid-flow.
  await page.route("**/checkout.razorpay.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );

  await page.addInitScript((base: string) => {
    async function signPayment(orderId: string, paymentId: string): Promise<string> {
      let lastErr = "unknown";
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          const res = await fetch(`${base}/api/payments/e2e/mock-signature`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ razorpayOrderId: orderId, razorpayPaymentId: paymentId }),
          });
          if (!res.ok) {
            lastErr = `HTTP ${res.status}`;
            await new Promise((r) => setTimeout(r, 80 * (attempt + 1)));
            continue;
          }
          const json = (await res.json()) as { data?: { razorpaySignature?: string } };
          if (json.data?.razorpaySignature) return json.data.razorpaySignature;
          lastErr = "missing signature";
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
        }
        await new Promise((r) => setTimeout(r, 80 * (attempt + 1)));
      }
      throw new Error(`e2e mock-signature failed: ${lastErr}`);
    }

    class RazorpayMock {
      options: Record<string, unknown>;
      private settling = false;
      constructor(options: Record<string, unknown>) {
        this.options = options;
      }
      open() {
        if (this.settling) return;
        this.settling = true;
        const handler = this.options.handler as
          | ((payload: {
              razorpay_order_id: string;
              razorpay_payment_id: string;
              razorpay_signature: string;
            }) => void | Promise<void>)
          | undefined;
        const orderId = String(this.options.order_id ?? "");
        if (!orderId || !handler) return;

        const paymentId = `pay_e2e_${Date.now().toString(36)}`;
        void signPayment(orderId, paymentId)
          .then((signature) =>
            handler({
              razorpay_order_id: orderId,
              razorpay_payment_id: paymentId,
              razorpay_signature: signature,
            }),
          )
          .catch((err: Error) => {
            console.error("[E2E Razorpay mock]", err.message);
          });
      }
    }
    window.Razorpay = RazorpayMock as unknown as typeof window.Razorpay;
  }, apiBase);
}
