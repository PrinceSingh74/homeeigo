/**
 * HOMIGO Part 3 endpoint smoke verifier.
 *
 * Usage:
 *   bun run scripts/smoke-part3.ts
 *
 * Optional env:
 *   API_URL=http://localhost:3000
 *   SMOKE_EMAIL=customer@homigo.demo
 *   SMOKE_PASSWORD=Homigo@123
 */

const BASE = process.env.API_URL ?? "http://localhost:3000";
const SMOKE_EMAIL = process.env.SMOKE_EMAIL ?? "customer@homigo.demo";
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD ?? "Homigo@123";
const WS_BASE = BASE.replace(/^http/i, "ws");

type JsonValue = Record<string, unknown>;
type Probe = {
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  auth?: "user" | "provider" | "admin";
  body?: JsonValue;
  allowed: number[];
};

const EXPECTED_REST_ENDPOINTS = 65;

const probes: Probe[] = [
  // Auth
  { name: "Auth register", method: "POST", path: "/api/auth/register", body: { email: `smoke_${Date.now()}@example.com`, phoneNumber: "+919900001111", firstName: "Smoke", lastName: "User", password: "SmokeTest1!", confirmPassword: "SmokeTest1!", agreeToTerms: true }, allowed: [200, 201, 400, 409, 429] },
  { name: "Auth verify otp", method: "POST", path: "/api/auth/verify-otp", body: { email: "missing@example.com", otp: "123456" }, allowed: [200, 400, 404, 429] },
  { name: "Auth logout", method: "POST", path: "/api/auth/logout", auth: "user", body: { allDevices: false, clearAuthCookies: false }, allowed: [200, 401] },
  { name: "Auth refresh", method: "POST", path: "/api/auth/refresh", body: { refreshToken: "invalid-token", setAuthCookies: false }, allowed: [401] },
  { name: "Auth send otp", method: "POST", path: "/api/auth/send-otp", body: { phoneNumber: "+919900001112" }, allowed: [200, 400, 429, 503] },
  { name: "Auth google callback", method: "POST", path: "/api/auth/google/callback", body: { code: "invalid", state: "invalid" }, allowed: [400, 401, 429] },
  { name: "Auth apple callback", method: "POST", path: "/api/auth/apple/callback", body: { code: "invalid", state: "invalid" }, allowed: [400, 401, 429] },
  { name: "Auth forgot password", method: "POST", path: "/api/auth/forgot-password", body: { email: SMOKE_EMAIL }, allowed: [200, 404] },

  // Users
  { name: "Users me", method: "GET", path: "/api/users/me", auth: "user", allowed: [200, 401, 404] },
  { name: "Users update me", method: "PUT", path: "/api/users/me", auth: "user", body: { firstName: "Smoke", notificationsEnabled: true }, allowed: [200, 400, 401] },
  { name: "Users addresses list", method: "GET", path: "/api/users/addresses", auth: "user", allowed: [200, 401] },
  { name: "Users add address", method: "POST", path: "/api/users/addresses", auth: "user", body: { label: "Smoke", addressLine1: "123 Smoke St", city: "Mumbai", state: "Maharashtra", zipCode: "400001", latitude: 19.076, longitude: 72.8777 }, allowed: [201, 400, 401] },
  { name: "Users update address", method: "PUT", path: "/api/users/addresses/non-existent-id", auth: "user", body: { label: "Updated" }, allowed: [200, 400, 401, 404] },
  { name: "Users delete address", method: "DELETE", path: "/api/users/addresses/non-existent-id", auth: "user", allowed: [200, 400, 401, 404] },
  { name: "Users set default address", method: "POST", path: "/api/users/addresses/non-existent-id/set-default", auth: "user", allowed: [200, 401, 404] },
  { name: "Users bookings", method: "GET", path: "/api/users/bookings?status=all&limit=5&page=1", auth: "user", allowed: [200, 401] },
  { name: "Users booking details", method: "GET", path: "/api/users/bookings/non-existent-id", auth: "user", allowed: [200, 401, 404] },
  { name: "Users ratings", method: "GET", path: "/api/users/ratings?limit=5&page=1", auth: "user", allowed: [200, 401] },
  { name: "Users preferences", method: "PUT", path: "/api/users/preferences", auth: "user", body: { darkMode: false, notificationsEnabled: true }, allowed: [200, 400, 401] },

  // Services
  { name: "Services list", method: "GET", path: "/api/services?page=1&limit=5", allowed: [200] },
  { name: "Services by id", method: "GET", path: "/api/services/non-existent-id", allowed: [200, 404] },
  { name: "Services by category", method: "GET", path: "/api/services/category/cleaning?page=1&limit=5", allowed: [200] },
  { name: "Services search", method: "POST", path: "/api/services/search", body: { q: "cleaning", city: "Mumbai" }, allowed: [200, 400, 429] },
  { name: "Services featured", method: "GET", path: "/api/services/featured", allowed: [200] },

  // Providers
  { name: "Providers search", method: "POST", path: "/api/providers/search", body: { serviceId: "non-existent-service", latitude: 19.076, longitude: 72.8777 }, allowed: [200, 400, 401, 429] },
  { name: "Provider by id", method: "GET", path: "/api/providers/non-existent-id", allowed: [200, 401, 404] },
  { name: "Provider reviews", method: "GET", path: "/api/providers/non-existent-id/reviews?limit=5&page=1", allowed: [200, 401] },
  { name: "Provider availability", method: "GET", path: "/api/providers/non-existent-id/availability?date=2026-12-01&serviceId=non-existent", allowed: [200, 401] },
  { name: "Providers nearby", method: "GET", path: "/api/providers/nearby?latitude=19.076&longitude=72.8777&radius=5&limit=5", allowed: [200, 400, 401] },
  { name: "Provider quick book", method: "POST", path: "/api/providers/non-existent-id/book", auth: "user", body: { serviceId: "non-existent", scheduledDate: new Date(Date.now() + 3600_000).toISOString(), addressId: "non-existent", description: "Smoke test" }, allowed: [201, 400, 401, 404, 409] },

  // Bookings
  { name: "Bookings create", method: "POST", path: "/api/bookings", auth: "user", body: { serviceId: "non-existent", providerId: "non-existent", scheduledDate: new Date(Date.now() + 3600_000).toISOString(), addressId: "non-existent", paymentMethod: "razorpay" }, allowed: [201, 400, 401, 404, 409] },
  { name: "Bookings get", method: "GET", path: "/api/bookings/non-existent-id", auth: "user", allowed: [200, 401, 404] },
  { name: "Bookings update", method: "PUT", path: "/api/bookings/non-existent-id", auth: "user", body: { description: "Smoke update" }, allowed: [200, 400, 401, 404] },
  { name: "Bookings accept", method: "POST", path: "/api/bookings/non-existent-id/accept", auth: "provider", body: { eta: 15 }, allowed: [200, 400, 401, 403, 404] },
  { name: "Bookings reject", method: "POST", path: "/api/bookings/non-existent-id/reject", auth: "provider", body: { reason: "Smoke reject" }, allowed: [200, 400, 401, 403, 404] },
  { name: "Bookings start", method: "POST", path: "/api/bookings/non-existent-id/start", auth: "provider", body: { latitude: 19.076, longitude: 72.8777 }, allowed: [200, 400, 401, 403, 404] },
  { name: "Bookings complete", method: "POST", path: "/api/bookings/non-existent-id/complete", auth: "provider", body: { latitude: 19.076, longitude: 72.8777, notes: "Smoke complete" }, allowed: [200, 400, 401, 403, 404] },
  { name: "Bookings cancel", method: "POST", path: "/api/bookings/non-existent-id/cancel", auth: "user", body: { reason: "Smoke cancel" }, allowed: [200, 400, 401, 404] },
  { name: "Bookings upcoming", method: "GET", path: "/api/bookings/upcoming", auth: "user", allowed: [200, 401] },

  // Payments
  { name: "Payments create order", method: "POST", path: "/api/payments/create-order", auth: "user", body: { bookingId: "non-existent", amount: 999, currency: "INR" }, allowed: [200, 400, 401, 404, 429] },
  { name: "Payments verify", method: "POST", path: "/api/payments/verify", auth: "user", body: { razorpayOrderId: "order_x", razorpayPaymentId: "pay_x", razorpaySignature: "sig_x" }, allowed: [200, 400, 401, 404] },
  { name: "Payments by id", method: "GET", path: "/api/payments/non-existent-id", auth: "user", allowed: [200, 401, 404] },
  { name: "Payments refund", method: "POST", path: "/api/payments/non-existent-id/refund", auth: "user", body: { reason: "Smoke refund", amount: 1 }, allowed: [200, 400, 401, 403, 404] },
  { name: "Payments history", method: "GET", path: "/api/payments/history?limit=5&page=1", auth: "user", allowed: [200, 401] },

  // Ratings
  { name: "Ratings create", method: "POST", path: "/api/ratings", auth: "user", body: { bookingId: "non-existent", rating: 5, reviewText: "Smoke" }, allowed: [201, 400, 401] },
  { name: "Ratings by booking", method: "GET", path: "/api/ratings/non-existent-booking", auth: "user", allowed: [200, 401, 404] },
  { name: "Ratings update", method: "PUT", path: "/api/ratings/non-existent-id", auth: "user", body: { rating: 4, reviewText: "Updated smoke" }, allowed: [200, 400, 401, 404] },
  { name: "Ratings provider respond", method: "POST", path: "/api/ratings/non-existent-id/respond", auth: "provider", body: { response: "Thanks" }, allowed: [200, 400, 401, 403, 404] },

  // Wallet
  { name: "Wallet balance", method: "GET", path: "/api/wallet/balance", auth: "user", allowed: [200, 401] },
  { name: "Wallet transactions", method: "GET", path: "/api/wallet/transactions?limit=5&page=1", auth: "user", allowed: [200, 401] },
  { name: "Wallet add money", method: "POST", path: "/api/wallet/add-money", auth: "user", body: { amount: 100, paymentMethod: "razorpay" }, allowed: [200, 400, 401] },
  { name: "Wallet withdraw", method: "POST", path: "/api/wallet/withdraw", auth: "provider", body: { amount: 100, bankAccountNumber: "1234567890", ifscCode: "SBIN0001234", accountHolder: "Smoke" }, allowed: [201, 400, 401, 403] },
  { name: "Wallet offers", method: "GET", path: "/api/wallet/offers", auth: "user", allowed: [200, 401] },

  // Tracking
  { name: "Tracking location update", method: "POST", path: "/api/tracking/location", auth: "provider", body: { bookingId: "non-existent-id", latitude: 19.076, longitude: 72.8777, accuracy: 10 }, allowed: [200, 400, 401, 403, 404] },
  { name: "Tracking by booking", method: "GET", path: "/api/tracking/non-existent-id", auth: "user", allowed: [200, 401, 404] },

  // Notifications
  { name: "Notifications list", method: "GET", path: "/api/notifications?limit=5&page=1", auth: "user", allowed: [200, 401] },
  { name: "Notification mark read", method: "PUT", path: "/api/notifications/non-existent-id/read", auth: "user", allowed: [200, 401, 404] },
  { name: "Notification delete", method: "DELETE", path: "/api/notifications/non-existent-id", auth: "user", allowed: [200, 401, 404] },

  // Admin
  { name: "Admin dashboard", method: "GET", path: "/api/admin/dashboard", auth: "admin", allowed: [200, 401, 403] },
  { name: "Admin users", method: "GET", path: "/api/admin/users?limit=5&page=1", auth: "admin", allowed: [200, 401, 403] },
  { name: "Admin providers", method: "GET", path: "/api/admin/providers?limit=5&page=1", auth: "admin", allowed: [200, 401, 403] },
  { name: "Admin bookings", method: "GET", path: "/api/admin/bookings?limit=5&page=1", auth: "admin", allowed: [200, 401, 403] },
  { name: "Admin verify provider", method: "PUT", path: "/api/admin/providers/non-existent-id/verify", auth: "admin", body: { action: "approve", notes: "Smoke" }, allowed: [200, 400, 401, 403, 404] },
  { name: "Admin ban user", method: "PUT", path: "/api/admin/users/non-existent-id/ban", auth: "admin", body: { action: "ban", reason: "Smoke" }, allowed: [200, 400, 401, 403, 404] },
  { name: "Admin analytics", method: "GET", path: "/api/admin/analytics?startDate=2026-01-01&endDate=2026-12-31", auth: "admin", allowed: [200, 401, 403] },
];

async function req(path: string, init?: RequestInit): Promise<{ status: number; body: JsonValue }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: JsonValue = {};
  try {
    body = (await res.json()) as JsonValue;
  } catch {
    body = { raw: "<non-json>" };
  }
  return { status: res.status, body };
}

function printResult(ok: boolean, label: string, info?: string) {
  console.log(`${ok ? "✅" : "❌"} ${label}${info ? ` — ${info}` : ""}`);
}

async function getSwaggerPathCount() {
  const res = await fetch(`${BASE}/swagger/json`);
  if (!res.ok) return null;
  const doc = (await res.json()) as { paths?: Record<string, unknown> };
  return Object.keys(doc.paths ?? {}).length;
}

async function loginForToken() {
  const login = await req("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email: SMOKE_EMAIL,
      password: SMOKE_PASSWORD,
      setAuthCookies: false,
    }),
  });

  if (login.status !== 200 || login.body.success !== true) return null;
  const token = ((login.body.data as JsonValue | undefined)?.accessToken as string | undefined) ?? null;
  return token;
}

async function wsConnectCheck(url: string): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, detail: "timeout" }), 5000);
    try {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        clearTimeout(timer);
        ws.close();
        resolve({ ok: true, detail: "open" });
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve({ ok: false, detail: "error" });
      };
      ws.onclose = (event) => {
        // If handshake succeeded but server closed (e.g. unauthorized), route still exists.
        if (event.code && event.code !== 1006) {
          clearTimeout(timer);
          resolve({ ok: true, detail: `closed:${event.code}` });
        }
      };
    } catch {
      clearTimeout(timer);
      resolve({ ok: false, detail: "exception" });
    }
  });
}

async function main() {
  console.log(`\nHOMIGO Part 3 smoke test -> ${BASE}\n`);

  const health = await req("/health");
  const healthOk = health.status === 200;
  printResult(healthOk, "Health check", String(health.body.message ?? health.status));
  if (!healthOk) process.exit(1);

  const swaggerCount = await getSwaggerPathCount();
  if (swaggerCount === null) {
    printResult(false, "Swagger check", "Cannot read /swagger/json");
  } else {
    printResult(swaggerCount >= EXPECTED_REST_ENDPOINTS, `Swagger path count >= ${EXPECTED_REST_ENDPOINTS}`, `found ${swaggerCount}`);
  }

  const userToken = await loginForToken();
  if (userToken) {
    printResult(true, "Seed user login", `email=${SMOKE_EMAIL}`);
  } else {
    printResult(false, "Seed user login", `failed for ${SMOKE_EMAIL} (protected probes may return 401)`);
  }

  let pass = 0;
  let fail = 0;

  for (const p of probes) {
    const headers: Record<string, string> = {};
    if (p.auth && userToken) headers.Authorization = `Bearer ${userToken}`;

    const response = await req(p.path, {
      method: p.method,
      headers,
      body: p.body ? JSON.stringify(p.body) : undefined,
    });
    const ok = p.allowed.includes(response.status);
    if (ok) pass += 1;
    else fail += 1;
    printResult(ok, `${p.method} ${p.path}`, `status=${response.status}`);
  }

  // WS endpoints: verify WebSocket handshake behavior instead of plain HTTP.
  const wsChecks = [
    `${WS_BASE}/ws/tracking/non-existent-id${userToken ? `?token=${encodeURIComponent(userToken)}` : ""}`,
    `${WS_BASE}/ws/notifications${userToken ? `?token=${encodeURIComponent(userToken)}` : ""}`,
  ];
  for (const wsUrl of wsChecks) {
    const result = await wsConnectCheck(wsUrl);
    if (result.ok) pass += 1;
    else fail += 1;
    printResult(result.ok, `WS route ${wsUrl.replace(WS_BASE, "")}`, result.detail);
  }

  console.log(`\nDone. Passed=${pass}, Failed=${fail}\n`);
  if (fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("❌ Fatal smoke failure:", error);
  process.exit(1);
});
