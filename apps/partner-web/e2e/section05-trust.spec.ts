import { expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { partnerLogin, partnerToken, recoverDevChunkAbort, test } from "./enterprise/fixtures";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ART = path.join(__dirname, "__artifacts__", "section05");
fs.mkdirSync(ART, { recursive: true });

async function authGet(pathName: string, token: string) {
  const res = await fetch(`${API}${pathName}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

test.describe("Section 05 partner trust live E2E", () => {
  test("login → compliance center → documents → SOS (real backend)", async ({ page, monitor }) => {
    await partnerLogin(page);

    const complianceWait = page.waitForResponse(
      (r) => r.url().includes("/api/providers/me/compliance") && r.ok(),
      { timeout: 45_000 },
    );
    await page.goto("/trust-compliance", { waitUntil: "domcontentloaded" });
    const complianceRes = await complianceWait;
    const compliance = (await complianceRes.json()) as {
      data?: { status?: string; explanation?: string; documents?: unknown[] };
    };
    expect(compliance.data?.status).toMatch(/VERIFIED|EXPIRING|ACTION_REQUIRED|RESTRICTED/);
    expect(JSON.stringify(compliance.data)).not.toMatch(/riskScore|GPS_SPOOF/i);
    await expect(page.getByRole("heading", { name: /compliance center/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("compliance-status")).toBeVisible();
    await page.screenshot({ path: path.join(ART, "partner-compliance-1440.png"), fullPage: true });

    await page.goto("/trust-compliance/verification", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/kyc|verification/i).first()).toBeVisible({ timeout: 20_000 });

    await page.goto("/trust-compliance/compliance", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /documents/i })).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: path.join(ART, "partner-documents-1440.png"), fullPage: true });

    const sosWait = page.waitForResponse((r) => r.url().includes("/api/providers/me/wellbeing") && r.ok(), {
      timeout: 45_000,
    });
    await page.goto("/wellbeing/sos", { waitUntil: "domcontentloaded" });
    await recoverDevChunkAbort(page);
    await sosWait;
    await expect(page.getByRole("heading", { name: /safety|sos/i })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/emergency contact/i).first()).toBeVisible();
    const arm = page.getByTestId("sos-arm");
    await expect(arm).toBeVisible();
    const box = await arm.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(750);
      await page.mouse.up();
    }
    const confirm = page.getByTestId("sos-confirm");
    if (await confirm.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const sosApi = page.waitForResponse(
        (r) => r.url().includes("/api/providers/me/safety/sos") && r.request().method() === "POST",
        { timeout: 30_000 },
      );
      await confirm.click();
      const sosRes = await sosApi;
      expect(sosRes.ok()).toBe(true);
      const payload = (await sosRes.json()) as { data?: { incidentId?: string; created?: boolean } };
      expect(payload.data?.incidentId).toBeTruthy();
    }
    await page.screenshot({ path: path.join(ART, "partner-sos-1440.png"), fullPage: true });

    const token = await partnerToken();
    const leak = await authGet("/api/providers/me/compliance", token);
    expect(JSON.stringify(leak.json)).not.toMatch(/bankAccount|panNumber|aadharNumber/i);
    monitor.assertClean();
  });
});
