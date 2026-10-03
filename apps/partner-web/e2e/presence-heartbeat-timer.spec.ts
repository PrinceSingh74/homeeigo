/**
 * Partner Web P0 timer forensic: real Next.js app, real heartbeat loop, real API.
 * Auth is a DB-minted session (RefreshTokenService), not a weakened login path.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BACKEND = path.resolve(__dirname, "../../backend");

type Minted = {
  providerId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  user: {
    id: string;
    email: string;
    phoneNumber: string | null;
    firstName: string | null;
    lastName: string | null;
    profileImage: string | null;
    role: string;
    isEmailVerified: boolean;
    isPhoneVerified: boolean;
  };
};

function mintSession(): Minted {
  // The session must be minted in the SAME database the backend under test uses. CI: `.env` (the job's
  // own throwaway homigo_db). Locally against the isolated stack: E2E_BACKEND_ENV_FILE=.env.test.
  // The mint script refuses a non-test database unless `--allow-live` is given (it once minted live
  // sessions from a developer machine). Only a GitHub Actions runner — whose homigo_db is the job's own
  // throwaway container — passes it.
  const envFile = process.env.E2E_BACKEND_ENV_FILE
    ?? (process.env.GITHUB_ACTIONS === "true" ? ".env" : ".env.test");
  const liveFlag = process.env.GITHUB_ACTIONS === "true" ? ["--allow-live"] : [];
  const raw = execFileSync("bun", [`--env-file=${envFile}`, "run", "scripts/mint-partner-web-session.ts", ...liveFlag], {
    cwd: BACKEND,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      ...process.env,
      HOMIGO_STAGING: "",
      APP_ENV: "development",
      E2E_API_URL: API,
    },
  });
  const line = raw.trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop();
  if (!line) throw new Error(`mint produced no JSON: ${raw.slice(-400)}`);
  return JSON.parse(line) as Minted;
}

test.describe.configure({ mode: "default" });

test("Partner Web: one heartbeat timer after Go Online", async ({ page, context }) => {
  test.setTimeout(240_000);
  const minted = mintSession();
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 28.6139, longitude: 77.209, accuracy: 12 });

  await page.addInitScript(
    ({ minted: session }) => {
      localStorage.setItem("homigo_partner_device_id", session.deviceId);
      localStorage.setItem(
        "homigo-partner-store",
        JSON.stringify({
          state: {
            user: session.user,
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            status: "authenticated",
          },
          version: 0,
        }),
      );
    },
    { minted },
  );

  // Partner web keeps no token in storage: it restores the session from the HttpOnly refresh cookie
  // (auth-cookie-session.spec.ts). Hand the minted session over the same way a login does.
  const base = (test.info().project.use.baseURL ?? process.env.E2E_PARTNER_URL ?? "http://localhost:3002").replace(/\/$/, "");
  await context.addCookies([
    { name: "hg_rt_partner", value: minted.refreshToken, url: `${base}/api/auth`, httpOnly: true, sameSite: "Strict" },
  ]);

  const posted: number[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/api/providers/me/presence/heartbeat")) {
      posted.push(Date.now());
    }
  });
  const beats: Array<{ at: number; status: number; hasLocation: boolean; sessionId: string | null }> = [];
  page.on("request", (req) => {
    if (req.method() !== "POST" || !req.url().includes("/api/providers/me/presence/heartbeat")) return;
    const post = req.postDataJSON() as { location?: unknown; sessionId?: string } | null;
    void req.response().then((res) => {
      beats.push({
        at: Date.now(),
        status: res?.status() ?? 0,
        hasLocation: Boolean(post?.location),
        sessionId: post?.sessionId ?? null,
      });
    });
  });

  await page.goto("/availability", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /availability/i }).first()).toBeVisible({ timeout: 30_000 });

  const alreadyLive = page.getByText(/you're visible for new jobs/i);
  const goOffline = page.getByRole("button", { name: /^go offline$/i }).first();
  const goOnline = page.getByRole("button", { name: /^go online$/i }).first();
  if (await alreadyLive.isVisible().catch(() => false) || await goOffline.isVisible().catch(() => false)) {
    /* already AVAILABLE — timer should already be running */
  } else if (await goOnline.isVisible().catch(() => false)) {
    await goOnline.click({ timeout: 15_000, force: true });
    await page.waitForResponse(
      (r) => r.request().method() === "PUT" && r.url().includes("/api/providers/me/online"),
      { timeout: 30_000 },
    ).catch(() => undefined);
  }

  const t0 = Date.now();
  await expect
    .poll(() => posted.length, { timeout: 40_000 })
    .toBeGreaterThanOrEqual(1);

  const snapshots: unknown[] = [];
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(i === 0 ? 26_000 : 25_000);
    snapshots.push(await page.evaluate(() => window.__HOMIGO_PRESENCE_FORENSIC ?? null));
  }

  const ok = beats.filter((b) => b.status === 200);
  expect(
    posted.length,
    `posted=${posted.length} ok=${ok.length} forensic=${JSON.stringify(snapshots)}`,
  ).toBeGreaterThanOrEqual(3);

  const first = posted[0]!;
  const elapsedSec = Math.max(1, (posted.at(-1)! - first) / 1000);
  const rate = (posted.length - 1) / elapsedSec;
  expect(rate, `rate=${rate.toFixed(4)} n=${posted.length} elapsed=${elapsedSec.toFixed(1)}s forensic=${JSON.stringify(snapshots)}`).toBeLessThan(1 / 16);
  expect(rate).toBeGreaterThan(1 / 45);
  expect(posted.length).toBeLessThanOrEqual(7);

  const laterGaps = posted.slice(1).map((t, i) => t - posted[i]!).filter((_, i) => posted[i + 1]! - first > 4_000);
  for (const gap of laterGaps) {
    expect(gap, `gap ${gap}ms looks like a duplicate publisher`).toBeGreaterThan(16_000);
  }

  await page.goto("/work-hq", { waitUntil: "domcontentloaded" });
  const afterNav = posted.length;
  await page.waitForTimeout(26_000);
  expect(posted.length - afterNav, "route change must not start a second publisher").toBeLessThanOrEqual(2);
  expect(posted.length - afterNav).toBeGreaterThanOrEqual(1);

  const located = ok.filter((b) => b.hasLocation).length;
  if (ok.length > 0) {
    expect(located / ok.length).toBeLessThanOrEqual(0.7);
  }

  const elig = await fetch(`${API}/api/providers/me/dispatch-eligibility`, {
    headers: { Authorization: `Bearer ${minted.accessToken}` },
  });
  const eligJson = (await elig.json()) as {
    data?: { eligible?: boolean; blockedBy?: string | null };
    eligible?: boolean;
  };
  const eligible = eligJson.data?.eligible ?? eligJson.eligible;
  expect(elig.ok, JSON.stringify(eligJson)).toBeTruthy();
  expect(eligible === true || eligJson.data?.blockedBy === "STALE_LOCATION", JSON.stringify(eligJson)).toBeTruthy();

  const snap = await fetch(`${API}/api/providers/me/presence`, {
    headers: { Authorization: `Bearer ${minted.accessToken}` },
  });
  const snapJson = (await snap.json()) as { data?: { lastHeartbeatAt?: string; presenceFreshness?: string } };
  expect(snapJson.data?.presenceFreshness).toBe("FRESH");

  const axes = await fetch(`${API}/api/providers/me`, {
    headers: { Authorization: `Bearer ${minted.accessToken}` },
  });
  const meJson = (await axes.json()) as { data?: { provider?: { lifecycleState?: string } } };
  const lifecycle = meJson.data?.provider?.lifecycleState;
  if (lifecycle) expect(lifecycle).toBe("ACTIVE");

  console.log(
    JSON.stringify({
      GATE: "P0_PARTNER_WEB_TIMER",
      providerId: minted.providerId,
      t0OffsetMs: first - t0,
      postedDts: posted.map((t) => t - first),
      ok,
      located,
      rateHz: Number(rate.toFixed(4)),
      afterNavDelta: posted.length - afterNav,
      forensic: snapshots,
      eligible,
      presenceFreshness: snapJson.data?.presenceFreshness,
    }),
  );
});
