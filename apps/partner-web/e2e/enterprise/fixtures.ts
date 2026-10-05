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
      if (/favicon|hydration|devtools|401 \(Unauthorized\)|404 \(Not Found\)|_next\/static|429 \(\)|hot-reloader|hmr|fast refresh|webpack-hmr|Failed to fetch.*hmr|Failed to load resource: the server responded with a status of 500|ChunkLoadError|Loading chunk /i.test(t)) return;
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

/** React 19 attaches `_valueTracker` only after hydration. Typing earlier is wiped and Sign in never posts. */
export async function waitForPartnerFormHydration(page: Page) {
  await page.waitForFunction(() => {
    const el = document.querySelector("#partner-email") as (HTMLInputElement & { _valueTracker?: unknown }) | null;
    return Boolean(el?._valueTracker);
  });
}

const DEV_CRASH = /Unexpected end of JSON input|Loading chunk|ChunkLoadError|client-side exception has occurred/i;

/**
 * The browser's chunk loader gives up while webpack is still compiling (common after a long
 * dev session). A reload then hits the same timeout. Fetch the chunk from Node first so the
 * compile finishes, then reload. A product error that is still on screen after that still fails.
 */
async function warmFailedDevChunk(page: Page) {
  const body = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  const found = body.match(/https?:\/\/[^\s)]+\.js/g) ?? [];
  const origin = new URL(page.url()).origin;
  const chunkUrls = found.filter((u) => u.includes("/_next/static/chunks/"));
  const urls = [...new Set(chunkUrls.length > 0 ? chunkUrls : [`${origin}/_next/static/chunks/app/layout.js`])];
  for (const url of urls.slice(0, 2)) {
    await page.request.get(url, { timeout: 90_000, failOnStatusCode: false }).catch(() => null);
  }
}

/**
 * Next dev sometimes aborts the client chunk mid-navigation (`net::ERR_ABORTED` on main-app.js).
 * The document then stays on the server-rendered auth spinner because hydration never starts.
 * One warm + reload. A product hang survives the reload and the caller's assertion still fails.
 */
export async function recoverDevChunkAbort(page: Page) {
  const spinner = page.locator("div.h-8.w-8.animate-spin");
  const devCrash = page.getByText(DEV_CRASH).first();
  const gone = await spinner.waitFor({ state: "hidden", timeout: 12_000 }).then(() => true).catch(() => false);
  const crashed = await devCrash.isVisible().catch(() => false);
  const stuckSpinner = !gone && (await spinner.isVisible().catch(() => false));
  if (!stuckSpinner && !crashed) return;
  if (crashed) await warmFailedDevChunk(page);
  await page.reload({ waitUntil: "domcontentloaded" });
}

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
      const crash = page.getByText(DEV_CRASH).first();
      // The login form and the dev chunk overlay are mutually exclusive. Waiting only for the
      // form burns the whole attempt while webpack is still compiling layout.js.
      const surface = await Promise.race([
        email.waitFor({ state: "visible", timeout: 25_000 }).then(() => "email" as const),
        crash.waitFor({ state: "visible", timeout: 25_000 }).then(() => "crash" as const),
      ]).catch(() => "timeout" as const);
      if (surface !== "email") {
        await warmFailedDevChunk(page);
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(email).toBeVisible({ timeout: 30_000 });
      }
      await expect(email).toBeEnabled({ timeout: 15_000 });
      await waitForPartnerFormHydration(page);
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
        (r) => r.url().includes("/api/user/me") && r.request().method() === "GET",
        { timeout: 30_000 },
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
      const me = await meRes;
      if (me.status() !== 200) {
        const body = await me.text().catch(() => "");
        throw new Error(`me HTTP ${me.status()}: ${body.slice(0, 300)}`);
      }
      await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { name: /new booking requests/i })).toBeVisible({
        timeout: 60_000,
      });
      return;
    } catch (err) {
      lastErr = err;
      if (page.isClosed()) break;
      await page.waitForTimeout(500 * (attempt + 1)).catch(() => undefined);
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
