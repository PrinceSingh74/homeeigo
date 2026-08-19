import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const SEED_ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };
export const APPLICANT_PASSWORD = "Homigo@123";

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

export function uniqueClientIp(): string {
  clientIpSeq += 1;
  return `198.51.100.${(clientIpSeq % 220) + 10}`;
}

export function uniqueKyc(holder = "Rahul Sharma") {
  kycSeq += 1;
  const n = Date.now() * 100 + kycSeq * 13 + Math.floor(Math.random() * 97);
  const d4 = String(n % 10000).padStart(4, "0");
  const aadharNumber = `${(n % 9) + 1}${String(n).slice(-11).padStart(11, "0")}`.slice(0, 12);
  const bankAccountNumber = `${((n + 3) % 8) + 2}${String(n + 91).slice(-11).padStart(11, "0")}`.slice(0, 12);
  return {
    panNumber: `AAAPA${d4}Z`,
    aadharNumber,
    bankAccountNumber,
    bankAccountHolder: holder,
    ifscCode: "HDFC0001234",
    bankName: "HDFC Bank",
  };
}

function jwtSecret(): string {
  try {
    const envPath = path.join(__dirname, "../../../apps/backend/.env");
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

async function jsonRequest<T>(
  url: string,
  init: RequestInit & { expectOk?: boolean } = {},
): Promise<{ status: number; body: T; ok: boolean; text: string }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = {} as T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    /* empty */
  }
  if (init.expectOk !== false && !res.ok) {
    throw new Error(`${init.method ?? "GET"} ${url} -> ${res.status} ${text}`);
  }
  return { status: res.status, body, ok: res.ok, text };
}

export async function adminToken(): Promise<string> {
  const { body } = await jsonRequest<{ data?: { accessToken?: string } }>(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: SEED_ADMIN.email, password: SEED_ADMIN.password, setAuthCookies: false }),
  });
  const token = body.data?.accessToken ?? "";
  if (token.length < 20) throw new Error("admin login failed");
  return token;
}

export async function createLeadAndInvite(token: string, input: { name: string; phone: string; skillInterest?: string; city?: string }) {
  const create = await jsonRequest<{ data?: { id: string; providerId?: string | null } }>(
    `${API}/api/admin/partner-acquisition/leads`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        phone: input.phone,
        source: "DIRECT",
        skillInterest: input.skillInterest ?? "electrician",
        city: input.city ?? "Mumbai",
        forceCreate: true,
      }),
    },
  );
  if (create.status !== 201) throw new Error(`create lead ${create.status} ${create.text}`);
  if (create.body.data?.providerId) throw new Error("lead create must not upsert Provider");

  const start = await jsonRequest<{
    data?: { lead: { id: string; providerId?: string | null }; applicationUrl: string; inviteExpiresInDays: number };
  }>(`${API}/api/admin/partner-acquisition/leads/${create.body.data!.id}/start-application`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const invite = new URL(start.body.data!.applicationUrl).searchParams.get("invite") ?? "";
  if (invite.length < 20) throw new Error("missing invite token");
  return { leadId: create.body.data!.id, invite, lead: start.body.data!.lead };
}

export async function getLead(token: string, leadId: string) {
  const { body } = await jsonRequest<{ data?: { providerId?: string | null; status?: string } }>(
    `${API}/api/admin/partner-acquisition/leads/${leadId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return body.data!;
}

export async function partnerRegister(input: {
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  invite?: string;
}) {
  const ip = uniqueClientIp();
  const step1 = await jsonRequest<{ data?: { userId: string; devOtp?: string } }>(`${API}/api/partner/register/step1`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({
      email: input.email,
      phoneNumber: input.phone,
      firstName: input.firstName,
      lastName: input.lastName,
      password: APPLICANT_PASSWORD,
      confirmPassword: APPLICANT_PASSWORD,
    }),
  });
  const otp = await jsonRequest<{ data?: { registrationToken: string } }>(`${API}/api/partner/register/verify-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
    body: JSON.stringify({
      email: input.email,
      otp: step1.body.data!.devOtp,
      userId: step1.body.data!.userId,
      inviteToken: input.invite,
    }),
  });
  return { userId: step1.body.data!.userId, registrationToken: otp.body.data!.registrationToken };
}

export async function completeOnboardingApi(registrationToken: string) {
  const headers = { "x-registration-token": registrationToken, "Content-Type": "application/json" };
  await jsonRequest(`${API}/api/partner/register/services`, {
    method: "POST",
    headers,
    body: JSON.stringify({ serviceCategories: ["electrician"], city: "Mumbai", experienceYears: 4 }),
  });
  await jsonRequest(`${API}/api/partner/onboarding/skills`, {
    method: "POST",
    headers,
    body: JSON.stringify({ primarySkill: "electrician", experienceYears: 4 }),
  });
  await jsonRequest(`${API}/api/partner/onboarding/profile`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      dateOfBirth: "1992-04-12",
      gender: "male",
      emergencyContactName: "Priya",
      emergencyContactPhone: "9876543210",
    }),
  });
  await jsonRequest(`${API}/api/partner/onboarding/location`, {
    method: "POST",
    headers,
    body: JSON.stringify({ city: "Mumbai", serviceRegions: ["Andheri", "Bandra"], serviceRadiusKm: 8 }),
  });
  await jsonRequest(`${API}/api/partner/onboarding/availability`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      workingHoursStart: "09:00",
      workingHoursEnd: "18:00",
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    }),
  });
}

export async function postAssessment(registrationToken: string, answers: Record<string, string>) {
  return jsonRequest(`${API}/api/partner/onboarding/assessment`, {
    method: "POST",
    headers: { "x-registration-token": registrationToken, "Content-Type": "application/json" },
    body: JSON.stringify({ skillSlug: "electrician", answers }),
    expectOk: false,
  });
}
