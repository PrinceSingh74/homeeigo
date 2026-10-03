import { expect } from "@playwright/test";
import { apiLogin, gotoAuthedCustomer, SEED_CUSTOMER, test } from "./enterprise/fixtures";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

test.describe("Section 05 customer privacy", () => {
  test("settings explain partner-safe contact and hide internal risk", async ({ page, monitor }) => {
    await gotoAuthedCustomer(page, "/settings", SEED_CUSTOMER);
    await expect(page.getByText(/partners only see/i).first()).toBeVisible({ timeout: 30_000 });
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toMatch(/risk score|gps_spoof|kyc document number/);
    monitor.assertClean();
  });

  test("customer token cannot read partner risk, SOS, or admin trust-safety", async () => {
    const session = await apiLogin(SEED_CUSTOMER.email, SEED_CUSTOMER.password);
    const headers = { Authorization: `Bearer ${session.token}` };
    const sos = await fetch(`${API}/api/providers/me/safety/sos`, { method: "POST", headers, body: "{}" });
    expect([401, 403, 404]).toContain(sos.status);
    const risk = await fetch(`${API}/api/admin/trust-safety/risk`, { headers });
    expect([401, 403, 404]).toContain(risk.status);
    const incidents = await fetch(`${API}/api/admin/trust-safety/incidents`, { headers });
    expect([401, 403, 404]).toContain(incidents.status);
  });
});
