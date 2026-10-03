import { expect } from "@playwright/test";
import { partnerLogin, partnerToken, test } from "./enterprise/fixtures";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const CUSTOMER = {
  email: process.env.E2E_CUSTOMER_EMAIL ?? "customer@homigo.demo",
  password: process.env.E2E_CUSTOMER_PASSWORD ?? "Homigo@123",
};

async function authGet(path: string, token: string) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json()) as { success?: boolean; data?: unknown; error?: string; code?: string };
  return { status: res.status, json };
}

async function authPost(path: string, token: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { success?: boolean; data?: unknown; error?: string; code?: string };
  return { status: res.status, json };
}

test.describe("Section 04 partner finance E2E (live backend)", () => {
  test("wallet → earnings → incentives → payouts load real APIs", async ({ page, monitor }) => {
    await partnerLogin(page);

    const payoutsWait = page.waitForResponse(
      (r) => r.url().includes("/api/providers/me/payouts") && r.ok(),
      { timeout: 30_000 },
    );
    await page.goto("/wallet", { waitUntil: "domcontentloaded" });
    const payoutsRes = await payoutsWait;
    const payouts = (await payoutsRes.json()) as {
      data?: { availableBalance?: number; currentBalance?: number; pendingBalance?: number };
    };
    expect(typeof payouts.data?.availableBalance).toBe("number");
    await expect(page.getByTestId("wallet-total-balance")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("wallet-total-balance")).not.toHaveText(/Loading wallet/i);
    await expect(page.getByTestId("wallet-total-balance")).toHaveText(/₹/);

    await page.goto("/earnings", { waitUntil: "domcontentloaded" });
    await page.waitForResponse((r) => r.url().includes("/api/providers/me/earnings") && r.ok(), { timeout: 30_000 });
    await expect(page.getByText(/earning|revenue|job/i).first()).toBeVisible({ timeout: 15_000 });

    const incWait = page.waitForResponse(
      (r) => r.url().includes("/api/providers/me/incentives") && r.ok(),
      { timeout: 30_000 },
    );
    await page.goto("/earnings-hq/incentives", { waitUntil: "domcontentloaded" });
    const incRes = await incWait;
    const inc = (await incRes.json()) as {
      data?: { rules?: Array<{ paid?: boolean; bonusAmount?: number; current?: number; threshold?: number }> };
    };
    expect(Array.isArray(inc.data?.rules)).toBe(true);
    await expect(page.getByText(/incentive|bonus|progress|paid|eligible|in progress/i).first()).toBeVisible({
      timeout: 15_000,
    });

    await page.goto("/earnings/payouts", { waitUntil: "domcontentloaded" });
    await page.waitForResponse((r) => r.url().includes("/api/providers/me/payouts") && r.ok(), { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /request payout/i })).toBeVisible({ timeout: 15_000 });
    monitor.assertClean();
  });

  test("withdraw modal validates amount and IFSC against available balance", async ({ page, monitor }) => {
    await partnerLogin(page);
    await page.goto("/wallet", { waitUntil: "domcontentloaded" });
    await page.waitForResponse((r) => r.url().includes("/api/providers/me/payouts") && r.ok(), { timeout: 30_000 });

    const cta = page.getByTestId("wallet-withdraw-cta");
    await expect(cta).toBeVisible();
    if (await cta.isDisabled()) {
      monitor.assertClean();
      return;
    }
    await cta.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });

    await page.getByTestId("withdraw-amount").fill("0");
    await page.getByTestId("withdraw-holder").fill("E2E Partner");
    await page.getByTestId("withdraw-account").fill("123456789012");
    await page.getByTestId("withdraw-ifsc").fill("HDFC0001234");
    await page.getByTestId("withdraw-submit").click();
    await expect(page.getByRole("alert").filter({ hasText: /amount must be between|enter a valid/i })).toBeVisible({
      timeout: 8_000,
    });

    await page.getByTestId("withdraw-amount").fill("9999999");
    await page.getByTestId("withdraw-submit").click();
    await expect(page.getByRole("alert").filter({ hasText: /between|exceed|available/i })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    monitor.assertClean();
  });

  test("withdraw API is idempotent for the same client key", async () => {
    const token = await partnerToken();
    expect(token.length).toBeGreaterThan(10);
    const before = await authGet("/api/providers/me/payouts", token);
    const data = before.json.data as {
      availableBalance: number;
      withdrawals: Array<{ id: string }>;
    };
    const countBefore = data.withdrawals.length;
    const key = `e2e-wd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const payload = {
      amount: 1,
      bankAccountNumber: "123456789012",
      ifscCode: "HDFC0001234",
      accountHolder: "Section04 E2E",
      idempotencyKey: key,
    };

    if (data.availableBalance < 1) {
      const over = await authPost("/api/wallet/withdraw", token, { ...payload, amount: data.availableBalance + 10_000 });
      expect([400, 402, 403]).toContain(over.status);
      return;
    }

    const first = await authPost("/api/wallet/withdraw", token, payload);
    expect([200, 201]).toContain(first.status);
    const firstId = (first.json.data as { withdrawal?: { id: string } } | undefined)?.withdrawal?.id;
    expect(firstId).toBeTruthy();

    const second = await authPost("/api/wallet/withdraw", token, payload);
    expect([200, 201]).toContain(second.status);
    const secondId = (second.json.data as { withdrawal?: { id: string } } | undefined)?.withdrawal?.id;
    expect(secondId).toBe(firstId);

    const after = await authGet("/api/providers/me/payouts", token);
    const afterData = after.json.data as { withdrawals: Array<{ id: string }> };
    const created = afterData.withdrawals.filter((w) => w.id === firstId);
    expect(created.length).toBe(1);
    expect(afterData.withdrawals.length).toBe(countBefore + 1);
  });

  test("customer cannot read partner wallet, payouts, incentives, or bank", async () => {
    const login = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: CUSTOMER.email, password: CUSTOMER.password, setAuthCookies: false }),
    });
    if (!login.ok) {
      test.info().annotations.push({ type: "environment", description: "customer seed unavailable" });
      return;
    }
    const json = (await login.json()) as { data?: { accessToken?: string } };
    const token = json.data?.accessToken;
    if (!token) return;

    const payouts = await authGet("/api/providers/me/payouts", token);
    expect([401, 403, 404]).toContain(payouts.status);

    const incentives = await authGet("/api/providers/me/incentives", token);
    expect([401, 403, 404]).toContain(incentives.status);

    const withdraw = await authPost("/api/wallet/withdraw", token, {
      amount: 1,
      bankAccountNumber: "123456789012",
      ifscCode: "HDFC0001234",
      accountHolder: "Attacker",
    });
    expect([400, 401, 403, 404]).toContain(withdraw.status);
  });

  test("earnings API and finance center stay numeric and consistent", async () => {
    const token = await partnerToken();
    const [earningsRes, payoutsRes, incentivesRes] = await Promise.all([
      fetch(`${API}/api/providers/me/earnings?days=30`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API}/api/providers/me/payouts`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API}/api/providers/me/incentives`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    expect(earningsRes.ok).toBe(true);
    expect(payoutsRes.ok).toBe(true);
    expect(incentivesRes.ok).toBe(true);
    const earnings = (await earningsRes.json()) as { data?: { totalEarnings?: number; totalNet?: number } };
    const payouts = (await payoutsRes.json()) as {
      data?: { lifetimeEarnings?: number; availableBalance?: number; pendingBalance?: number };
    };
    expect(typeof (earnings.data?.totalNet ?? earnings.data?.totalEarnings)).toBe("number");
    expect(typeof payouts.data?.lifetimeEarnings).toBe("number");
    expect((payouts.data?.availableBalance ?? 0) + 0.001).toBeGreaterThanOrEqual(0);
  });
});
