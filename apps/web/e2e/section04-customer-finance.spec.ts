import { expect } from "@playwright/test";
import { apiLogin, gotoAuthedCustomer, SEED_CUSTOMER, test } from "./enterprise/fixtures";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

test.describe.configure({ mode: "serial" });

test.describe("Section 04 customer finance isolation", () => {
  test("wallet and receipts stay on customer money — no partner finance leakage", async ({
    page,
    monitor,
  }) => {
    await gotoAuthedCustomer(page, "/wallet", SEED_CUSTOMER);
    await expect(page.getByText(/wallet|balance|homigo/i).first()).toBeVisible({ timeout: 30_000 });

    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toMatch(/partner payout|provider payable|ifsc|withdraw to bank|partner incentive/);
    expect(body).not.toMatch(/available balance to withdraw/);

    await page.goto("/bookings");
    await page.waitForResponse((r) => r.url().includes("/api/users/bookings") && r.ok(), {
      timeout: 30_000,
    }).catch(() => null);
    const bookings = (await page.locator("body").innerText()).toLowerCase();
    expect(bookings).not.toMatch(/partner wallet|payout history|partner bank/);
    monitor.assertClean();
  });

  test("customer token is rejected on partner finance APIs", async () => {
    const session = await apiLogin(SEED_CUSTOMER.email, SEED_CUSTOMER.password);
    const headers = { Authorization: `Bearer ${session.token}` };

    const payouts = await fetch(`${API}/api/providers/me/payouts`, { headers });
    expect([401, 403, 404]).toContain(payouts.status);

    const incentives = await fetch(`${API}/api/providers/me/incentives`, { headers });
    expect([401, 403, 404]).toContain(incentives.status);

    const withdraw = await fetch(`${API}/api/wallet/withdraw`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: 1,
        bankAccountNumber: "123456789012",
        ifscCode: "HDFC0001234",
        accountHolder: "Attacker",
      }),
    });
    expect([400, 401, 403, 404]).toContain(withdraw.status);

    const wallet = await fetch(`${API}/api/wallet/balance`, { headers });
    expect(wallet.ok).toBe(true);
    const json = (await wallet.json()) as { data?: Record<string, unknown> };
    const blob = JSON.stringify(json.data ?? {});
    expect(blob).not.toMatch(/ifsc|accountNumber|partnerIncentive|providerPayable/i);
  });
});
