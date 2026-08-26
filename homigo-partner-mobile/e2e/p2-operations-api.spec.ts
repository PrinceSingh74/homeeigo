import { expect, test } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SEED = { email: "partner@homigo.demo", password: "Homigo@123" };

test.describe("Section 02 mobile API parity", () => {
  test("same operations endpoints as web", async () => {
    const login = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...SEED, setAuthCookies: false }),
    });
    const json = (await login.json()) as { data?: { accessToken?: string }; error?: string };
    expect(login.ok, json.error ?? "login failed").toBeTruthy();
    const token = json.data?.accessToken;
    expect(token).toBeTruthy();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const ops = await fetch(`${API}/api/providers/me/operations`, { headers });
    const body = (await ops.json()) as {
      success?: boolean;
      error?: string;
      data?: { capacity?: { maxConcurrentJobs?: number }; operationalStatus?: string };
    };
    expect(ops.ok, body.error ?? "operations failed").toBeTruthy();
    expect(body.data?.capacity?.maxConcurrentJobs).toBeGreaterThan(0);
    expect(body.data?.operationalStatus).toBeTruthy();
  });
});
