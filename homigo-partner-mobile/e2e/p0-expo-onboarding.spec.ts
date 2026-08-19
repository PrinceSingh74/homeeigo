import { test, expect } from "@playwright/test";
import {
  API,
  APPLICANT_PASSWORD,
  adminToken,
  completeOnboardingApi,
  createLeadAndInvite,
  expiredInviteJwt,
  getLead,
  partnerRegister,
  postAssessment,
  uniqueKyc,
  uniquePhone,
} from "./helpers/p0-api";

test.describe("P0 Expo runtime onboarding", () => {
  test("invalid invite shows recovery UI", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/register?invite=not-a-valid-jwt", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/homeeigo partner/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Invite could not be used")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/start application|continue invite|basic information/i).first()).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
    await page.screenshot({ path: "e2e/__artifacts__/p0-expo-invalid-invite.png", fullPage: true });
  });

  test("expired invite shows recovery UI", async ({ page }) => {
    await page.goto(`/register?invite=${encodeURIComponent(expiredInviteJwt())}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText(/homeeigo partner/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Invite could not be used")).toBeVisible({ timeout: 30_000 });
  });

  test("invite does not create Provider; Sunday + KYC + assessment + submit", async ({ page }) => {
    const token = await adminToken();
    const phone = uniquePhone();
    const name = `Expo ${phone.slice(-4)}`;
    const started = await createLeadAndInvite(token, {
      name,
      phone,
      skillInterest: "electrician",
      city: "Mumbai",
    });
    expect((await getLead(token, started.leadId)).providerId ?? null).toBeNull();

    await page.goto(`/register?invite=${encodeURIComponent(started.invite)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText(/homeeigo partner/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(new RegExp(name, "i"))).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(new RegExp(`ending in ${phone.slice(-4)}`))).toBeVisible();

    const continueInvite = page.getByRole("button", { name: /continue invite/i });
    if (await continueInvite.isVisible().catch(() => false)) {
      await continueInvite.click();
    }

    await page.getByLabel("First name").fill("Rahul");
    await page.getByLabel("Last name").fill("Sharma");
    await page.getByLabel("Email").fill(`expo.${phone}@homigo.test`);
    await page.getByLabel("Phone").fill(phone);
    await page.getByLabel("Password", { exact: true }).fill(APPLICANT_PASSWORD);
    await page.getByLabel("Confirm password", { exact: true }).fill(APPLICANT_PASSWORD);

    const step1 = page.waitForResponse(
      (r) => r.url().includes("/api/partner/register/step1") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /send otp/i }).click();
    const step1Res = await step1;
    expect(step1Res.ok(), await step1Res.text()).toBeTruthy();
    const otp = ((await step1Res.json()) as { data?: { devOtp?: string } }).data?.devOtp;
    expect(otp).toMatch(/^\d{6}$/);

    await page.getByLabel("OTP").fill(otp!);
    await page.getByRole("button", { name: /verify otp/i }).click();
    await expect(page.getByText(/services|skill/i).first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /save & continue/i }).first().click();
    await expect(page.getByText(/profile|date of birth|gender/i).first()).toBeVisible({ timeout: 30_000 });
    await page.getByLabel(/date of birth/i).fill("1992-04-12");
    await page.getByRole("button", { name: /^male$/i }).click();
    await page.getByLabel(/emergency contact name/i).fill("Priya");
    await page.getByLabel(/emergency contact phone/i).fill("9876543210");
    await page.getByRole("button", { name: /save & continue/i }).click();

    await expect(page.getByText(/service areas|location/i).first()).toBeVisible({ timeout: 30_000 });
    await page.getByLabel(/service areas/i).fill("Andheri, Bandra");
    await page.getByRole("button", { name: /save & continue/i }).click();

    await expect(page.getByText(/availability/i).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Sun" }).click();
    const availabilitySave = page.waitForRequest(
      (r) => r.url().includes("/onboarding/availability") && r.method() === "POST",
    );
    await page.getByRole("button", { name: /save & continue/i }).click();
    const availabilityBody = JSON.parse((await availabilitySave).postData() ?? "{}") as { workingDays?: string[] };
    expect(availabilityBody.workingDays).toContain("Sun");

    await expect(page.getByText(/kyc/i).first()).toBeVisible({ timeout: 30_000 });
    const kyc = uniqueKyc();
    await page.getByLabel("PAN").fill(kyc.panNumber);
    await page.getByLabel("Aadhaar").fill(kyc.aadharNumber);
    await page.getByLabel("Bank account number").fill(kyc.bankAccountNumber);
    await page.getByLabel("Account holder").fill(kyc.bankAccountHolder);
    await page.getByLabel("IFSC").fill(kyc.ifscCode);
    await page.getByLabel("Bank name").fill(kyc.bankName);
    await page.getByRole("button", { name: /save & continue/i }).click();

    await expect(page.getByText(/^documents$/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /camera/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /gallery/i }).first()).toBeVisible();
    await page.screenshot({ path: "e2e/__artifacts__/p0-expo-documents.png", fullPage: true });
    await page.getByRole("button", { name: /save & continue to assessment/i }).click();

    await expect(page.getByText(/assessment/i).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /submit answers/i }).click();
    await expect(page.getByText(/every question/i)).toBeVisible();

    const prompts: Array<{ needle: string; option: string }> = [
      { needle: "MCB", option: "Turn off the relevant MCB" },
      { needle: "burning smell", option: "Possible overload" },
      { needle: "extra parts", option: "Explain the need" },
      { needle: "professionalism", option: "Wearing ID" },
      { needle: "After finishing", option: "Mark complete" },
    ];
    for (const item of prompts) {
      const block = page.locator("div").filter({ hasText: new RegExp(item.needle, "i") }).first();
      await block.getByText(new RegExp(item.option, "i")).click();
    }
    await page.getByRole("button", { name: /submit answers|retry assessment/i }).click();
    await expect(page.getByText(/assessment passed/i)).toBeVisible({ timeout: 30_000 });

    const submitRes = page.waitForResponse(
      (r) => r.url().includes("/register/submit") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /submit application/i }).click();
    expect((await submitRes).ok()).toBeTruthy();
    await expect(page.getByText(/application submitted/i)).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "e2e/__artifacts__/p0-expo-submitted.png", fullPage: true });

    expect((await getLead(token, started.leadId)).providerId).toBeTruthy();
  });

  test("API isolation still holds from Expo origin", async () => {
    const token = await adminToken();
    const phone = uniquePhone();
    const invite = await createLeadAndInvite(token, { name: `ExpoIso ${phone.slice(-4)}`, phone });
    const session = await partnerRegister({
      email: `expo.iso.${phone}@homigo.test`,
      phone,
      firstName: "Expo",
      lastName: "Iso",
      invite: invite.invite,
    });
    await completeOnboardingApi(session.registrationToken);
    const incomplete = await postAssessment(session.registrationToken, { e1: "a" });
    expect(incomplete.status).toBe(400);
    expect(API).toContain("localhost:3000");
  });
});
