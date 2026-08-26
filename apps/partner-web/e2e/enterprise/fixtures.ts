import { test as base, expect, type Page } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

export type EnterpriseMonitor = {
  consoleErrors: string[];
  failedApi: Array<{ url: string; status: number }>;
  assertClean: () => void;
};

export function attachEnterpriseMonitor(page: Page): EnterpriseMonitor {
  const consoleErrors: string[] = [];
  const failedApi: Array<{ url: string; status: number }> = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (/favicon|hydration|devtools|401 \(Unauthorized\)|404 \(Not Found\)|_next\/static|429 \(\)|hot-reloader|hmr|fast refresh|webpack-hmr|Failed to fetch.*hmr|Failed to load resource: the server responded with a status of 500/i.test(t)) return;
      consoleErrors.push(t);
    }
  });
  page.on("response", (res) => {
    if (res.url().includes("/api/") && !/sentry\.io/i.test(res.url()) && res.status() >= 400 && res.status() !== 401 && res.status() !== 403 && res.status() !== 404) {
      failedApi.push({ url: res.url(), status: res.status() });
    }
  });
  return {
    consoleErrors,
    failedApi,
    assertClean() {
      expect(consoleErrors).toEqual([]);
      expect(failedApi).toEqual([]);
    },
  };
}

export const SEED_PARTNER = { email: "partner@homigo.demo", password: "Homigo@123" };

export async function partnerLogin(page: Page) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await expect(page.locator("#partner-email")).toBeVisible({ timeout: 30_000 });
  await page.locator("#partner-email").click();
  await page.locator("#partner-email").fill("");
  await page.locator("#partner-email").pressSequentially(SEED_PARTNER.email, { delay: 20 });
  await page.locator("#partner-password").click();
  await page.locator("#partner-password").fill("");
  await page.locator("#partner-password").pressSequentially(SEED_PARTNER.password, { delay: 20 });

  const loginRes = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes("/api/auth/login") && r.status() === 200,
    { timeout: 60_000 },
  );
  const meRes = page.waitForResponse(
    (r) => r.url().includes("/api/user/me") && r.status() === 200,
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await Promise.all([loginRes, meRes]);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /new booking requests/i })).toBeVisible({
    timeout: 60_000,
  });
}

export async function partnerToken() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: SEED_PARTNER.email,
      password: SEED_PARTNER.password,
      setAuthCookies: false,
    }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string } };
  return json.data?.accessToken ?? "";
}

export const test = base.extend<{ monitor: EnterpriseMonitor }>({
  monitor: async ({ page }, use) => {
    const monitor = attachEnterpriseMonitor(page);
    await use(monitor);
    monitor.assertClean();
  },
});
