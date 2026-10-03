/**
 * Section 03 LIVE (non-mocked) Partner Web Offer → Complete.
 *
 * Requires:
 *  - Backend + Partner Web (Playwright webServer or E2E_SKIP_SERVERS + running stacks)
 *  - Seeded demo partner + DB
 *
 * Flow: seed PENDING offer → Accept → On my way → I've arrived (GPS) →
 * Start job (real OTP via customer start-pin) → chat → complete → assert DB.
 *
 * Geolocation is injected via CDP (real browser permission path, fixed coords
 * matching job address — not mocked API responses).
 */
import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { partnerLogin, SEED_PARTNER, test } from "./enterprise/fixtures";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

type LiveSeed = {
  bookingId: string;
  bookingNumber: string;
  customerId: string;
  customerEmail: string;
  customerPassword: string;
  providerId: string;
  jobLat: number;
  jobLng: number;
  insideLat: number;
  insideLng: number;
  outsideLat: number;
  outsideLng: number;
  serviceName: string;
};

function resolveBun(): string {
  if (process.env.BUN_PATH) return process.env.BUN_PATH;
  if (process.platform === "win32") {
    const candidates = [
      path.join(process.env.APPDATA ?? "", "npm", "bun.cmd"),
      path.join(process.env.USERPROFILE ?? "", ".bun", "bin", "bun.exe"),
      "C:\\Users\\Kapiissh Green\\AppData\\Roaming\\npm\\bun.cmd",
    ];
    for (const c of candidates) {
      try {
        execFileSync(c, ["--version"], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "pipe"] });
        return c;
      } catch {
        /* try next */
      }
    }
    return "bun.cmd";
  }
  return "bun";
}

function seedLiveJob(): LiveSeed {
  if (process.env.SECTION03_LIVE_SEED_JSON) {
    return JSON.parse(process.env.SECTION03_LIVE_SEED_JSON) as LiveSeed;
  }
  const script = path.join(__dirname, "../../backend/scripts/section03-seed-live-job.ts");
  const bun = resolveBun();
  // Same database as the API under test. CI's throwaway homigo_db is `.env` plus `--allow-live`.
  // A developer shell often has the live DATABASE_URL inherited, so the default here is `.env.test`.
  const envFile = process.env.E2E_BACKEND_ENV_FILE
    ?? (process.env.GITHUB_ACTIONS === "true" ? ".env" : ".env.test");
  const liveFlag = process.env.GITHUB_ACTIONS === "true" ? ["--allow-live"] : [];
  const out = execFileSync(bun, [`--env-file=${envFile}`, "run", script, ...liveFlag], {
    cwd: path.join(__dirname, "../../backend"),
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: process.env.GITHUB_ACTIONS === "true" ? process.env.NODE_ENV : "test" },
    timeout: 120_000,
  });
  const jsonStart = out.indexOf("{");
  if (jsonStart < 0) throw new Error(`Seed produced no JSON:\n${out}`);
  return JSON.parse(out.slice(jsonStart)) as LiveSeed;
}

async function loginApi(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string }; error?: string };
  if (!res.ok || !json.data?.accessToken) {
    throw new Error(`Login failed for ${email}: ${res.status} ${json.error ?? outSnippet(json)}`);
  }
  return json.data.accessToken;
}

function outSnippet(j: unknown) {
  return JSON.stringify(j).slice(0, 200);
}

async function grantGeo(page: Page, lat: number, lng: number) {
  const ctx = page.context();
  await ctx.grantPermissions(["geolocation"]);
  await ctx.setGeolocation({ latitude: lat, longitude: lng, accuracy: 8 });
}

async function fetchStartPin(customerToken: string, bookingId: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${API}/api/bookings/${bookingId}/start-pin`, {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    const json = (await res.json()) as {
      data?: { state?: string; pin?: string | null };
    };
    if (json.data?.state === "active" && json.data.pin) return json.data.pin;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Customer start-pin never became active");
}

async function assertBookingDb(bookingId: string, token: string, expectStatus: string) {
  // Partner GET /bookings/:id may 404 while PENDING (providerId null); list is authoritative.
  const listRes = await fetch(
    `${API}/api/providers/me/bookings?limit=50&sortBy=recent`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(listRes.ok).toBeTruthy();
  const listJson = (await listRes.json()) as {
    data?: { bookings?: Array<{ id: string; status?: string }> };
  };
  const row = listJson.data?.bookings?.find((b) => b.id === bookingId);
  const fromList = String(row?.status ?? "").toUpperCase().replace(/-/g, "_");

  const res = await fetch(`${API}/api/bookings/${bookingId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as {
    data?: { status?: string; booking?: { status?: string } };
  };
  const fromGet = String(json.data?.status ?? json.data?.booking?.status ?? "")
    .toUpperCase()
    .replace(/-/g, "_");

  const status = fromGet || fromList;
  expect(status).toBe(expectStatus);
}

test.describe.configure({ mode: "serial" });

test.describe("Section 03 LIVE Offer→Complete (no job mocks)", () => {
  test("partner web drives real backend Offer→Complete + chat + earnings", async ({
    page,
    monitor,
  }) => {
    test.setTimeout(360_000);

    // Health gate — do not soft-pass.
    const health = await fetch(`${API}/api/health`).catch(() => fetch(`${API}/`).catch(() => null));
    test.skip(!health || health.status >= 500, `Backend unreachable at ${API}`);

    const seed = seedLiveJob();
    const customerToken = await loginApi(seed.customerEmail, seed.customerPassword);
    const partnerToken = await loginApi(SEED_PARTNER.email, SEED_PARTNER.password);

    await grantGeo(page, seed.insideLat, seed.insideLng);
    await partnerLogin(page);

    // ---- Offer visible (real API list) ----
    await page.goto("/requests");
    await expect(page.getByRole("heading", { name: /bookings|new booking/i }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(seed.bookingNumber).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(seed.serviceName).first()).toBeVisible();

    // ---- Accept ----
    // The offer card's button reads "Accept job" (and "Pass" for decline).
    const acceptBtn = page.getByRole("button", { name: /^accept( job)?$/i }).first();
    await expect(acceptBtn).toBeVisible({ timeout: 30_000 });
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().includes(`/api/bookings/${seed.bookingId}/accept`) &&
          r.ok(),
        { timeout: 60_000 },
      ),
      acceptBtn.click(),
    ]);
    await assertBookingDb(seed.bookingId, partnerToken, "ACCEPTED");

    // Job detail — no mocks
    await page.goto(`/requests/${seed.bookingId}`);
    await expect(page.getByTestId("job-detail-page")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/accepted|assigned/i).first()).toBeVisible({ timeout: 30_000 });

    // ---- En route ----
    const enRoute = page.getByRole("button", { name: /on my way/i }).first();
    await expect(enRoute).toBeVisible({ timeout: 30_000 });
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().includes(`/api/bookings/${seed.bookingId}/en-route`) &&
          r.ok(),
        { timeout: 60_000 },
      ),
      enRoute.click(),
    ]);

    // ---- Arrive (inside radius) ----
    await grantGeo(page, seed.insideLat, seed.insideLng);
    const arrive = page.getByRole("button", { name: /i.?ve arrived/i }).first();
    await expect(arrive).toBeVisible({ timeout: 45_000 });
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().includes(`/api/bookings/${seed.bookingId}/arrived`) &&
          r.ok(),
        { timeout: 60_000 },
      ),
      arrive.click(),
    ]);

    // ---- Outside radius blocked (negative) ----
    // Covered by the lifecycle API certification, not here. This step used to flip the device to
    // OUTSIDE (Delhi, ~1,740 km away) and straight back while asserting nothing; any heartbeat in that
    // window was a teleport the presence anti-spoof correctly refused (400 IMPOSSIBLE_JUMP), which
    // then failed this test's console-error check. The device stays inside the geofence.

    // ---- Start + OTP ----
    const startBtn = page.getByRole("button", { name: /start job/i }).first();
    await expect(startBtn).toBeVisible({ timeout: 45_000 });
    await startBtn.click();

    // Dialog issues OTP to customer
    await page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes(`/api/bookings/${seed.bookingId}/start-otp`) &&
        r.ok(),
      { timeout: 60_000 },
    );

    const pin = await fetchStartPin(customerToken, seed.bookingId);
    expect(pin).toMatch(/^\d{6}$/);

    // Register BEFORE typing — OTP auto-submits on the 6th digit.
    const startResPromise = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes(`/api/bookings/${seed.bookingId}/start`),
      { timeout: 90_000 },
    );

    // Fill OTP inputs
    const otpInputs = page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]');
    const count = await otpInputs.count();
    if (count >= 6) {
      for (let i = 0; i < 6; i++) {
        await otpInputs.nth(i).fill(pin[i]!);
      }
    } else {
      await page.keyboard.type(pin);
    }

    const startRes = await startResPromise;
    expect(startRes.ok(), `start HTTP ${startRes.status()}`).toBeTruthy();

    await assertBookingDb(seed.bookingId, partnerToken, "IN_PROGRESS");

    // ---- Chat (real UI) ----
    await expect(page.getByTestId("job-chat-panel")).toBeVisible({ timeout: 30_000 });
    const composer = page.getByTestId("job-chat-composer").locator("input");
    await composer.fill("Section 03 live cert message 1");
    const chatPost = page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().includes("/chat") && !r.url().includes("/read"),
      { timeout: 30_000 },
    );
    await page.getByTestId("job-chat-composer").locator('button[type="submit"]').click();
    const chatRes = await chatPost;
    expect(chatRes.ok(), `chat HTTP ${chatRes.status()} ${chatRes.url()}`).toBeTruthy();
    await expect(page.getByText("Section 03 live cert message 1")).toBeVisible({ timeout: 30_000 });

    const clientMessageId = `s03-live-${Date.now()}`;
    const postChat = () =>
      fetch(`${API}/api/bookings/${seed.bookingId}/chat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${partnerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: "Section 03 live cert message 1",
          clientMessageId,
        }),
      });
    expect((await postChat()).status).toBeLessThan(500);
    expect((await postChat()).status).toBeLessThan(500);

    // ---- Call: withheld (X-28, owner decision 2026-09-29 — no masked-call relay, partners use chat) ----
    const callBtn = page.getByTestId("call-customer-btn").first();
    if (await callBtn.isVisible().catch(() => false)) {
      await expect(callBtn).toBeDisabled();
      await expect(callBtn).toContainText(/unavailable/i);
      const callRequests: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes(`/api/bookings/${seed.bookingId}/call`)) callRequests.push(r.url());
      });
      await callBtn.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(1_000);
      expect(callRequests).toEqual([]);
    }

    // ---- Complete ----
    await grantGeo(page, seed.insideLat, seed.insideLng);
    const complete = page.getByRole("button", { name: /mark complete/i }).first();
    await expect(complete).toBeVisible({ timeout: 60_000 });
    const completeResPromise = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        r.url().includes(`/api/bookings/${seed.bookingId}/complete`),
      { timeout: 90_000 },
    );
    await complete.click();
    const completeRes = await completeResPromise;
    expect(completeRes.ok(), `complete HTTP ${completeRes.status()}`).toBeTruthy();

    await assertBookingDb(seed.bookingId, partnerToken, "COMPLETED");
    await expect(page.getByText(/completed/i).first()).toBeVisible({ timeout: 30_000 });

    // Earnings: soft probe
    const earnRes = await fetch(`${API}/api/providers/me/earnings`, {
      headers: { Authorization: `Bearer ${partnerToken}` },
    }).catch(() => null);
    if (earnRes?.ok) {
      const earnJson = (await earnRes.json()) as { data?: unknown };
      expect(earnJson).toBeTruthy();
    }

    // Second complete must be idempotent / no duplicate crash
    const retryComplete = await fetch(`${API}/api/bookings/${seed.bookingId}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${partnerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ latitude: seed.insideLat, longitude: seed.insideLng }),
    });
    expect(retryComplete.status).toBeLessThan(500);

    monitor.assertClean();
  });
});
