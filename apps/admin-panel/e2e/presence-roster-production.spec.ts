/**
 * Admin HQ roster: four-axis columns + stale presence is Not eligible, not SUSPENDED.
 * Intended for production `next start` (E2E_SKIP_SERVERS=1).
 * Auth is a DB-minted admin session (RefreshTokenService), not password login.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const BACKEND = path.resolve(__dirname, "../../backend");

type Minted = {
  deviceId: string;
  accessToken: string;
  refreshToken: string;
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

function mintAdmin(): Minted {
  // Mint in the SAME database the backend under test uses: CI's own throwaway homigo_db (`.env`,
  // `--allow-live` only on a GitHub Actions runner), or locally E2E_BACKEND_ENV_FILE=.env.test. The
  // mint script refuses a non-test database otherwise (this spec once minted live admin sessions).
  const envFile = process.env.E2E_BACKEND_ENV_FILE
    ?? (process.env.GITHUB_ACTIONS === "true" ? ".env" : ".env.test");
  const liveFlag = process.env.GITHUB_ACTIONS === "true" ? ["--allow-live"] : [];
  const raw = execFileSync("bun", [`--env-file=${envFile}`, "run", "scripts/mint-admin-session.ts", ...liveFlag], {
    cwd: BACKEND,
    encoding: "utf8",
    timeout: 30_000,
    env: { ...process.env, HOMIGO_STAGING: "", APP_ENV: "development" },
  });
  const line = raw.trim().split(/\r?\n/).filter((l) => l.startsWith("{")).pop();
  if (!line) throw new Error(`mint produced no JSON: ${raw.slice(-400)}`);
  return JSON.parse(line) as Minted;
}

test("roster columns and stale presence do not contaminate lifecycle", async ({ page, context }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const minted = mintAdmin();
  expect(minted.accessToken).toBeTruthy();

  const res = await fetch(`${API}/api/admin/partner-availability?limit=50`, {
    headers: { Authorization: `Bearer ${minted.accessToken}` },
  });
  const json = (await res.json()) as {
    data?: {
      items?: Array<{
        lifecycleState?: string;
        presence?: string;
        locationFreshness?: string;
        dispatchEligible?: boolean;
        dispatchBlockedBy?: string | null;
        status?: string;
      }>;
    };
  };
  expect(res.ok, JSON.stringify(json).slice(0, 400)).toBeTruthy();
  const items = json.data?.items ?? [];
  expect(items.length).toBeGreaterThan(0);

  await context.addInitScript(
    ({ minted: session }) => {
      localStorage.setItem(
        "homigo-admin-store",
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

  const rosterRes = page.waitForResponse(
    (r) => r.url().includes("/api/admin/partner-availability") && r.ok(),
    { timeout: 45_000 },
  );
  await page.goto("/workforce");
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
  await rosterRes;
  await expect(page.getByRole("heading", { name: /live partner availability/i })).toBeVisible({ timeout: 30_000 });
  for (const header of ["Partner", "Lifecycle", "Availability", "Presence", "Location", "Dispatch", "Last seen", "Jobs"]) {
    const cell = page.getByText(new RegExp(`^${header}$`)).first();
    await cell.scrollIntoViewIfNeeded();
    await expect(cell).toBeAttached();
  }

  const stale = items.find(
    (p) =>
      p.lifecycleState === "ACTIVE" &&
      p.dispatchEligible === false &&
      (p.dispatchBlockedBy === "STALE_PRESENCE" || p.presence === "STALE" || p.presence === "EXPIRED"),
  );
  if (stale) {
    expect(stale.lifecycleState).toBe("ACTIVE");
    expect(stale.status).not.toBe("SUSPENDED");
    expect(stale.dispatchEligible).toBe(false);
  }

  const pageText = await page.locator("body").innerText();
  expect(pageText).not.toMatch(/Availability\.SUSPENDED|Job\.EARNINGS_POSTED/);
});
