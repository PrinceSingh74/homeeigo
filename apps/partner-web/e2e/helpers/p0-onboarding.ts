import { expect, type APIRequestContext, type Page } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Clear stale onboarding tokens and wait for register shell to leave boot loading. */
export async function gotoRegisterReady(
  page: Page,
  query = "",
  opts?: { keepSession?: boolean },
) {
  if (!opts?.keepSession) {
    await page.addInitScript(() => {
      localStorage.removeItem("homigo_partner_registration_token");
      sessionStorage.removeItem("homigo_partner_registration_token");
      sessionStorage.removeItem("homigo_partner_application_invite");
      sessionStorage.removeItem("homigo_partner_referral_code");
    });
  }
  const suffix = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  await page.goto(`/register${suffix}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /become a homeeigo partner|service location|complete your profile/i })).toBeVisible({
    timeout: 60_000,
  });
}

export const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const SEED_ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };
export const APPLICANT_PASSWORD = "Homigo@123";

/** 1×1 PNG — valid magic bytes for document upload. */
export const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const ELECTRICIAN_PASS_ANSWERS: Record<string, string> = {
  e1: "a",
  e2: "b",
  q3: "b",
  q4: "a",
  q5: "b",
};

export function uniquePhone(): string {
  return `9${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`;
}

let kycSeq = 0;
let clientIpSeq = 0;

/** TEST-NET IPs so E2E registrations do not exhaust the shared localhost rate-limit bucket. */
export function uniqueClientIp(): string {
  clientIpSeq += 1;
  return `198.51.100.${(clientIpSeq % 220) + 10}`;
}

export function clientIpHeaders(extra: Record<string, string> = {}) {
  return { "X-Forwarded-For": uniqueClientIp(), ...extra };
}

/** Format-valid unique PAN / Aadhaar / bank for KYC uniqueness constraints. */
export function uniqueKyc(holder = "Rahul Sharma") {
  kycSeq += 1;
  const n = Math.abs(Date.now() + kycSeq * 9973 + Math.floor(Math.random() * 97));
  const d4 = String(n % 10000).padStart(4, "0");
  const l1 = String.fromCharCode(65 + (kycSeq % 26));
  const l2 = String.fromCharCode(65 + ((kycSeq * 7 + (n % 26)) % 26));
  const aadharNumber = `${(n % 9) + 1}${String(n).slice(-11).padStart(11, "0")}`.slice(0, 12);
  const bankAccountNumber = `${((n + 3) % 8) + 2}${String(n + 91).slice(-11).padStart(11, "0")}`.slice(0, 12);
  return {
    panNumber: `ZZ${l1}${l2}A${d4}P`,
    aadharNumber,
    bankAccountNumber,
    bankAccountHolder: holder,
    ifscCode: "HDFC0001234",
    bankName: "HDFC Bank",
  };
}

function jwtSecret(): string {
  try {
    const envPath = path.join(__dirname, "../../../backend/.env");
    const env = fs.readFileSync(envPath, "utf8");
    const match = env.match(/^JWT_SECRET=(.+)$/m);
    if (match?.[1]) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    /* fall through */
  }
  return process.env.JWT_SECRET || "change-me-access-secret";
}

export function expiredInviteJwt(leadId = "lead_expired"): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      type: "partner_lead_invite",
      leadId,
      iat: now - 120,
      exp: now - 60,
    }),
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac("sha256", jwtSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/api/auth/login`, {
    data: { email: SEED_ADMIN.email, password: SEED_ADMIN.password, setAuthCookies: false },
  });
  expect(res.ok(), `admin login failed: ${res.status()}`).toBeTruthy();
  const json = (await res.json()) as { data?: { accessToken?: string } };
  const token = json.data?.accessToken ?? "";
  expect(token.length).toBeGreaterThan(20);
  return token;
}

export async function createLeadAndInvite(
  request: APIRequestContext,
  token: string,
  input: { name: string; phone: string; skillInterest?: string; city?: string },
) {
  const create = await request.post(`${API}/api/admin/partner-acquisition/leads`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: input.name,
      phone: input.phone,
      source: "DIRECT",
      skillInterest: input.skillInterest ?? "electrician",
      city: input.city ?? "Mumbai",
      forceCreate: true,
    },
  });
  const created = (await create.json()) as { success?: boolean; data?: { id: string; providerId?: string | null } };
  expect(create.status(), JSON.stringify(created)).toBe(201);
  expect(created.data?.providerId ?? null).toBeNull();

  const start = await request.post(
    `${API}/api/admin/partner-acquisition/leads/${created.data!.id}/start-application`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const started = (await start.json()) as {
    success?: boolean;
    data?: {
      lead: { id: string; providerId?: string | null; status?: string };
      applicationUrl: string;
      smsBody: string;
      inviteExpiresInDays: number;
    };
  };
  expect(start.ok(), JSON.stringify(started)).toBeTruthy();
  expect(started.data?.lead.providerId ?? null).toBeNull();
  expect(started.data?.inviteExpiresInDays).toBe(14);
  expect(started.data?.applicationUrl).toContain("/register?invite=");
  const invite = new URL(started.data!.applicationUrl).searchParams.get("invite") ?? "";
  expect(invite.length).toBeGreaterThan(20);
  const preview = await request.get(`${API}/api/partner/register/invite`, {
    params: { token: invite },
  });
  const previewJson = (await preview.json()) as {
    success?: boolean;
    data?: { name?: string; phoneLast4?: string; city?: string | null };
    error?: string;
  };
  expect(preview.ok(), JSON.stringify(previewJson)).toBeTruthy();
  expect(previewJson.data?.phoneLast4).toBe(input.phone.replace(/\D/g, "").slice(-4));
  return { leadId: created.data!.id, invite, applicationUrl: started.data!.applicationUrl, lead: started.data!.lead };
}

export async function getLead(request: APIRequestContext, token: string, leadId: string) {
  const res = await request.get(`${API}/api/admin/partner-acquisition/leads/${leadId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as { data?: { providerId?: string | null; status?: string } };
  expect(res.ok()).toBeTruthy();
  return json.data!;
}

export async function partnerRegister(
  request: APIRequestContext,
  input: { email: string; phone: string; firstName: string; lastName: string; invite?: string },
) {
  const ipHeaders = clientIpHeaders();
  const step1 = await request.post(`${API}/api/partner/register/step1`, {
    headers: ipHeaders,
    data: {
      email: input.email,
      phoneNumber: input.phone,
      firstName: input.firstName,
      lastName: input.lastName,
      password: APPLICANT_PASSWORD,
      confirmPassword: APPLICANT_PASSWORD,
    },
  });
  const step1Json = (await step1.json()) as {
    success?: boolean;
    data?: { userId: string; devOtp?: string; email: string };
    error?: string;
  };
  expect(step1.ok(), JSON.stringify(step1Json)).toBeTruthy();
  expect(step1Json.data?.devOtp).toBeTruthy();

  const otp = await request.post(`${API}/api/partner/register/verify-otp`, {
    headers: ipHeaders,
    data: {
      email: input.email,
      otp: step1Json.data!.devOtp,
      userId: step1Json.data!.userId,
      inviteToken: input.invite,
    },
  });
  const otpJson = (await otp.json()) as {
    data?: { registrationToken: string; userId: string };
    error?: string;
  };
  expect(otp.ok(), JSON.stringify(otpJson)).toBeTruthy();
  return {
    userId: step1Json.data!.userId,
    registrationToken: otpJson.data!.registrationToken,
  };
}

export function regHeaders(registrationToken: string) {
  return { "x-registration-token": registrationToken, "Content-Type": "application/json" };
}

export async function completeOnboardingApi(
  request: APIRequestContext,
  registrationToken: string,
  opts?: { city?: string; skipAssessment?: boolean },
) {
  const h = { headers: regHeaders(registrationToken) };
  const services = await request.post(`${API}/api/partner/register/services`, {
    ...h,
    data: { serviceCategories: ["electrician"], city: opts?.city ?? "Mumbai", experienceYears: 4 },
  });
  const servicesJson = (await services.json()) as { data?: { providerId: string } };
  expect(services.ok(), await services.text()).toBeTruthy();
  const providerId = servicesJson.data!.providerId;

  await request.post(`${API}/api/partner/onboarding/skills`, {
    ...h,
    data: { primarySkill: "electrician", experienceYears: 4 },
  });
  await request.post(`${API}/api/partner/onboarding/profile`, {
    ...h,
    data: {
      dateOfBirth: "1992-04-12",
      gender: "male",
      emergencyContactName: "Priya",
      emergencyContactPhone: "9876543210",
    },
  });
  await request.post(`${API}/api/partner/onboarding/location`, {
    ...h,
    data: { city: opts?.city ?? "Mumbai", serviceRegions: ["Andheri", "Bandra"], serviceRadiusKm: 8 },
  });
  const avail = await request.post(`${API}/api/partner/onboarding/availability`, {
    ...h,
    data: {
      workingHoursStart: "09:00",
      workingHoursEnd: "18:00",
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    },
  });
  expect(avail.ok(), await avail.text()).toBeTruthy();

  const kycPayload = uniqueKyc();
  const kyc = await request.post(`${API}/api/partner/register/kyc-details`, {
    ...h,
    data: kycPayload,
  });
  expect(kyc.ok(), await kyc.text()).toBeTruthy();

  const upload = await request.post(`${API}/api/partner/documents/upload`, {
    ...h,
    data: {
      file: `data:image/png;base64,${PNG_1X1_BASE64}`,
      documentType: "pan",
      fileName: "pan.png",
    },
  });
  const uploadJson = (await upload.json()) as { data?: { documentId?: string; documentUrl?: string } };
  expect(upload.ok(), JSON.stringify(uploadJson)).toBeTruthy();
  expect(uploadJson.data?.documentUrl).toBeUndefined();
  expect(uploadJson.data?.documentId).toBeTruthy();

  await request.post(`${API}/api/partner/onboarding/documents`, {
    ...h,
    data: { uploadedTypes: ["pan"] },
  });

  if (!opts?.skipAssessment) {
    const scored = await request.post(`${API}/api/partner/onboarding/assessment`, {
      ...h,
      data: { skillSlug: "electrician", answers: ELECTRICIAN_PASS_ANSWERS },
    });
    const scoredJson = (await scored.json()) as { data?: { passed?: boolean; score?: number } };
    expect(scored.ok(), JSON.stringify(scoredJson)).toBeTruthy();
    expect(scoredJson.data?.passed).toBe(true);
  }

  return { providerId };
}

export async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(1);
}
