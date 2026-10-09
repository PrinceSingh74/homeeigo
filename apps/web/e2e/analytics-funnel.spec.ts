/**
 * Phase 15.2 — the real customer funnel, instrumented end to end.
 *
 * One browser, the isolated stack. The customer opens the beauty category, clicks a service,
 * chooses who it is for, an option and an add-on on the real detail page, presses Book Now, is
 * quoted on /book, and confirms — the booking is created and paid through the mocked gateway.
 * The customer then cancels it through the customer API. Every analytics row is then read from
 * the test database and checked: one row per event, the right service and version, the actor,
 * the server-derived population, no secrets in metadata, and no backend-only event reachable from
 * the browser. Nothing here writes to the analytics table; the application does.
 *
 * Fixtures come from apps/backend/scripts/e2e-analytics-funnel.ts (isolated database only) and are
 * removed afterwards. Run against a running isolated stack:
 *   E2E_SKIP_SERVERS=1 E2E_WEB_URL=http://127.0.0.1:3017 E2E_API_URL=http://127.0.0.1:3100 \
 *     npx playwright test e2e/analytics-funnel.spec.ts
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { apiLogin, dismissCookieConsent, seedCustomerBrowserSession } from "./enterprise/fixtures";
import { chooseFirstBookableSlot, mockRazorpayCheckout } from "./helpers";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BACKEND = path.join(__dirname, "../../backend");
const RUN = `fnl${Date.now().toString(36)}`;

type Seed = {
  runId: string;
  database: string;
  password: string;
  customer: { email: string; id: string; addressId: string; dataOrigin: string | null };
  service: { id: string; slug: string; version: number; name: string; path: string };
  variants: string[];
  addons: string[];
};

type Row = {
  eventId: string;
  eventName: string;
  actorUserId: string | null;
  sessionId: string | null;
  serviceId: string | null;
  serviceVersionId: number | null;
  variantId: string | null;
  optionId: string | null;
  addonId: string | null;
  bookingId: string | null;
  source: string;
  platform: string;
  environment: string;
  dataOrigin: string;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
  receivedAt: string;
};

type Readback = {
  database: string;
  rows: Row[];
  bookings: Array<{ id: string; status: string; paymentStatus: string; serviceConfigVersion: number | null; finalAmount: number }>;
  outbox: Array<{ eventId: string; eventType: string; status: string; aggregateId: string }>;
};

function backendScript<T>(args: string[]): T {
  // The fixture script refuses any database whose name does not say "test" (apps/backend/.env.test).
  const envFile = process.env.E2E_BACKEND_ENV_FILE ?? ".env.test";
  const raw = execFileSync("bun", [`--env-file=${envFile}`, "run", "scripts/e2e-analytics-funnel.ts", ...args], {
    cwd: BACKEND,
    encoding: "utf8",
    timeout: 120_000,
    shell: process.platform === "win32",
    env: { ...process.env, HOMIGO_STAGING: "", APP_ENV: "development" },
  });
  const line = raw.trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop();
  if (!line) throw new Error(`${args[0]} produced no JSON: ${raw.slice(-600)}`);
  return JSON.parse(line) as T;
}

let seed: Seed;
let token = "";
let bookingId = "";

const readback = () => backendScript<Readback>(["rows", RUN, seed.customer.id]);
const byName = (rows: Row[], name: string) => rows.filter((r) => r.eventName === name);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const health = (await (await fetch(`${API}/health`)).json()) as { isolatedDatabase?: boolean };
  expect(health.isolatedDatabase, "the API under test must be on an isolated database").toBe(true);
  seed = backendScript<Seed>(["seed", RUN]);
  expect(seed.database).toMatch(/test/i);
  expect(seed.variants).toEqual(["classic", "deluxe"]);
  expect(seed.addons).toEqual(["facial"]);
  token = (await apiLogin(seed.customer.email, seed.password)).token;
});

test.afterAll(async () => {
  if (seed) backendScript(["cleanup", RUN, seed.customer.id]);
});

/** The analytics POST the page makes for one event name; resolves with the server's answer. */
function analyticsPost(page: Page, eventName: string) {
  return page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/api/analytics/events") && r.request().postDataJSON()?.eventName === eventName,
    { timeout: 30_000 },
  );
}

test("browse → select → book → quote → checkout → booking_created, one row each, server-attributed", async ({ page }) => {
  test.setTimeout(300_000);
  await page.route(/sentry\.io/, (r) => r.abort());
  await seedCustomerBrowserSession(page, seed.customer.email, seed.password);
  await mockRazorpayCheckout(page);
  const posted: Record<string, number> = {};
  page.on("request", (r) => {
    if (r.method() !== "POST" || !r.url().includes("/api/analytics/events")) return;
    const name = r.postDataJSON()?.eventName as string | undefined;
    if (name) posted[name] = (posted[name] ?? 0) + 1;
  });
  // Quotes the browser asked for on this service, and the ones whose 200 it received. React Query
  // abandons an in-flight quote when its inputs change (address loaded, slot chosen); the server
  // still computed that quote, so rows can exceed received answers but never requests.
  let quotesRequested = 0;
  let quotesReceived = 0;
  const isQuote = (r: { method: () => string; url: () => string; postDataJSON: () => { serviceId?: string } | null }) =>
    r.method() === "POST" && r.url().includes("/api/bookings/price-quote") && r.postDataJSON()?.serviceId === seed.service.id;
  page.on("request", (r) => {
    if (isQuote(r)) quotesRequested += 1;
  });
  page.on("response", (r) => {
    if (isQuote(r.request()) && r.status() === 200) quotesReceived += 1;
  });

  // service_click: the real category page, the real card.
  await page.goto("/services/beauty", { waitUntil: "domcontentloaded" });
  const card = page.getByRole("link", { name: "Salon at Home", exact: true }).first();
  await expect(card).toBeVisible({ timeout: 60_000 });
  const clickPost = analyticsPost(page, "SERVICE_CLICK");
  const viewPost = analyticsPost(page, "SERVICE_VIEW");
  await card.click();
  await page.waitForURL(/\/services\/beauty\/salon-at-home/, { timeout: 60_000 });
  expect((await clickPost).status(), "service_click accepted").toBe(201);
  expect((await viewPost).status(), "service_view accepted").toBe(201);

  // Selections on the real detail page: audience (option), variant, add-on — each from a click.
  const optionPost = analyticsPost(page, "OPTION_SELECTED");
  await page.getByRole("radio", { name: /Women/ }).click();
  expect((await optionPost).status()).toBe(201);

  const variantPost = analyticsPost(page, "VARIANT_SELECTED");
  await page.getByRole("radio", { name: /Deluxe session/ }).click();
  expect((await variantPost).status()).toBe(201);

  const addonPost = analyticsPost(page, "ADDON_SELECTED");
  await page.getByRole("button", { name: /Express facial/ }).click();
  expect((await addonPost).status()).toBe(201);

  // Removing the add-on is not an "add-on selected"; re-adding it is the same deterministic id,
  // which the client already sent this session — so no second request leaves the browser.
  await page.getByRole("button", { name: /Express facial/ }).click();
  await page.getByRole("button", { name: /Express facial/ }).click();

  // A refresh is the same view in the same session: the client does not send it again either.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("radio", { name: /Women/ })).toBeVisible({ timeout: 60_000 });

  // Reselect after the refresh (selection state is not persisted) — same ids, no new requests.
  await page.getByRole("radio", { name: /Women/ }).click();
  await page.getByRole("radio", { name: /Deluxe session/ }).click();
  await page.getByRole("button", { name: /Express facial/ }).click();
  await page.waitForTimeout(1_500);
  expect(posted, "repeats within the session never leave the browser").toEqual({
    SERVICE_CLICK: 1,
    SERVICE_VIEW: 1,
    OPTION_SELECTED: 1,
    VARIANT_SELECTED: 1,
    ADDON_SELECTED: 1,
  });
  const cta = page.getByRole("complementary", { name: "Book this service" }).getByRole("link", { name: /^Book / });
  await expect(cta).toBeVisible({ timeout: 30_000 });
  await expect(cta).toHaveText(/Book Now — ₹950/);
  await dismissCookieConsent(page);
  const startedPost = analyticsPost(page, "BOOKING_STARTED");
  const quoteRes = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/api/bookings/price-quote") && r.request().postDataJSON()?.serviceId === seed.service.id,
    { timeout: 60_000 },
  );
  await cta.click();
  expect((await startedPost).status(), "booking_started from the CTA").toBe(201);
  await page.waitForURL(/\/book\?/, { timeout: 60_000 });
  const url = new URL(page.url());
  expect(url.searchParams.get("service")).toBe(seed.service.id);
  expect(url.searchParams.get("variant")).toBe("deluxe");
  expect(url.searchParams.get("addons")).toBe("facial");

  // quote_generated: the server's own quote on /book — 800 (deluxe) + 150 (facial).
  const quote = await quoteRes;
  expect(quote.status()).toBe(200);
  const quoteBody = (await quote.json()) as { data: { quote: { finalAmount: number; packagePrice: number; addonTotal: number; serviceVersion?: number } } };
  expect(quoteBody.data.quote).toMatchObject({ packagePrice: 800, addonTotal: 150 });

  // The /book page carries booking_started too — same identity (session, service), so the
  // client, having sent it from the CTA, does not send it again.
  await dismissCookieConsent(page);
  const confirm = await chooseFirstBookableSlot(page);
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  const bookRes = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/bookings\/?$/.test(new URL(r.url()).pathname), { timeout: 45_000 });
  const orderRes = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/payments/create-order") && r.ok(), { timeout: 45_000 });
  const verifyRes = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/payments/verify") && r.ok(), { timeout: 60_000 });
  await confirm.click();
  const createdRes = await bookRes;
  expect(createdRes.ok(), `booking create ${createdRes.status()} ${await createdRes.text()}`).toBeTruthy();
  await orderRes;
  await verifyRes;
  await expect(page.getByRole("dialog").getByText(/payment received|booking confirmed/i).first()).toBeVisible({ timeout: 45_000 });
  expect(posted.BOOKING_STARTED, "booking_started once across CTA and /book").toBe(1);

  const bookings = (await (await fetch(`${API}/api/bookings/upcoming`, { headers: { Authorization: `Bearer ${token}` } })).json()) as {
    data?: { bookings?: Array<{ id: string; status: string }> };
  };
  const created = (bookings.data?.bookings ?? [])[0];
  expect(created, "the booking exists on the customer's own list").toBeTruthy();
  bookingId = created!.id;

  // booking_created / checkout_started arrive through the outbox; wait for both.
  let rb = readback();
  await expect
    .poll(
      () => {
        rb = readback();
        return byName(rb.rows, "BOOKING_CREATED").length + byName(rb.rows, "CHECKOUT_STARTED").length;
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(2);

  const counts = Object.fromEntries(
    ["SERVICE_VIEW", "SERVICE_CLICK", "OPTION_SELECTED", "VARIANT_SELECTED", "ADDON_SELECTED", "BOOKING_STARTED", "CHECKOUT_STARTED", "BOOKING_CREATED"].map(
      (n) => [n, byName(rb.rows, n).length],
    ),
  );
  expect(counts, "one row per funnel event").toEqual({
    SERVICE_VIEW: 1,
    SERVICE_CLICK: 1,
    OPTION_SELECTED: 1,
    VARIANT_SELECTED: 1,
    ADDON_SELECTED: 1,
    BOOKING_STARTED: 1,
    CHECKOUT_STARTED: 1,
    BOOKING_CREATED: 1,
  });
  // A quote is identified by its signed token: one row per quote the server really computed,
  // each with its own id — at least every answer the browser received, never more than it asked.
  const quoteRows = byName(rb.rows, "QUOTE_GENERATED");
  expect(quotesReceived).toBeGreaterThanOrEqual(1);
  expect(quoteRows.length, `quote rows (${quoteRows.length}) vs received ${quotesReceived} / requested ${quotesRequested}`).toBeGreaterThanOrEqual(quotesReceived);
  expect(quoteRows.length).toBeLessThanOrEqual(quotesRequested);
  expect(new Set(quoteRows.map((r) => r.eventId)).size).toBe(quoteRows.length);
  expect(new Set(quoteRows.map((r) => (r.metadata as { quoteFingerprint?: string } | null)?.quoteFingerprint ?? r.variantId)).size).toBeLessThanOrEqual(quoteRows.length);

  for (const row of rb.rows) {
    expect(row.serviceId, row.eventName).toBe(seed.service.id);
    expect(row.serviceVersionId, `${row.eventName} carries the catalogue version`).toBe(seed.service.version);
    expect(row.actorUserId, row.eventName).toBe(seed.customer.id);
    expect(row.dataOrigin, `${row.eventName} population is the actor's, derived by the server`).toBe(seed.customer.dataOrigin);
    expect(row.environment).toBeTruthy();
    expect(Date.parse(row.occurredAt)).toBeGreaterThan(0);
    expect(Date.parse(row.receivedAt)).toBeGreaterThan(0);
    const keys = JSON.stringify(row.metadata ?? {}).toLowerCase();
    expect(keys, `${row.eventName} metadata holds no secret`).not.toMatch(/token|secret|password|authorization|card|cvv|signature/);
  }
  const client = rb.rows.filter((r) => ["SERVICE_VIEW", "SERVICE_CLICK", "OPTION_SELECTED", "VARIANT_SELECTED", "ADDON_SELECTED", "BOOKING_STARTED"].includes(r.eventName));
  for (const row of client) {
    expect(row.source).toBe("CUSTOMER_WEB");
    expect(row.platform).toBe("WEB");
    expect(row.sessionId).toBeTruthy();
    expect(row.eventId).toMatch(/^w_[0-9a-f]{24}$/);
  }
  expect(new Set(client.map((r) => r.sessionId)).size, "one browser session").toBe(1);
  expect(byName(rb.rows, "OPTION_SELECTED")[0]!.optionId).toBe("women");
  expect(byName(rb.rows, "VARIANT_SELECTED")[0]!.variantId).toBe("deluxe");
  expect(byName(rb.rows, "ADDON_SELECTED")[0]!.addonId).toBe("facial");

  const quoteRow = byName(rb.rows, "QUOTE_GENERATED")[0]!;
  expect(quoteRow.source).toBe("BACKEND");
  expect(quoteRow.eventId).toMatch(/^quote_[0-9a-f]{48}$/);
  expect(quoteRow.variantId).toBe("deluxe");
  expect(quoteRow.optionId).toBe("women");
  expect(quoteRow.metadata).toMatchObject({ finalAmountPaise: quoteBody.data.quote.finalAmount * 100, addonCount: 1 });
  expect(JSON.stringify(quoteRow.metadata)).not.toMatch(/quoteToken|token/i);

  const createdRow = byName(rb.rows, "BOOKING_CREATED")[0]!;
  const checkoutRow = byName(rb.rows, "CHECKOUT_STARTED")[0]!;
  const booking = rb.bookings.find((b) => b.id === bookingId)!;
  expect(createdRow.bookingId).toBe(bookingId);
  expect(checkoutRow.bookingId).toBe(bookingId);
  expect(createdRow.source).toBe("BACKEND");
  expect(checkoutRow.source).toBe("BACKEND");
  const createdOutbox = rb.outbox.find((o) => o.aggregateId === bookingId && o.eventType === "homigo.booking.created");
  const checkoutOutbox = rb.outbox.find((o) => o.aggregateId === bookingId && o.eventType === "homigo.checkout.started");
  expect(createdOutbox, "booking.created went through the outbox").toBeTruthy();
  expect(checkoutOutbox, "checkout.started went through the outbox").toBeTruthy();
  expect(createdRow.eventId).toBe(`booking_created_${createdOutbox!.eventId}`);
  expect(checkoutRow.eventId).toBe(`checkout_${checkoutOutbox!.eventId}`);
  expect(checkoutRow.metadata).toMatchObject({ tender: "gateway", hasGatewayOrder: true, amountPaise: booking.finalAmount * 100 });
  expect(JSON.stringify(checkoutRow.metadata)).not.toMatch(/razorpay|order_id|signature|secret|card/i);
  expect(booking.paymentStatus).toBe("SUCCESS");
  expect(booking.serviceConfigVersion, "the booking froze the catalogue version the events carry").toBe(seed.service.version);
  expect(booking.finalAmount).toBe(quoteBody.data.quote.finalAmount);
  expect(createdRow.metadata).toMatchObject({ finalAmountPaise: booking.finalAmount * 100 });
});

test("the browser cannot mint a backend-only event; a committed cancellation records one cancelled row", async ({ page }) => {
  test.setTimeout(120_000);
  expect(bookingId, "needs the booking from the previous test").toBeTruthy();
  await seedCustomerBrowserSession(page, seed.customer.email, seed.password);

  // From the page's own origin, with the customer's own session: every backend-only name is refused.
  const refused = await page.evaluate(
    async ({ serviceId, bookingId: b, bearer }) => {
      const out: Record<string, number> = {};
      for (const eventName of ["BOOKING_CREATED", "BOOKING_COMPLETED", "CANCELLED", "REPEAT_BOOKING", "QUOTE_GENERATED", "CHECKOUT_STARTED"]) {
        const res = await fetch("/api/analytics/events", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
          body: JSON.stringify({ eventId: `spoof-${eventName}-${Date.now()}`, eventName, serviceId, bookingId: b, sessionId: "spoof", source: "BACKEND", platform: "WEB" }),
        });
        out[eventName] = res.status;
      }
      return out;
    },
    { serviceId: seed.service.id, bookingId, bearer: token },
  );
  for (const [name, status] of Object.entries(refused)) expect([name, status]).toEqual([name, 403]);

  // The customer cancels through the customer API (the same route the bookings page calls).
  const cancel = await fetch(`${API}/api/bookings/${bookingId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason: "Phase 15.2 funnel e2e", cancelledBy: "user" }),
  });
  expect(cancel.status, await cancel.clone().text()).toBe(200);
  // A second cancel is refused by the booking lifecycle and records nothing.
  const again = await fetch(`${API}/api/bookings/${bookingId}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason: "again", cancelledBy: "user" }),
  });
  expect(again.ok).toBe(false);

  let rb = readback();
  await expect
    .poll(
      () => {
        rb = readback();
        return byName(rb.rows, "CANCELLED").length;
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toBe(1);
  const row = byName(rb.rows, "CANCELLED")[0]!;
  expect(row.bookingId).toBe(bookingId);
  expect(row.source).toBe("BACKEND");
  expect(row.serviceVersionId).toBe(seed.service.version);
  expect(row.dataOrigin).toBe(seed.customer.dataOrigin);
  expect(rb.bookings.find((b) => b.id === bookingId)!.status).toMatch(/^CANCELLED/);
  expect(row.metadata).toMatchObject({ cancelledBy: "user" });
  expect(rb.rows.filter((r) => r.eventId.startsWith("spoof-")).length, "no spoofed row landed").toBe(0);
  expect(byName(rb.rows, "BOOKING_COMPLETED").length + byName(rb.rows, "REPEAT_BOOKING").length).toBe(0);
});
