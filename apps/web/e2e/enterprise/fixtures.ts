import { test as base, expect, type Page } from "@playwright/test";
import { fillReactControlled } from "../helpers";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

export type EnterpriseMonitor = {
  consoleErrors: string[];
  failedApi: Array<{ url: string; status: number }>;
  apiCalls: Array<{ url: string; status: number; method: string }>;
  assertClean: () => void;
};

export function attachEnterpriseMonitor(page: Page): EnterpriseMonitor {
  const consoleErrors: string[] = [];
  const failedApi: Array<{ url: string; status: number }> = [];
  const apiCalls: Array<{ url: string; status: number; method: string }> = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (
        /favicon|hydration|devtools|404 \(Not Found\)|chunk|_next\/static|401 \(Unauthorized\)|429 \(Too Many Requests\)|504 \(Gateway Timeout\)|hot-reloader|hmr|fast refresh|webpack-hmr|Failed to fetch.*hmr/i.test(
          t,
        )
      ) {
        return;
      }
      consoleErrors.push(t);
    }
  });

  page.on("pageerror", (err) => {
    const t = err.message ?? String(err);
    if (/hydration|hmr|hot-reloader|ResizeObserver loop/i.test(t)) return;
    consoleErrors.push(`pageerror: ${t}`);
  });

  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("/api/")) return;
    const status = res.status();
    const method = res.request().method();
    apiCalls.push({ url, status, method });
    if (status >= 400 && status !== 401 && status !== 403 && status !== 404 && status !== 429) {
      failedApi.push({ url, status });
    }
  });

  return {
    consoleErrors,
    failedApi,
    apiCalls,
    assertClean() {
      expect(consoleErrors, `console errors: ${consoleErrors.join("; ")}`).toEqual([]);
      expect(failedApi, `failed API: ${JSON.stringify(failedApi)}`).toEqual([]);
    },
  };
}

export async function apiLogin(email: string, password: string) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  expect(res.ok, `login failed ${res.status}`).toBeTruthy();
  const json = (await res.json()) as {
    data?: {
      accessToken?: string;
      refreshToken?: string;
      user?: { id: string; email?: string; firstName?: string; lastName?: string };
    };
  };
  const token = json.data?.accessToken;
  const refreshToken = json.data?.refreshToken;
  if (!token || !refreshToken) throw new Error("missing tokens");
  return { token, refreshToken, user: json.data!.user!, userId: json.data!.user!.id };
}

export async function dismissCookieConsent(page: Page) {
  const accept = page.getByRole("button", { name: /^accept$/i });
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) {
    await accept.click();
  }
}

const WEB_BASE = (process.env.E2E_WEB_URL ?? "http://localhost:3001").replace(/\/$/, "");

export async function refreshSessionCookie(page: Page) {
  await page.context().addCookies([
    { name: "homigo_session", value: "1", url: WEB_BASE, sameSite: "Lax" },
  ]);
  await page
    .evaluate(() => {
      document.cookie = "homigo_session=1; Path=/; Max-Age=2592000; SameSite=Lax";
    })
    .catch(() => {
      /* no document yet — addInitScript on next navigation will set it */
    });
}

/** Seed zustand + middleware cookie on every navigation (survives page.goto). */
export async function seedCustomerBrowserSession(page: Page, email: string, password: string) {
  const session = await apiLogin(email, password);
  const me = await apiGet<{ success: boolean; data: { user: typeof session.user } }>(
    "/api/users/me",
    session.token,
  );
  const user = me.data.user;
  await injectCustomerSession(page, {
    user,
    accessToken: session.token,
    refreshToken: session.refreshToken,
  });
  await refreshSessionCookie(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await dismissCookieConsent(page);
}

async function injectCustomerSession(
  page: Page,
  data: { user: unknown; accessToken: string; refreshToken: string },
) {
  await page.addInitScript((payload) => {
    localStorage.setItem(
      "homigo-auth",
      JSON.stringify({
        state: {
          user: payload.user,
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
          status: "authenticated",
          error: null,
        },
        version: 0,
      }),
    );
    document.cookie = "homigo_session=1; Path=/; Max-Age=2592000; SameSite=Lax";
  }, data);
}

export async function gotoAuthedCustomer(
  page: Page,
  path: string,
  creds?: { email: string; password: string },
) {
  if (creds) {
    const session = await apiLogin(creds.email, creds.password);
    const me = await apiGet<{ success: boolean; data: { user: typeof session.user } }>(
      "/api/users/me",
      session.token,
    );
    await injectCustomerSession(page, {
      user: me.data.user,
      accessToken: session.token,
      refreshToken: session.refreshToken,
    });
  }
  await refreshSessionCookie(page);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  const accept = page.getByRole("button", { name: /^accept$/i });
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) {
    await accept.click();
  }
}

export async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok, `GET ${path} → ${res.status}`).toBeTruthy();
  return res.json() as Promise<T>;
}

export async function loginCustomerUi(page: Page, email: string, password: string) {
  await seedCustomerBrowserSession(page, email, password);
  await page.goto("/login", { waitUntil: "networkidle" });
  await dismissCookieConsent(page);
  const emailField = page.getByRole("textbox", { name: "Email" });
  if (await emailField.isVisible({ timeout: 5000 }).catch(() => false)) {
    await fillReactControlled(emailField, email);
    await fillReactControlled(page.getByRole("textbox", { name: "Password", exact: true }), password);
    const loginRes = page.waitForResponse(
      (r) => r.url().includes("/api/auth/login") && r.status() === 200,
      { timeout: 60_000 },
    );
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await loginRes;
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 30_000 });
  }
  await refreshSessionCookie(page);
}

export const SEED_CUSTOMER = {
  email: "customer@homigo.demo",
  password: "Homigo@123",
};

export const test = base.extend<{ monitor: EnterpriseMonitor }>({
  monitor: async ({ page }, use) => {
    const monitor = attachEnterpriseMonitor(page);
    await use(monitor);
    monitor.assertClean();
  },
});
