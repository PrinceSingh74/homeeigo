import { expect, test, type Page } from "@playwright/test";
import {
  dismissCookieConsent,
  ensureDefaultAddress,
  fillReactControlled,
  mockRazorpayCheckout,
} from "./helpers";
import { apiLogin, SEED_CUSTOMER } from "./enterprise/fixtures";

/**
 * One booking, two browsers, the isolated stack.
 * Customer creates and pays it. Dispatch offers the demo partner because they are
 * online at the job. The partner accepts, starts with the customer's real PIN, and
 * completes. The customer then reads that same booking as completed.
 */
const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const PARTNER_ORIGIN = (process.env.E2E_PARTNER_URL ?? "http://127.0.0.1:3016").replace(/\/$/, "");
const PARTNER = { email: "partner@homigo.demo", password: "Homigo@123" };
/**
 * The demo partner's last accepted GPS is Bengaluru (the live-job geofence).
 * A Gurugram fix from there exceeds the presence speed limit, so the journey
 * stays on that fix instead of teleporting the partner.
 */
const JOB = { latitude: 12.9717, longitude: 77.5947 };
const SERVICE_PATH = "/services/home-maintenance/electrician";
const SERVICE_SLUG = "electrician";

test("same booking: customer pays, partner completes, customer reads it back", async ({ browser }) => {
  test.setTimeout(420_000);

  const health = await fetch(`${API}/health`);
  const healthJson = (await health.json()) as { isolatedDatabase?: boolean };
  expect(health.ok).toBeTruthy();
  expect(healthJson.isolatedDatabase, "refusing to book against a non-isolated API").toBe(true);

  const customerToken = await apiLogin(SEED_CUSTOMER.email, SEED_CUSTOMER.password).then((r) => r.token);
  await ensureDefaultAddress(customerToken, {
    addressLine1: "12th Main, Indiranagar",
    city: "Bengaluru",
    state: "Karnataka",
    zipCode: "560038",
    latitude: JOB.latitude,
    longitude: JOB.longitude,
  });

  const partnerContext = await browser.newContext({
    geolocation: JOB,
    permissions: ["geolocation"],
  });
  const customerContext = await browser.newContext();
  const partnerPage = await partnerContext.newPage();
  const customerPage = await customerContext.newPage();

  await partnerOnlineAtJob(partnerPage);
  const near = await fetch(`${API}/api/geo/nearby-providers`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${customerToken}` },
    body: JSON.stringify({
      serviceId: await serviceId(customerToken),
      latitude: JOB.latitude,
      longitude: JOB.longitude,
      maxDistanceKm: 25,
      scheduledDate: nextWeekdayTenIst(),
    }),
  });
  const nearJson = (await near.json()) as { data?: { count?: number } };
  expect(nearJson.data?.count ?? 0, `partner must be matchable before the customer pays (${near.status} ${JSON.stringify(nearJson).slice(0, 300)})`).toBeGreaterThan(0);

  const created = await customerBooks(customerPage, () => waitForLocatedHeartbeat(partnerPage));
  expect(created.finalAmount).toBe(550);

  await partnerPage.goto(`${PARTNER_ORIGIN}/requests`, { waitUntil: "domcontentloaded" });
  const offer = partnerPage.getByText(created.bookingNumber).first();
  await expect(offer, "dispatch did not offer this booking").toBeVisible({ timeout: 90_000 });
  const accept = partnerPage.locator("li, article, section, div").filter({ hasText: created.bookingNumber }).getByRole("button", { name: /^accept( job)?$/i }).first();
  const acceptRes = partnerPage.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes(`/api/bookings/${created.id}/accept`) && r.ok(),
    { timeout: 60_000 },
  );
  await accept.click();
  await acceptRes;

  await partnerPage.goto(`${PARTNER_ORIGIN}/requests/${created.id}`, { waitUntil: "domcontentloaded" });
  await expect(partnerPage.getByTestId("job-detail-page")).toBeVisible({ timeout: 60_000 });

  await partnerPage.getByRole("button", { name: /on my way/i }).first().click();
  await partnerPage.getByRole("button", { name: /i.?ve arrived/i }).first().click();
  await partnerPage.getByRole("button", { name: /start job/i }).first().click();
  await partnerPage.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes(`/api/bookings/${created.id}/start-otp`) && r.ok(),
    { timeout: 60_000 },
  );
  const pin = await customerStartPin(customerToken, created.id);
  const startRes = partnerPage.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes(`/api/bookings/${created.id}/start`),
    { timeout: 90_000 },
  );
  const otp = partnerPage.locator('input[inputmode="numeric"]');
  await expect(otp.first()).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 6; i++) await otp.nth(i).fill(pin[i]!);
  expect((await startRes).ok()).toBeTruthy();

  const completeRes = partnerPage.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes(`/api/bookings/${created.id}/complete`),
    { timeout: 90_000 },
  );
  await partnerPage.getByRole("button", { name: /mark complete/i }).first().click();
  expect((await completeRes).ok(), "completion").toBeTruthy();

  await customerPage.goto("/bookings", { waitUntil: "domcontentloaded" });
  const row = customerPage.locator("li").filter({ hasText: created.id }).first();
  await expect(row).toBeVisible({ timeout: 45_000 });
  await expect(row).toContainText(/done/i);
  await expect(row).toContainText(/service finished/i);
  await expect(row).toContainText(/550/);
  await row.click();
  await expect(customerPage.getByText(/service finished/i).first()).toBeVisible({ timeout: 30_000 });

  const readback = await fetch(`${API}/api/bookings/${created.id}`, { headers: { authorization: `Bearer ${customerToken}` } });
  const readJson = (await readback.json()) as { data?: { status?: string; booking?: { status?: string; finalAmount?: number } ; finalAmount?: number } };
  const status = String(readJson.data?.status ?? readJson.data?.booking?.status ?? "").toLowerCase();
  const amount = readJson.data?.finalAmount ?? readJson.data?.booking?.finalAmount;
  expect(status).toBe("completed");
  expect(amount).toBe(550);
  console.log(JSON.stringify({ sameBooking: created.id, bookingNumber: created.bookingNumber, status, amount }));

  await partnerContext.close();
  await customerContext.close();
});

async function serviceId(token: string): Promise<string> {
  const res = await fetch(`${API}/api/services?limit=20`, { headers: { authorization: `Bearer ${token}` } });
  const json = (await res.json()) as { data?: { services?: Array<{ id: string; slug: string }> } };
  const row = json.data?.services?.find((s) => s.slug === SERVICE_SLUG);
  if (!row) throw new Error("isolated catalogue has no electrician service");
  return row.id;
}

async function partnerLoginHydrated(page: Page) {
  const ready = () => {
    const el = document.querySelector("#partner-email") as (HTMLInputElement & { _valueTracker?: unknown }) | null;
    return Boolean(el?._valueTracker);
  };
  const waitReady = () => page.waitForFunction(ready, undefined, { timeout: 45_000 });
  try {
    await waitReady();
  } catch {
    const overlay = await page.getByText(/client manifest|runtime error|loading chunk/i).first().isVisible().catch(() => false);
    if (!overlay) throw new Error("partner login did not hydrate");
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitReady();
  }
}

async function partnerOnlineAtJob(page: Page) {
  const seen: string[] = [];
  page.on("response", (r) => {
    if (r.request().method() !== "POST" || !r.url().includes("/presence/heartbeat")) return;
    const body = r.request().postData() ?? "";
    seen.push(`${r.status()} ${body.slice(0, 240)}`);
  });
  await page.goto(`${PARTNER_ORIGIN}/login`, { waitUntil: "domcontentloaded" });
  await partnerLoginHydrated(page);
  await page.locator("#partner-email").pressSequentially(PARTNER.email, { delay: 15 });
  await page.locator("#partner-password").pressSequentially(PARTNER.password, { delay: 15 });
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60_000 });

  const goOffline = page.getByRole("button", { name: /^go offline$/i });
  const goOnline = page.getByRole("button", { name: /^go online$/i });
  await expect
    .poll(async () => (await goOffline.count()) + (await goOnline.count()), { timeout: 30_000 })
    .toBeGreaterThan(0);
  if ((await goOffline.count()) === 0) {
    const onlineRes = page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes("/api/providers/me/online") && r.ok(),
      { timeout: 30_000 },
    );
    await goOnline.first().click();
    await onlineRes;
    await expect(goOffline.first()).toBeVisible({ timeout: 20_000 });
  }

  try {
    await waitForLocatedHeartbeat(page);
  } catch (error) {
    const fix = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          if (!navigator.geolocation) {
            resolve("no-geolocation");
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve(`${pos.coords.latitude},${pos.coords.longitude}`),
            (err) => resolve(`geo-error-${err.code}`),
            { enableHighAccuracy: false, maximumAge: 0, timeout: 8_000 },
          );
        }),
    );
    throw new Error(
      `no located heartbeat fix=${fix} beats=${seen.length}\n${seen.join("\n")}\n${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function waitForLocatedHeartbeat(page: Page) {
  return page.waitForResponse(
    (r) => {
      if (r.request().method() !== "POST" || !r.ok() || !r.url().includes("/presence/heartbeat")) return false;
      return (r.request().postData() ?? "").includes(String(JOB.latitude));
    },
    { timeout: 100_000 },
  );
}

/** Next 10:00 IST on a weekday, which is inside the demo partner's declared hours. */
function nextWeekdayTenIst(): string {
  const now = Date.now();
  for (let i = 0; i < 8; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(now + i * 86_400_000));
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday)) continue;
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    const slot = new Date(`${y}-${m}-${d}T12:00:00+05:30`);
    if (slot.getTime() > now + 30 * 60_000) return slot.toISOString();
  }
  throw new Error("no weekday 10:00 slot");
}

async function chooseWorkingHoursSlot(page: Page) {
  const confirm = page.getByRole("button", { name: /confirm booking securely|^confirm$/i }).first();
  const chooseTime = page.getByRole("button", { name: /^choose a time/i }).first();
  await expect(confirm.or(chooseTime)).toBeVisible({ timeout: 30_000 });
  if (await chooseTime.isVisible()) {
    // Exact time names. Skip "11:00 am": that is also the schedule clock, which is not a slot.
    const names = ["11:30 am", "12:00 pm", "12:30 pm", "01:00 pm", "01:30 pm", "02:00 pm", "02:30 pm", "03:00 pm", "03:30 pm", "04:00 pm", "04:30 pm", "05:00 pm"];
    for (const name of names) {
      const chip = page.getByRole("button", { name, exact: true }).and(page.locator(":enabled"));
      if ((await chip.count()) !== 1) continue;
      await chip.click();
      break;
    }
  }
  return confirm;
}

async function customerBooks(
  page: Page,
  beforeConfirm?: () => Promise<unknown>,
): Promise<{ id: string; bookingNumber: string; finalAmount: number }> {
  await mockRazorpayCheckout(page);
  await page.goto(SERVICE_PATH, { waitUntil: "domcontentloaded" });
  await dismissCookieConsent(page);
  await expect(page.getByRole("heading", { name: /^electrician$/i }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: /on the visit/i })).toBeVisible();
  await expect(page.getByText(/matching score|prohibited condition|wear gloves/i)).toHaveCount(0);
  await dismissCookieConsent(page);
  const book = page.getByRole("link", { name: /book electrician/i }).first();
  await book.click();
  await page.waitForURL(/\/login\?/, { timeout: 30_000 });
  expect(page.url()).toContain("returnUrl");
  expect(decodeURIComponent(page.url())).toContain("/book");
  await dismissCookieConsent(page);
  await fillReactControlled(page.getByRole("textbox", { name: "Email" }), SEED_CUSTOMER.email);
  await fillReactControlled(page.getByRole("textbox", { name: "Password", exact: true }), SEED_CUSTOMER.password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/book/, { timeout: 45_000 });
  await dismissCookieConsent(page);
  await expect(page.getByText(/₹\s?550|550/).first()).toBeVisible({ timeout: 60_000 });

  const confirm = await chooseWorkingHoursSlot(page);
  if (beforeConfirm) await beforeConfirm();
  await dismissCookieConsent(page);
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
  await confirm.click();
  const createdRes = await bookRes;
  const raw = await createdRes.text();
  expect(createdRes.ok(), raw).toBeTruthy();
  const createdJson = JSON.parse(raw) as {
    data?: { booking?: { id?: string; bookingNumber?: string; finalAmount?: number } };
  };
  await verifyRes;
  await expect(page.getByRole("heading", { name: /booking confirmed/i })).toBeVisible({ timeout: 45_000 });
  const booking = createdJson.data?.booking;
  if (!booking?.id || !booking.bookingNumber) throw new Error("create response had no booking id");
  return { id: booking.id, bookingNumber: booking.bookingNumber, finalAmount: Number(booking.finalAmount) };
}

async function customerStartPin(token: string, bookingId: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${API}/api/bookings/${bookingId}/start-pin`, { headers: { authorization: `Bearer ${token}` } });
    const json = (await res.json()) as { data?: { state?: string; pin?: string | null } };
    if (json.data?.state === "active" && json.data.pin && /^\d{6}$/.test(json.data.pin)) return json.data.pin;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("customer start PIN never became active");
}
