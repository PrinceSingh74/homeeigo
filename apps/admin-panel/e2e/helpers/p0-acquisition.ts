import { expect, type APIRequestContext } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SEED_ADMIN = { email: "admin@homigo.demo", password: "Homigo@123" };

export function uniquePhone(): string {
  return `9${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10)}`;
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
  input: { name: string; phone: string },
) {
  const create = await request.post(`${API}/api/admin/partner-acquisition/leads`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      name: input.name,
      phone: input.phone,
      source: "DIRECT",
      skillInterest: "electrician",
      city: "Mumbai",
      forceCreate: true,
    },
  });
  const created = (await create.json()) as { data?: { id: string; providerId?: string | null } };
  expect(create.status(), JSON.stringify(created)).toBe(201);
  expect(created.data?.providerId ?? null).toBeNull();

  const start = await request.post(
    `${API}/api/admin/partner-acquisition/leads/${created.data!.id}/start-application`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const started = (await start.json()) as {
    data?: { lead: { id: string; providerId?: string | null }; applicationUrl: string };
  };
  expect(start.ok(), JSON.stringify(started)).toBeTruthy();
  expect(started.data?.lead.providerId ?? null).toBeNull();
  return { leadId: created.data!.id, lead: started.data!.lead };
}
