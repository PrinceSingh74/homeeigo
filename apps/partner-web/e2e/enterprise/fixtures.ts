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
    if (res.url().includes("/api/") && !/sentry\.io/i.test(res.url()) && res.status() >= 400 && res.status() !== 401 && res.status() !== 403 && res.status() !== 404 && res.status() !== 429) {
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
  await page.context().clearCookies();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto("/login", { waitUntil: "domcontentloaded" });
      const email = page.locator("#partner-email");
      const password = page.locator("#partner-password");
      await expect(email).toBeVisible({ timeout: 30_000 });
      await expect(email).toBeEnabled({ timeout: 15_000 });
      // Controlled React inputs: clear + type so onChange commits state (fill alone can leave state empty → no POST).
      await email.click();
      await email.fill("");
      await email.pressSequentially(SEED_PARTNER.email, { delay: 20 });
      await password.click();
      await password.fill("");
      await password.pressSequentially(SEED_PARTNER.password, { delay: 20 });
      await expect(email).toHaveValue(SEED_PARTNER.email);
      await expect(password).toHaveValue(SEED_PARTNER.password);

      const button = page.getByRole("button", { name: /^sign in$/i });
      await expect(button).toBeEnabled({ timeout: 15_000 });
      const loginRes = page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url().includes("/api/auth/login"),
        { timeout: 60_000 },
      );
      const meRes = page.waitForResponse(
        (r) => r.url().includes("/api/user/me") && r.status() === 200,
        { timeout: 60_000 },
      );
      await button.click();
      const res = await loginRes;
      if (res.status() === 429) {
        await page.waitForTimeout(2_000 * (attempt + 1));
        throw new Error(`login rate-limited (429) attempt ${attempt + 1}`);
      }
      if (res.status() !== 200) {
        const body = await res.text().catch(() => "");
        throw new Error(`login HTTP ${res.status()}: ${body.slice(0, 300)}`);
      }
      await meRes;
      await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { name: /new booking requests/i })).toBeVisible({
        timeout: 60_000,
      });
      return;
    } catch (err) {
      lastErr = err;
      await page.waitForTimeout(500 * (attempt + 1));
    }
  }
  throw lastErr;
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
