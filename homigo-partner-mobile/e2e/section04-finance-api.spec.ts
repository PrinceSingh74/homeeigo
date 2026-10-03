/**
 * Section 04 — Partner finance API certification (mobile client contract).
 * Uses real backend; no mocked wallet state.
 */
import { describe, expect, test, beforeAll } from "bun:test";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PARTNER = {
  email: process.env.E2E_PARTNER_EMAIL ?? "partner@homigo.demo",
  password: process.env.E2E_PARTNER_PASSWORD ?? "Homigo@123",
};

let token = "";
let providerId = "";

async function login() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: PARTNER.email, password: PARTNER.password, setAuthCookies: false }),
  });
  const json = (await res.json()) as { success?: boolean; data?: { accessToken?: string; user?: { provider?: { id?: string } } } };
  if (!res.ok || !json.data?.accessToken) throw new Error("Partner login failed");
  token = json.data.accessToken;
  providerId = json.data.user?.provider?.id ?? "";
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = (await res.json()) as { success?: boolean; data?: T };
  if (!res.ok || !json.success) throw new Error(`GET ${path} failed: ${res.status}`);
  return json.data as T;
}

describe.serial("Section 04 partner finance API (mobile contract)", () => {
  beforeAll(async () => {
    await login();
    expect(token.length).toBeGreaterThan(10);
  });

  test("payouts finance center returns authoritative balances", async () => {
    const data = await apiGet<{
      currentBalance: number;
      availableBalance: number;
      pendingBalance: number;
      lifetimeEarnings: number;
      withdrawals: Array<{ id: string; reference: string; status: string; netAmount: number }>;
    }>("/api/providers/me/payouts");

    expect(typeof data.currentBalance).toBe("number");
    expect(typeof data.availableBalance).toBe("number");
    expect(typeof data.pendingBalance).toBe("number");
    expect(data.availableBalance).toBeLessThanOrEqual(data.currentBalance + 0.01);
    expect(Array.isArray(data.withdrawals)).toBe(true);
    for (const w of data.withdrawals.slice(0, 3)) {
      expect(w.reference).toBeTruthy();
      expect(typeof w.netAmount).toBe("number");
    }
  });

  test("incentives expose progress and paid state fields", async () => {
    const data = await apiGet<{
      rules: Array<{
        id: string;
        current: number;
        threshold: number;
        eligible: boolean;
        paid?: boolean;
        payoutAmount?: number | null;
      }>;
      payouts: Array<{ id: string; amount: number; status: string }>;
    }>("/api/providers/me/incentives");

    expect(Array.isArray(data.rules)).toBe(true);
    for (const r of data.rules) {
      expect(r.threshold).toBeGreaterThan(0);
      expect(r.current).toBeGreaterThanOrEqual(0);
      if (r.paid) {
        expect(r.payoutAmount).toBeGreaterThan(0);
      }
    }
    expect(Array.isArray(data.payouts)).toBe(true);
  });

  test("withdraw rejects amount above available balance", async () => {
    const payouts = await apiGet<{ availableBalance: number }>("/api/providers/me/payouts");
    const res = await fetch(`${API}/api/wallet/withdraw`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.max(1, Math.ceil(payouts.availableBalance + 10_000)),
        bankAccountNumber: "123456789012",
        ifscCode: "HDFC0001234",
        accountHolder: "Section04 Test",
      }),
    });
    expect([400, 402, 403]).toContain(res.status);
  });

  test("partner B cannot read partner A payouts", async () => {
    if (!providerId) return;
    const otherLogin = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.E2E_PARTNER_B_EMAIL ?? "partner2@homigo.demo",
        password: process.env.E2E_PARTNER_B_PASSWORD ?? "Homigo@123",
        setAuthCookies: false,
      }),
    });
    if (!otherLogin.ok) {
      console.warn("SKIP: second partner fixture unavailable");
      return;
    }
    const otherJson = (await otherLogin.json()) as { data?: { accessToken?: string } };
    const otherToken = otherJson.data?.accessToken;
    if (!otherToken) return;

    const res = await fetch(`${API}/api/providers/me/payouts`, {
      headers: { Authorization: `Bearer ${otherToken}` },
    });
    expect(res.ok).toBe(true);
    const json = (await res.json()) as { data?: { withdrawals?: Array<{ id: string }> } };
    const ids = new Set((json.data?.withdrawals ?? []).map((w) => w.id));
    const aPayouts = await apiGet<{ withdrawals: Array<{ id: string }> }>("/api/providers/me/payouts");
    for (const w of aPayouts.withdrawals) {
      expect(ids.has(w.id)).toBe(false);
    }
  });
});
