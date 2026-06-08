/**
 * Quick auth smoke test — run: bun run scripts/test-auth-flow.ts
 */
const BASE = process.env.API_URL ?? "http://localhost:3000";
const SEED_EMAIL = "customer@homigo.demo";
const SEED_PASSWORD = "Homigo@123";
const email = `test_${Date.now()}@homigo.local`;
const password = "TestPass1!";
const phone = `+9199${String(Date.now()).slice(-8)}`;

type Json = Record<string, unknown>;

async function req(path: string, init?: RequestInit): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  let body: Json = {};
  try {
    body = (await res.json()) as Json;
  } catch {
    body = { error: "non-json response" };
  }
  return { status: res.status, body };
}

function ok(name: string, pass: boolean, detail?: string) {
  const icon = pass ? "✅" : "❌";
  console.log(`${icon} ${name}${detail ? ` — ${detail}` : ""}`);
  return pass;
}

async function main() {
  console.log(`\nHOMIGO Auth smoke test → ${BASE}\n`);

  const health = await req("/health");
  if (!ok("Health", health.status === 200, String(health.body.message ?? health.status))) {
    process.exit(1);
  }

  const sendOtp = await req("/api/auth/send-otp", {
    method: "POST",
    body: JSON.stringify({ phoneNumber: phone }),
  });
  ok(
    "Send OTP (signup)",
    sendOtp.status === 200 && sendOtp.body.success === true,
    sendOtp.body.error ? String(sendOtp.body.error) : "check API console for [DEV OTP]",
  );

  const reg = await req("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      phoneNumber: phone,
      firstName: "Test",
      lastName: "User",
      password,
      otp: "000000",
      setAuthCookies: false,
    }),
  });
  let accessToken: string | undefined;
  let refreshToken: string | undefined;

  if (reg.status === 200 && reg.body.success === true) {
    const regData = reg.body.data as Json;
    accessToken = regData?.accessToken as string;
    refreshToken = regData?.refreshToken as string;
    ok("Register (with OTP)", true);
  } else {
    ok(
      "Register (with OTP)",
      false,
      "Use [DEV OTP] from API logs in .env or set REGISTER_REQUIRE_OTP=false — falling back to seed user",
    );
    const seedLogin = await req("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: SEED_EMAIL,
        password: SEED_PASSWORD,
        setAuthCookies: false,
      }),
    });
    const seedData = seedLogin.body.data as Json | undefined;
    accessToken = seedData?.accessToken as string | undefined;
    refreshToken = seedData?.refreshToken as string | undefined;
    if (
      !ok(
        "Login (seed user)",
        seedLogin.status === 200 && !!accessToken,
        seedLogin.body.error ? String(seedLogin.body.error) : "run: bun run db:seed",
      )
    ) {
      process.exit(1);
    }
  }

  const me = await req("/api/user/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  ok("GET /api/user/me", me.status === 200 && me.body.success === true, String(me.body.error ?? ""));

  const refresh = await req("/api/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken, setAuthCookies: false }),
  });
  const newAccess = (refresh.body.data as Json)?.accessToken as string | undefined;
  ok(
    "Refresh token",
    refresh.status === 200 && refresh.body.success === true && !!newAccess,
    String(refresh.body.error ?? ""),
  );

  const badLogin = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "WrongPass1!" }),
  });
  ok("Login rejects bad password", badLogin.status === 401, String(badLogin.body.code ?? ""));

  const loginEmail = reg.status === 200 ? email : SEED_EMAIL;
  const loginPass = reg.status === 200 ? password : SEED_PASSWORD;
  const goodLogin = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: loginEmail, password: loginPass, setAuthCookies: false }),
  });
  ok("Login", goodLogin.status === 200 && goodLogin.body.success === true);

  const forgot = await req("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email: loginEmail }),
  });
  ok("Forgot password", forgot.status === 200 && forgot.body.success === true);

  const googleAuth = await req("/api/auth/google/authorize", {
    method: "POST",
    body: JSON.stringify({ state: "test-state-123" }),
  });
  const googleUrl = (googleAuth.body.data as Json)?.url as string | undefined;
  ok(
    "Google authorize URL",
    googleAuth.status === 200 && typeof googleUrl === "string" && googleUrl.includes("google"),
    googleUrl ? "URL returned" : String(googleAuth.body.error ?? "missing GOOGLE_CLIENT_ID?"),
  );

  const logout = await req("/api/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refreshToken, clearAuthCookies: false }),
  });
  ok("Logout", logout.status === 200 && logout.body.success === true);

  const googleCb = await req("/api/auth/google/callback", {
    method: "POST",
    body: JSON.stringify({ code: "invalid-test-code" }),
  });
  ok(
    "Google callback rejects bad code",
    googleCb.status === 401,
    String(googleCb.body.error ?? googleCb.body.code ?? ""),
  );

  console.log(`\nSeed login: ${SEED_EMAIL} / ${SEED_PASSWORD}`);
  console.log(`New user attempt: ${email} / ${password}\n`);
}

main().catch((e) => {
  console.error("❌ Fatal:", e);
  process.exit(1);
});
