import { test, expect } from "@playwright/test";
import { expiredInviteJwt } from "./helpers/p0-onboarding";
import { gotoRegisterReady } from "./helpers/p0-onboarding";
import { assertAxeSerious } from "./helpers/p0-a11y";

test.describe("P0 accessibility", () => {
  test("register form is labeled, keyboard operable, and axe-clean", async ({ page }) => {
    await gotoRegisterReady(page);

    await page.getByLabel("First name").focus();
    await expect(page.getByLabel("First name")).toBeFocused();
    await page.keyboard.type("Rahul");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Last name")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByLabel("First name")).toBeFocused();
    await page.getByRole("button", { name: /send otp & create account/i }).focus();
    await expect(page.getByRole("button", { name: /send otp & create account/i })).toBeFocused();

    await assertAxeSerious(page, "register account");
  });

  test("invalid invite recovery is announced and axe-clean", async ({ page }) => {
    await gotoRegisterReady(page, "invite=not-a-valid-jwt");
    await expect(page.getByRole("alert").filter({ hasText: /invalid or expired/i })).toBeVisible();
    await assertAxeSerious(page, "invalid invite");
  });

  test("expired invite recovery works with reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const token = expiredInviteJwt();
    await gotoRegisterReady(page, `invite=${encodeURIComponent(token)}`);
    await expect(page.getByRole("alert").filter({ hasText: /invalid or expired/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /send otp & create account/i })).toBeVisible();
    await expect(page.getByLabel("First name")).toBeVisible();
    await assertAxeSerious(page, "expired invite reduced-motion");
  });

  test("keyboard can open already-started resume without a mouse", async ({ page }) => {
    await gotoRegisterReady(page);
    const summary = page.locator("summary").filter({ hasText: /already started an application/i });
    await expect(summary).toBeVisible();
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel(/email/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
