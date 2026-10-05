import { expect, test, type Page } from "@playwright/test";
import {
  dismissCookieConsent,
  ensureDefaultAddress,
  fillReactControlled,
  mockRazorpayCheckout,
} from "./helpers";
import { apiLogin, SEED_CUSTOMER } from "./enterprise/fixtures";

/**
 * The book page sends one Idempotency-Key per confirm attempt.
 * The first POST is completed by the API and then dropped before the browser reads it.
 * The second confirm reuses the key. One booking, one payment, no stuck spinner.
 */
const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const PARTNER_ORIGIN = (process.env.E2E_PARTNER_URL ?? "http://127.0.0.1:3016").replace(/\/$/, "");
const PARTNER = { email: "partner@homigo.demo", password: "Homigo@123" };
const JOB = { latitude: 12.9717, longitude: 77.5947 };

test("network drop during confirm replays the same booking", async ({ browser }) => {
  test.setTimeout(420_000);
  const health = await fetch(`${API}/health`);
  const healthJson = (await health.json()) as { isolatedDatabase?: boolean };
  expect(health.ok).toBeTruthy();
  expect(healthJson.isolatedDatabase).toBe(true);

  const customerToken = await apiLogin(SEED_CUSTOMER.email, SEED_CUSTOMER.password).then((r) => r.token);
  await ensureDefaultAddress(customerToken, {
    addressLine1: "12th Main, Indiranagar",
    city: "Bengaluru",
    state: "Karnataka",
    zipCode: "560038",
    latitude: JOB.latitude,
    longitude: JOB.longitude,
  });

  const partnerContext = await browser.newContext({ geolocation: JOB, permissions: ["geolocation"] });
  const customerContext = await browser.newContext();
  const partnerPage = await partnerContext.newPage();
  const page = await customerContext.newPage();
  await partnerOnlineAtJob(partnerPage);

  const keys: string[] = [];
  const gate = { release: false, fetched: false };
  await page.route("**/api/bookings", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") return route.continue();
    let path = "";
    try {
      path = new URL(req.url()).pathname.replace(/\/$/, "");
    } catch {
      return route.continue();
    }
    if (!path.endsWith("/api/bookings")) return route.continue();
    const key = req.headers()["idempotency-key"] ?? "";
    if (key) keys.push(key);
    if (gate.release) return route.continue();
    // One server commit. Further clicks while the connection is down are aborted without a second create.
    if (!gate.fetched) {
      gate.fetched = true;
      await route.fetch();
    }
    await route.abort("connectionfailed");
  });

  await mockRazorpayCheckout(page);
  await page.goto("/services/home-maintenance/electrician", { waitUntil: "domcontentloaded" });
  await dismissCookieConsent(page);
  await page.getByRole("link", { name: /book electrician/i }).first().click();
  await page.waitForURL(/\/login\?/, { timeout: 30_000 });
  await dismissCookieConsent(page);
  await fillReactControlled(page.getByRole("textbox", { name: "Email" }), SEED_CUSTOMER.email);
  await fillReactControlled(page.getByRole("textbox", { name: "Password", exact: true }), SEED_CUSTOMER.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/book/, { timeout: 45_000 });
  await dismissCookieConsent(page);
  await expect(page.getByText(/₹\s?550|550/).first()).toBeVisible({ timeout: 60_000 });

  const confirm = await chooseLaterSlot(page);
  await dismissCookieConsent(page);
  await confirm.click();

  await expect
    .poll(async () => page.getByRole("heading", { name: /booking confirmed/i }).count(), { timeout: 8_000 })
    .toBe(0);
  const again = page.getByRole("button", { name: /confirm booking securely|^confirm$/i }).and(page.locator(":visible"));
  await expect(again).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /securing/i })).toHaveCount(0);
  gate.release = true;

  const bookRes = page.waitForResponse((r) => {
    if (r.request().method() !== "POST") return false;
    try {
      return new URL(r.url()).pathname.replace(/\/$/, "").endsWith("/api/bookings");
    } catch {
      return false;
    }
  }, { timeout: 60_000 });
  const verifyRes = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/api/payments/verify") && r.ok(),
    { timeout: 60_000 },
  );
  await again.click();
  const createdRes = await bookRes;
  const raw = await createdRes.text();
  expect(createdRes.ok(), raw).toBeTruthy();
  expect(createdRes.headers()["idempotent-replayed"]).toBe("true");
  const createdJson = JSON.parse(raw) as {
    replayed?: boolean;
    data?: { booking?: { id?: string; finalAmount?: number; paymentStatus?: string } };
  };
  expect(createdJson.replayed).toBe(true);
  await verifyRes;
  await expect(page.getByRole("heading", { name: /booking confirmed/i })).toBeVisible({ timeout: 45_000 });

  const id = createdJson.data?.booking?.id;
  expect(id).toBeTruthy();
  expect(createdJson.data?.booking?.finalAmount).toBe(550);
  expect(keys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(keys).size).toBe(1);

  console.log(JSON.stringify({ networkDropBooking: id, replayed: true, idempotencyKeys: keys.length }));
  const readback = await fetch(`${API}/api/bookings/${id}`, { headers: { authorization: `Bearer ${customerToken}` } });
  const readJson = (await readback.json()) as { data?: { booking?: { id?: string; finalAmount?: number } ; finalAmount?: number } };
  expect(readback.ok).toBeTruthy();
  expect(readJson.data?.booking?.id ?? id).toBe(id);
  expect(readJson.data?.finalAmount ?? readJson.data?.booking?.finalAmount).toBe(550);

  await partnerContext.close();
  await customerContext.close();
});

async function chooseLaterSlot(page: Page) {
  const confirm = page.getByRole("button", { name: /confirm booking securely|^confirm$/i }).and(page.locator(":visible"));
  const date = page.getByRole("textbox", { name: "Date (YYYY-MM-DD)" });
  await fillReactControlled(date, "2026-10-14");
  await date.blur();
  // "11:00 am" is also the schedule clock, so it is not used as a chip name.
  const names = ["10:00 am", "10:30 am", "11:30 am", "12:00 pm", "02:00 pm", "03:00 pm", "04:00 pm"];
  for (const name of names) {
    const chip = page.getByRole("button", { name, exact: true }).and(page.locator(":enabled"));
    if ((await chip.count()) !== 1) continue;
    await chip.click();
    await expect(confirm.first()).toBeVisible({ timeout: 10_000 });
    return confirm.first();
  }
  throw new Error("no open slot on 2026-10-14");
}

async function partnerLoginHydrated(page: Page) {
  const ready = () => Boolean((document.querySelector("#partner-email") as { _valueTracker?: unknown } | null)?._valueTracker);
  try {
    await page.waitForFunction(ready, undefined, { timeout: 45_000 });
  } catch {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(ready, undefined, { timeout: 45_000 });
  }
}

async function partnerOnlineAtJob(page: Page) {
  await page.goto(`${PARTNER_ORIGIN}/login`, { waitUntil: "domcontentloaded" });
  await partnerLoginHydrated(page);
  await page.locator("#partner-email").pressSequentially(PARTNER.email, { delay: 15 });
  await page.locator("#partner-password").pressSequentially(PARTNER.password, { delay: 15 });
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60_000 });
  const goOffline = page.getByRole("button", { name: /^go offline$/i });
  const goOnline = page.getByRole("button", { name: /^go online$/i });
  await expect.poll(async () => (await goOffline.count()) + (await goOnline.count()), { timeout: 30_000 }).toBeGreaterThan(0);
  if ((await goOffline.count()) === 0) {
    const onlineRes = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes("/api/providers/me/online") && r.ok(),
      { timeout: 30_000 },
    );
    await goOnline.first().click();
    await onlineRes;
  }
  await page.waitForResponse(
    (r) => r.request().method() === "POST" && r.ok() && r.url().includes("/presence/heartbeat") && (r.request().postData() ?? "").includes(String(JOB.latitude)),
    { timeout: 100_000 },
  );
}
