import { expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { adminApiToken, adminLogin, MINIMAL_PDF_BASE64, test } from "./fixtures";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SEED_PATH = path.join(__dirname, "ops-seed.json");

type OpsSeed = {
  withdrawalId: string;
  chargebackId: string;
  discrepancyId: string;
  providerId: string;
  approverEmail: string;
  approverPassword: string;
  customerId: string | null;
  serviceId: string | null;
  addressId: string | null;
};

function loadSeed(): OpsSeed {
  if (!fs.existsSync(SEED_PATH)) {
    throw new Error(`Missing ${SEED_PATH} — run: bun --env-file=.env run scripts/enterprise/seed-playwright-ops-data.ts`);
  }
  return JSON.parse(fs.readFileSync(SEED_PATH, "utf8")) as OpsSeed;
}

async function api(token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as { success?: boolean; data?: unknown; error?: string };
  return { ok: res.ok, status: res.status, json };
}

test.describe.configure({ mode: "serial" });

test.describe("Enterprise Operations Certification", () => {
  let seed: OpsSeed;
  let token: string;

  test.beforeAll(async () => {
    seed = loadSeed();
    token = await adminApiToken();
    expect(token.length).toBeGreaterThan(10);
  });

  test("admin login + dashboard", async ({ page, monitor }) => {
    await adminLogin(page);
    await expect(page.getByRole("heading", { name: /business overview/i })).toBeVisible({ timeout: 30_000 });
    const dash = page.waitForResponse((r) => r.url().includes("/api/admin/dashboard") && r.ok(), { timeout: 30_000 });
    await page.goto("/");
    await dash;
    monitor.assertClean();
  });

  test("bookings list loads", async ({ page, monitor }) => {
    await adminLogin(page);
    const res = page.waitForResponse((r) => r.url().includes("/api/admin/bookings") && r.ok(), { timeout: 30_000 });
    await page.goto("/bookings");
    await res;
    await expect(page.getByRole("heading", { name: /^bookings$/i })).toBeVisible();
    monitor.assertClean();
  });

  test("support console loads", async ({ page, monitor }) => {
    await adminLogin(page);
    await page.goto("/support");
    await expect(page.getByRole("heading", { name: /support/i }).first()).toBeVisible({ timeout: 30_000 });
    monitor.assertClean();
  });

  test("payout batch workflow (API + UI)", async ({ page, monitor }) => {
    const create = await api(token, "POST", "/api/admin/finance/payouts/batch", {
      withdrawalIds: [seed.withdrawalId],
    });
    expect(create.ok).toBe(true);
    const batchId = (create.json.data as { batch: { id: string } }).batch.id;

    await api(token, "POST", `/api/admin/finance/payouts/batch/${batchId}/submit`, {});
    const approverToken = await loginToken(seed.approverEmail, seed.approverPassword);
    const approve = await api(approverToken, "POST", `/api/admin/finance/payouts/batch/${batchId}/approve`, {});
    expect(approve.ok).toBe(true);

    await adminLogin(page);
    const res = page.waitForResponse((r) => r.url().includes("/api/admin/finance/payouts") && r.ok(), { timeout: 30_000 });
    await page.goto("/finance/payouts");
    await res;
    await expect(page.getByRole("heading", { name: /payout operations/i })).toBeVisible();
    await expect(page.getByText(/payout batches/i)).toBeVisible();
    monitor.assertClean();
  });

  test("chargeback evidence flow (API + detail UI)", async ({ page, monitor }) => {
    const pdf = MINIMAL_PDF_BASE64;
    const upload = await api(token, "POST", `/api/admin/finance/chargebacks/${seed.chargebackId}/evidence`, {
      fileBase64: pdf,
      fileName: "playwright-evidence.pdf",
      description: "Playwright certification upload",
    });
    expect(upload.ok).toBe(true);

    const pkg = await api(token, "GET", `/api/admin/finance/chargebacks/${seed.chargebackId}/evidence-package`);
    expect(pkg.ok).toBe(true);

    await api(token, "POST", `/api/admin/finance/chargebacks/${seed.chargebackId}/respond`, {
      responseText: "Evidence submitted per policy.",
    });

    const detail = await api(token, "GET", `/api/admin/finance/chargebacks/${seed.chargebackId}`);
    expect(detail.ok).toBe(true);
    const timeline = (detail.json.data as { chargeback: { timeline: unknown[] } }).chargeback.timeline;
    expect(timeline.length).toBeGreaterThan(0);

    await adminLogin(page);
    await page.goto(`/finance/chargebacks/${seed.chargebackId}`);
    await expect(page.getByRole("heading", { name: /chargeback/i })).toBeVisible({ timeout: 30_000 });
    monitor.assertClean();
  });

  test("settlement resolution flow (API + UI)", async ({ page, monitor }) => {
    await api(token, "POST", `/api/admin/finance/settlement-sync/discrepancies/${seed.discrepancyId}/assign`, {});
    await api(token, "POST", `/api/admin/finance/settlement-sync/discrepancies/${seed.discrepancyId}/investigate`, {});

    const health = await api(token, "GET", "/api/admin/finance/settlement-sync/health");
    expect(health.ok).toBe(true);

    await adminLogin(page);
    const res = page.waitForResponse((r) => r.url().includes("/api/admin/finance/settlement-sync") && r.ok(), { timeout: 30_000 });
    await page.goto("/finance/settlement-sync");
    await res;
    await expect(page.getByRole("heading", { name: /settlement sync/i })).toBeVisible();
    monitor.assertClean();
  });

  test("booking operations flow (API)", async () => {
    if (!seed.customerId || !seed.serviceId || !seed.addressId) {
      test.skip();
      return;
    }

    const slot = new Date(Date.now() + 72 * 3_600_000).toISOString();
    const createRes = await fetch(`${API}/api/bookings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await customerToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        serviceId: seed.serviceId,
        scheduledDate: slot,
        addressId: seed.addressId,
      }),
    });
    const created = (await createRes.json()) as { data?: { booking?: { id: string } } };
    const bookingId = created.data?.booking?.id;
    expect(bookingId).toBeTruthy();

    await api(token, "POST", `/api/admin/bookings/${bookingId}/reassign`, {
      providerId: seed.providerId,
      reason: "Playwright certification reassignment",
    });
    await api(token, "POST", `/api/admin/bookings/${bookingId}/dispatch`, {
      reason: "Playwright certification dispatch",
    });
    await api(token, "POST", `/api/admin/bookings/${bookingId}/repair`, {
      reason: "Playwright certification repair",
    });

    const detail = await api(token, "GET", `/api/admin/bookings/${bookingId}`);
    expect(detail.ok).toBe(true);
    const timeline = (detail.json.data as { timeline: unknown[] }).timeline;
    expect(timeline.length).toBeGreaterThan(0);
  });
});

async function customerToken(): Promise<string> {
  return loginToken("customer@homigo.demo", "Homigo@123");
}

async function loginToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string } };
  return json.data?.accessToken ?? "";
}
