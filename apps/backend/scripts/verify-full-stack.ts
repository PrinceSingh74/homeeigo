/**
 * Full-stack connectivity verification — backend + DB + all frontends.
 * Usage: bun --env-file=.env run scripts/verify-full-stack.ts
 */

const API = (process.env.API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const WEB = (process.env.WEB_URL ?? "http://localhost:3001").replace(/\/$/, "");
const PARTNER = (process.env.PARTNER_URL ?? "http://localhost:3002").replace(/\/$/, "");
const ADMIN = (process.env.ADMIN_URL ?? "http://localhost:3003").replace(/\/$/, "");

type Check = { name: string; pass: boolean; detail: string };

const checks: Check[] = [];

function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${name} — ${detail}`);
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

async function login(email: string, password: string) {
  const res = await fetchJson(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, setAuthCookies: false }),
  });
  const token = (res.body as { data?: { accessToken?: string } })?.data?.accessToken;
  return { status: res.status, token };
}

async function main() {
  console.log("\n═══ HOMIGO Full-Stack Verification ═══\n");

  // Database via backend health
  const health = await fetchJson(`${API}/health`);
  const dbOk =
    health.status === 200 &&
    (health.body as { services?: { database?: string } })?.services?.database === "ok";
  record("Backend /health", health.status === 200, `status=${health.status}`);
  record("PostgreSQL via backend", dbOk, dbOk ? "database=ok" : "database not ok");

  const ready = await fetchJson(`${API}/ready`);
  record("Backend /ready", ready.status === 200, `status=${ready.status}`);

  // Frontends reachable
  for (const [name, url] of [
    ["Customer web (3001)", WEB],
    ["Partner web (3002)", PARTNER],
    ["Admin panel (3003)", ADMIN],
  ] as const) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      record(name, res.status < 500, `status=${res.status}`);
    } catch (e) {
      record(name, false, e instanceof Error ? e.message : "unreachable");
    }
  }

  // API auth flows (what frontends use)
  const admin = await login("admin@homigo.demo", "Homigo@123");
  record("Admin API login", admin.status === 200 && !!admin.token, `status=${admin.status}`);

  const customer = await login("customer@homigo.demo", "Homigo@123");
  record("Customer API login", customer.status === 200 && !!customer.token, `status=${customer.status}`);

  const provider = await login("partner@homigo.demo", "Homigo@123");
  record("Provider API login", provider.status === 200 && !!provider.token, `status=${provider.status}`);

  if (admin.token) {
    const dash = await fetchJson(`${API}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${admin.token}` },
    });
    record("Admin dashboard API", dash.status === 200, `status=${dash.status}`);
  }

  if (provider.token) {
    const me = await fetchJson(`${API}/api/providers/me/dashboard`, {
      headers: { Authorization: `Bearer ${provider.token}` },
    });
    record("Partner dashboard API", me.status === 200, `status=${me.status}`);
  }

  if (customer.token) {
    const bookings = await fetchJson(`${API}/api/users/bookings`, {
      headers: { Authorization: `Bearer ${customer.token}` },
    });
    record("Customer bookings API", bookings.status === 200, `status=${bookings.status}`);
  }

  // Partner registration session flow (P0)
  const suffix = Date.now().toString().slice(-10);
  const regEmail = `stack.verify.${suffix}@homigo.test`;
  const regPhone = `+91${suffix}`;
  const step1 = await fetchJson(`${API}/api/partner/register/step1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: regEmail,
      phoneNumber: regPhone,
      firstName: "Stack",
      lastName: "Verify",
      password: "Homigo@12345",
      confirmPassword: "Homigo@12345",
    }),
  });
  const userId = (step1.body as { data?: { userId?: string; devOtp?: string } })?.data?.userId;
  const devOtp = (step1.body as { data?: { devOtp?: string } })?.data?.devOtp;
  record("Partner reg step1", step1.status === 201 && !!userId, `status=${step1.status}`);

  if (userId && devOtp) {
    const verify = await fetchJson(`${API}/api/partner/register/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: regEmail, otp: devOtp, userId }),
    });
    const regToken = (verify.body as { data?: { registrationToken?: string } })?.data?.registrationToken;
    record("Partner reg OTP + token", verify.status === 200 && !!regToken, `status=${verify.status}`);

    if (regToken) {
      const services = await fetchJson(`${API}/api/partner/register/services`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Registration-Token": regToken,
        },
        body: JSON.stringify({
          serviceCategories: ["cleaning"],
          city: "Mumbai",
          experienceYears: 2,
        }),
      });
      record("Partner reg services (token)", services.status === 200, `status=${services.status}`);

      const noToken = await fetchJson(`${API}/api/partner/register/kyc-details`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panNumber: "ABCDE1234F" }),
      });
      record("Partner reg IDOR blocked", noToken.status === 403, `status=${noToken.status}`);
    }
  }

  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n═══ Result: ${passed} passed, ${failed} failed ═══\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
