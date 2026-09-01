import { test, expect } from "@playwright/test";
import {
  API,
  APPLICANT_PASSWORD,
  adminToken,
  assertNoHorizontalOverflow,
  completeOnboardingApi,
  createLeadAndInvite,
  expiredInviteJwt,
  getLead,
  partnerRegister,
  gotoRegisterReady,
  regHeaders,
  uniqueKyc,
  uniquePhone,
  clientIpHeaders,
} from "./helpers/p0-onboarding";
import { assertAxeSerious } from "./helpers/p0-a11y";

test.describe("P0 partner onboarding", () => {
  test("invalid invite shows recovery UI and still renders the form", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await gotoRegisterReady(page, "invite=not-a-valid-jwt");
    await expect(page.getByRole("heading", { name: /become a homeeigo partner/i })).toBeVisible();
    await expect(page.getByText(/invalid or expired/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /basic information/i })).toBeVisible();
    await expect(page.getByLabel("First name")).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("expired invite shows recovery UI", async ({ page, request }) => {
    const token = expiredInviteJwt();
    const api = await request.get(`${API}/api/partner/register/invite?token=${encodeURIComponent(token)}`);
    expect(api.status()).toBeGreaterThanOrEqual(400);
    await page.goto(`/register?invite=${encodeURIComponent(token)}`);
    await expect(page.getByText(/invalid or expired/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /basic information/i })).toBeVisible();
  });

  test("responsive register matrix has no overflow and a reachable CTA", async ({ page }) => {
    const viewports = [
      { width: 1920, height: 1080 },
      { width: 1440, height: 900 },
      { width: 1366, height: 768 },
      { width: 1280, height: 720 },
      { width: 1024, height: 768 },
      { width: 834, height: 1112 },
      { width: 768, height: 1024 },
      { width: 430, height: 932 },
      { width: 414, height: 896 },
      { width: 390, height: 844 },
      { width: 375, height: 812 },
      { width: 360, height: 800 },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await gotoRegisterReady(page);
      await expect(page.getByRole("heading", { name: /become a homeeigo partner/i })).toBeVisible();
      await expect(page.getByRole("button", { name: /send otp & create account/i })).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: "e2e/__artifacts__/p0-register-1280.png", fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: "e2e/__artifacts__/p0-register-375.png", fullPage: true });
  });

  test("Flow A+B: invite does not create Provider, web onboarding submits once", async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const token = await adminToken(request);
    const phone = uniquePhone();
    const name = `P0 Rahul ${phone.slice(-4)}`;
    const started = await createLeadAndInvite(request, token, {
      name,
      phone,
      skillInterest: "electrician",
      city: "Mumbai",
    });
    const afterInvite = await getLead(request, token, started.leadId);
    expect(afterInvite.providerId ?? null).toBeNull();

    await page.goto(`/register?invite=${encodeURIComponent(started.invite)}`);
    await expect(page.getByText(/personal invite/i)).toBeVisible();
    await expect(page.getByText(new RegExp(name, "i"))).toBeVisible();
    await expect(page.getByText(new RegExp(`ending in ${phone.slice(-4)}`))).toBeVisible();
    await expect(page.getByText(/electrician/i).first()).toBeVisible();
    await expect(page.getByText(/mumbai/i).first()).toBeVisible();

    await page.getByLabel("First name").fill("Rahul");
    await page.getByLabel("Last name").fill("Sharma");
    const email = `p0.${phone}@homigo.test`;
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Mobile").fill(phone);
    await page.getByLabel("Password", { exact: true }).fill(APPLICANT_PASSWORD);
    await page.getByLabel("Confirm password").fill(APPLICANT_PASSWORD);

    const step1 = page.waitForResponse(
      (r) => r.url().includes("/api/partner/register/step1") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /send otp & create account/i }).click();
    const step1Res = await step1;
    expect(step1Res.ok()).toBeTruthy();
    const step1Json = (await step1Res.json()) as { data?: { devOtp?: string } };
    const otp = step1Json.data?.devOtp;
    expect(otp).toMatch(/^\d{6}$/);

    await expect(page.getByPlaceholder("6-digit OTP")).toBeVisible();
    await page.getByPlaceholder("6-digit OTP").fill(otp!);
    await page.getByRole("button", { name: /verify & continue/i }).click();
    await expect(page.getByRole("heading", { name: /services/i })).toBeVisible({ timeout: 30_000 });

    await page.getByText("Electrician", { exact: true }).click();
    await page.locator("select").selectOption("Mumbai");
    await page.locator('input[type="number"]').fill("4");
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(page.getByRole("heading", { name: /complete your profile/i })).toBeVisible({ timeout: 30_000 });

    await page.locator('input[name="dateOfBirth"]').fill("1992-04-12");
    await page.locator('select[name="gender"]').selectOption("male");
    await page.locator('input[name="emergencyContactName"]').fill("Priya Sharma");
    await page.locator('input[name="emergencyContactPhone"]').fill("9876543210");
    await page.getByRole("button", { name: /save & continue/i }).click();
    await expect(page.getByRole("heading", { name: /service location/i })).toBeVisible({ timeout: 30_000 });

    await page.locator('input[name="city"]').fill("Mumbai");
    await page.locator('input[name="serviceRegions"]').fill("Andheri, Bandra");
    await page.getByRole("button", { name: /save & continue/i }).click();
    await expect(page.getByRole("heading", { name: /availability/i })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("checkbox", { name: "Sun" }).check();
    await page.getByRole("button", { name: /save & continue/i }).click();
    await expect(page.getByRole("heading", { name: /kyc/i })).toBeVisible({ timeout: 30_000 });
    await assertAxeSerious(page, "kyc");

    const kyc = uniqueKyc();
    await page.getByLabel("PAN").fill(kyc.panNumber);
    await page.getByLabel("Aadhaar").fill(kyc.aadharNumber);
    await page.getByLabel("Bank account number").fill(kyc.bankAccountNumber);
    await page.getByLabel("Account holder name").fill(kyc.bankAccountHolder);
    await page.getByLabel("IFSC").fill(kyc.ifscCode);
    await page.getByLabel("Bank name").fill(kyc.bankName);
    const kycRes = page.waitForResponse(
      (r) => r.url().includes("/kyc-details") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /^continue$/i }).click();
    expect((await kycRes).ok(), await (await kycRes).text()).toBeTruthy();
    await expect(page.getByRole("heading", { name: /^documents$/i })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "e2e/__artifacts__/p0-documents.png", fullPage: true });
    await assertAxeSerious(page, "documents");

    await page.getByRole("button", { name: /save & continue to assessment/i }).click();
    await expect(page.getByRole("heading", { name: /skill assessment/i })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "e2e/__artifacts__/p0-assessment.png", fullPage: true });
    await assertAxeSerious(page, "assessment");

    await expect(page.getByText(/electrician/i).first()).toBeVisible();
    await page.getByRole("button", { name: /submit answers/i }).click();
    await expect(page.getByText(/answer every question before submitting/i)).toBeVisible();

    const prompts: Array<{ needle: string; option: string }> = [
      { needle: "MCB", option: "Turn off the relevant MCB" },
      { needle: "burning smell", option: "Possible overload" },
      { needle: "extra parts", option: "Explain the need" },
      { needle: "professionalism", option: "Wearing ID" },
      { needle: "After finishing", option: "Mark complete" },
    ];
    for (const item of prompts) {
      const fieldset = page.locator("fieldset").filter({ hasText: new RegExp(item.needle, "i") });
      await fieldset.getByText(new RegExp(item.option, "i")).click();
    }
    await page.getByRole("button", { name: /submit answers|retry assessment/i }).click();
    await expect(page.getByRole("heading", { name: /assessment passed/i })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /continue to training/i }).click();
    await expect(page.getByRole("heading", { name: /partner training/i })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /continue to review/i }).click();
    await expect(page.getByRole("heading", { name: /final review/i })).toBeVisible({ timeout: 30_000 });

    const submitRes = page.waitForResponse(
      (r) => r.url().includes("/register/submit") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /submit application/i }).click();
    expect((await submitRes).ok()).toBeTruthy();
    await expect(page.getByRole("heading", { name: /application submitted/i })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "e2e/__artifacts__/p0-submitted.png", fullPage: true });
    await assertAxeSerious(page, "submit confirmation");

    const afterSubmit = await getLead(request, token, started.leadId);
    expect(afterSubmit.providerId).toBeTruthy();
  });

  test("resume after refresh keeps profile data", async ({ page, request }) => {
    const token = await adminToken(request);
    const phone = uniquePhone();
    const started = await createLeadAndInvite(request, token, { name: `Resume ${phone.slice(-4)}`, phone });
    const session = await partnerRegister(request, {
      email: `resume.${phone}@homigo.test`,
      phone,
      firstName: "Neha",
      lastName: "Patel",
      invite: started.invite,
    });
    await request.post(`${API}/api/partner/register/services`, {
      headers: regHeaders(session.registrationToken),
      data: { serviceCategories: ["cleaning"], city: "Pune", experienceYears: 2 },
    });
    await request.post(`${API}/api/partner/onboarding/profile`, {
      headers: regHeaders(session.registrationToken),
      data: {
        dateOfBirth: "1990-01-15",
        gender: "female",
        emergencyContactName: "Amit",
        emergencyContactPhone: "9123456780",
      },
    });

    const progress = await request.get(`${API}/api/partner/onboarding/progress`, {
      headers: regHeaders(session.registrationToken),
    });
    const progressJson = (await progress.json()) as { data?: { submitted?: boolean; currentStep?: string } };
    expect(progress.ok(), JSON.stringify(progressJson)).toBeTruthy();
    expect(progressJson.data?.submitted).toBeFalsy();

    await page.addInitScript(
      ({ token, invite }: { token: string; invite: string }) => {
        localStorage.setItem("homigo_partner_registration_token", token);
        sessionStorage.setItem("homigo_partner_registration_token", token);
        sessionStorage.setItem("homigo_partner_application_invite", invite);
      },
      { token: session.registrationToken, invite: started.invite },
    );

    await page.goto("/register", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".animate-pulse").first()).toBeHidden({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: /service location/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/resume|continue from/i).first()).toBeVisible();
  });

  test("API: incomplete assessment, isolation, concurrent submit, completed retry", async ({ request }) => {
    const token = await adminToken(request);

    const phoneA = uniquePhone();
    const inviteA = await createLeadAndInvite(request, token, { name: `Iso A ${phoneA.slice(-4)}`, phone: phoneA });
    const a = await partnerRegister(request, {
      email: `iso.a.${phoneA}@homigo.test`,
      phone: phoneA,
      firstName: "Applicant",
      lastName: "Alpha",
      invite: inviteA.invite,
    });
    await completeOnboardingApi(request, a.registrationToken);

    const incomplete = await request.post(`${API}/api/partner/onboarding/assessment`, {
      headers: regHeaders(a.registrationToken),
      data: { skillSlug: "electrician", answers: { e1: "a" } },
    });
    expect(incomplete.status()).toBe(400);

    const questions = await request.get(`${API}/api/partner/onboarding/assessment`, {
      headers: regHeaders(a.registrationToken),
    });
    const pack = (await questions.json()) as { data?: { questions: Array<{ correct?: string }> } };
    expect(pack.data?.questions.every((q) => !("correct" in q))).toBe(true);

    const docsA = await request.get(`${API}/api/partner/documents`, {
      headers: regHeaders(a.registrationToken),
    });
    const listA = (await docsA.json()) as { data?: { documents: Array<{ id: string; documentUrl?: string }> } };
    expect(listA.data?.documents[0]?.documentUrl).toBeUndefined();
    const docId = listA.data?.documents[0]?.id;
    expect(docId).toBeTruthy();

    const phoneB = uniquePhone();
    const inviteB = await createLeadAndInvite(request, token, { name: `Iso B ${phoneB.slice(-4)}`, phone: phoneB });
    const b = await partnerRegister(request, {
      email: `iso.b.${phoneB}@homigo.test`,
      phone: phoneB,
      firstName: "Applicant",
      lastName: "Beta",
      invite: inviteB.invite,
    });
    await request.post(`${API}/api/partner/register/services`, {
      headers: regHeaders(b.registrationToken),
      data: { serviceCategories: ["plumbing"], city: "Delhi", experienceYears: 1 },
    });

    const steal = await request.delete(`${API}/api/partner/documents/${docId}`, {
      headers: regHeaders(b.registrationToken),
    });
    expect(steal.status()).toBeGreaterThanOrEqual(400);

    const hijack = await request.post(`${API}/api/partner/register/verify-otp`, {
      data: {
        email: `iso.b.${phoneB}@homigo.test`,
        otp: "000000",
        userId: b.userId,
        inviteToken: inviteA.invite,
      },
    });
    expect(hijack.status()).toBeGreaterThanOrEqual(400);

    const first = await request.post(`${API}/api/partner/register/submit`, {
      headers: regHeaders(a.registrationToken),
    });
    const firstJson = (await first.json()) as { data?: { alreadySubmitted?: boolean; providerId?: string } };
    expect(first.ok()).toBeTruthy();

    const [r2, r3] = await Promise.all([
      request.post(`${API}/api/partner/register/submit`, { headers: regHeaders(a.registrationToken) }),
      request.post(`${API}/api/partner/register/submit`, { headers: regHeaders(a.registrationToken) }),
    ]);
    expect(r2.ok()).toBeTruthy();
    expect(r3.ok()).toBeTruthy();
    const j2 = (await r2.json()) as { data?: { alreadySubmitted?: boolean } };
    const j3 = (await r3.json()) as { data?: { alreadySubmitted?: boolean } };
    expect(j2.data?.alreadySubmitted || firstJson.data?.alreadySubmitted || j3.data?.alreadySubmitted).toBeTruthy();

    const mutate = await request.post(`${API}/api/partner/onboarding/profile`, {
      headers: regHeaders(a.registrationToken),
      data: { emergencyContactName: "Nope" },
    });
    expect(mutate.status()).toBe(409);
  });

  test("wrong-phone invite is rejected", async ({ request }) => {
    const token = await adminToken(request);
    const leadPhone = uniquePhone();
    const started = await createLeadAndInvite(request, token, { name: `Bind ${leadPhone.slice(-4)}`, phone: leadPhone });
    const otherPhone = uniquePhone();
    const ipHeaders = clientIpHeaders();
    const step1 = await request.post(`${API}/api/partner/register/step1`, {
      headers: ipHeaders,
      data: {
        email: `bind.${otherPhone}@homigo.test`,
        phoneNumber: otherPhone,
        firstName: "Wrong",
        lastName: "Phone",
        password: APPLICANT_PASSWORD,
        confirmPassword: APPLICANT_PASSWORD,
      },
    });
    const step1Json = (await step1.json()) as { data?: { userId: string; devOtp?: string }; error?: string };
    expect(step1.ok(), JSON.stringify(step1Json)).toBeTruthy();
    const otp = await request.post(`${API}/api/partner/register/verify-otp`, {
      headers: ipHeaders,
      data: {
        email: `bind.${otherPhone}@homigo.test`,
        otp: step1Json.data!.devOtp,
        userId: step1Json.data!.userId,
        inviteToken: started.invite,
      },
    });
    expect(otp.status()).toBe(400);
    const body = (await otp.json()) as { error?: string };
    expect(body.error ?? "").toMatch(/different mobile/i);
  });
});
