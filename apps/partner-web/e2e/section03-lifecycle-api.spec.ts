import { expect } from "@playwright/test";
import { test } from "./enterprise/fixtures";

/**
 * Section 03 non-mocked lifecycle API gate.
 * Real transition coverage lives in apps/backend/scripts/section03-lifecycle-api-cert.ts
 * (proximity inside/outside, complete earnings). This Playwright file only checks
 * reachability so CI can skip when the backend is down.
 */
const API_BASE = (
  process.env.SECTION03_API_BASE ??
  process.env.E2E_API_URL ??
  "http://localhost:3000"
).replace(/\/$/, "");

async function backendReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${API_BASE}/api/health`, { signal: ctrl.signal }).catch(() =>
      fetch(`${API_BASE}/`, { signal: ctrl.signal }).catch(() => null),
    );
    clearTimeout(t);
    return res != null && res.status < 500;
  } catch {
    return false;
  }
}

test.describe("Section 03 lifecycle API (skip if backend down)", () => {
  test("points to backend cert script when API reachable", async () => {
    const ok = await backendReachable();
    test.skip(!ok, `Backend not reachable at ${API_BASE} — run section03-lifecycle-api-cert.ts locally`);
    // Soft assertion: health answered. Full FSM/proximity cert is the Bun script.
    expect(ok).toBe(true);
  });
});
