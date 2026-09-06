/**
 * Loop 3 live HTTP security regression against the running backend.
 * Does not use `bun test` (Windows Bun 1.3.14 panics on that runner).
 *
 * Usage: bun --env-file=.env run scripts/loop3-security-http.ts
 */
import "dotenv/config";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
let failed = 0;

function gate(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function req(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function tokenOf(json: unknown) {
  return String((json as { data?: { accessToken?: string } })?.data?.accessToken ?? "");
}

async function login(email: string, password: string) {
  const r = await req("POST", "/api/auth/login", { body: { email, password, setAuthCookies: false } });
  return { status: r.status, token: tokenOf(r.json) };
}

async function registerCustomer(tag: string) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const email = `l3sec.${tag}.${stamp}@homigo.test`;
  const phone = `+9198${String(stamp).slice(-8)}`;
  const password = "Homigo@E2e1";
  await new Promise((r) => setTimeout(r, 400));
  const otpSend = await req("POST", "/api/auth/send-otp", { body: { phoneNumber: phone } });
  const otp = String((otpSend.json as { data?: { devOtp?: string } })?.data?.devOtp ?? "");
  if (!otp) {
    console.error(`send-otp ${tag}`, otpSend.status, JSON.stringify(otpSend.json).slice(0, 300));
  }
  const reg = await req("POST", "/api/auth/register", {
    body: {
      email,
      phoneNumber: phone,
      firstName: "Sec",
      lastName: tag === "A" ? "Alpha" : "Bravo",
      password,
      confirmPassword: password,
      otp,
      agreeToTerms: true,
      setAuthCookies: false,
    },
  });
  let token = tokenOf(reg.json);
  if (!token) {
    const l = await login(email, password);
    token = l.token;
    if (!token) console.error(`register ${tag}`, reg.status, JSON.stringify(reg.json).slice(0, 400));
  }
  const me = await req("GET", "/api/users/me", { token });
  const id = String((me.json as { data?: { user?: { id?: string } } })?.data?.user?.id ?? "");
  return { token, id, email, password };
}

async function main() {
  const health = await req("GET", "/health");
  gate("health", health.status === 200);

  const a = await registerCustomer("A");
  const b = await registerCustomer("B");
  gate("seed.customer_a", Boolean(a.token && a.id));
  gate("seed.customer_b", Boolean(b.token && b.id));

  const partner = await login("partner@homigo.demo", "Homigo@123");
  const admin = await login("admin@homigo.demo", "Homigo@123");
  gate("seed.partner", partner.status === 200);
  gate("seed.admin", admin.status === 200);

  const unauthAdmin = await req("GET", "/api/admin/bookings?limit=1");
  gate("auth.unauthenticated_admin_denied", unauthAdmin.status === 401 || unauthAdmin.status === 403, `status=${unauthAdmin.status}`);

  const partnerAdmin = await req("GET", "/api/admin/dashboard", { token: partner.token });
  gate("rbac.partner_denied_admin_dashboard", partnerAdmin.status === 401 || partnerAdmin.status === 403, `status=${partnerAdmin.status}`);

  const customerAdmin = await req("GET", "/api/admin/dashboard", { token: a.token });
  gate("rbac.customer_denied_admin_dashboard", customerAdmin.status === 401 || customerAdmin.status === 403, `status=${customerAdmin.status}`);

  const services = await req("GET", "/api/services?limit=5");
  gate("search.public_or_ok", services.status === 200);

  const inject = await req("GET", "/api/services?q=" + encodeURIComponent("'; DROP TABLE users;--"));
  gate("search.injection_string_does_not_500", inject.status !== 500, `status=${inject.status}`);

  // Customer A booking
  const addrA = await req("POST", "/api/users/addresses", {
    token: a.token,
    body: {
      label: "Home",
      addressLine1: "Sec A",
      city: "Bengaluru",
      state: "KA",
      zipCode: "560001",
      latitude: 12.97,
      longitude: 77.59,
    },
  });
  const addressId = String(
    (addrA.json as { data?: { address?: { id?: string }; id?: string } })?.data?.address?.id ??
      (addrA.json as { data?: { id?: string } })?.data?.id ??
      "",
  );
  const svcId = await (async () => {
    const j = services.json as { data?: unknown };
    if (Array.isArray(j.data)) return String((j.data[0] as { id?: string })?.id ?? "");
    const list = (j.data as { services?: Array<{ id: string }> })?.services;
    return String(list?.[0]?.id ?? "");
  })();
  const bookA = await req("POST", "/api/bookings", {
    token: a.token,
    body: {
      serviceId: svcId,
      addressId,
      scheduledDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      description: "l3 security A",
    },
  });
  const bookingId = String(
    (bookA.json as { data?: { booking?: { id?: string } } })?.data?.booking?.id ??
      (bookA.json as { data?: { id?: string } })?.data?.id ??
      "",
  );
  gate("booking.customer_a_create", bookA.status === 201 || bookA.status === 200, `id=${bookingId.slice(0, 12)}`);

  const bReadA = await req("GET", `/api/bookings/${bookingId}`, { token: b.token });
  gate("idor.customer_b_cannot_read_booking_a", bReadA.status === 403 || bReadA.status === 404, `status=${bReadA.status}`);

  const bCancelA = await req("POST", `/api/bookings/${bookingId}/cancel`, {
    token: b.token,
    body: { reason: "steal", cancelledBy: "user" },
  });
  gate("idor.customer_b_cannot_cancel_booking_a", bCancelA.status === 403 || bCancelA.status === 404, `status=${bCancelA.status}`);

  const tamperAmount = await req("POST", "/api/payments/create-order", {
    token: a.token,
    body: { bookingId, amount: 1 },
  });
  const charged = Number(
    (tamperAmount.json as { data?: { amount?: number } })?.data?.amount ?? 0,
  );
  gate(
    "payment.client_amount_not_authoritative",
    tamperAmount.status === 200 && charged !== 1,
    `status=${tamperAmount.status} charged=${charged}`,
  );

  const bPayA = await req("POST", "/api/payments/create-order", {
    token: b.token,
    body: { bookingId },
  });
  gate("idor.customer_b_cannot_create_order_for_a", bPayA.status === 403 || bPayA.status === 404, `status=${bPayA.status}`);

  const fakeVerify = await req("POST", "/api/payments/verify", {
    token: a.token,
    body: {
      razorpayOrderId: "order_tampered",
      razorpayPaymentId: "pay_tampered",
      razorpaySignature: "deadbeef",
    },
  });
  gate(
    "payment.tampered_signature_rejected",
    fakeVerify.status === 400 || fakeVerify.status === 404,
    `status=${fakeVerify.status}`,
  );

  const partnerReadA = await req("GET", `/api/bookings/${bookingId}`, { token: partner.token });
  gate(
    "idor.unassigned_partner_cannot_read_customer_booking",
    partnerReadA.status === 403 || partnerReadA.status === 404,
    `status=${partnerReadA.status}`,
  );

  const partnerAcceptA = await req("POST", `/api/bookings/${bookingId}/accept`, {
    token: partner.token,
    body: { eta: 10 },
  });
  gate(
    "idor.unassigned_partner_cannot_accept",
    partnerAcceptA.status === 400 || partnerAcceptA.status === 403 || partnerAcceptA.status === 404,
    `status=${partnerAcceptA.status}`,
  );

  const aAdminBooking = await req("GET", `/api/admin/bookings/${bookingId}`, { token: a.token });
  gate("rbac.customer_denied_admin_booking", aAdminBooking.status === 401 || aAdminBooking.status === 403, `status=${aAdminBooking.status}`);

  const rateUnrelated = await req("POST", "/api/ratings", {
    token: a.token,
    body: { bookingId, rating: 5, reviewText: "not complete" },
  });
  gate(
    "rating.reject_incomplete_booking",
    rateUnrelated.status === 400 || rateUnrelated.status === 409,
    `status=${rateUnrelated.status}`,
  );

  const invalidRating = await req("POST", "/api/ratings", {
    token: a.token,
    body: { bookingId, rating: 99 },
  });
  gate("rating.reject_out_of_range", invalidRating.status === 400, `status=${invalidRating.status}`);

  const meA = await req("GET", "/api/users/me", { token: a.token });
  const meB = await req("GET", "/api/users/me", { token: b.token });
  const idA = String((meA.json as { data?: { user?: { id?: string } } })?.data?.user?.id ?? "");
  const idB = String((meB.json as { data?: { user?: { id?: string } } })?.data?.user?.id ?? "");
  gate("session.tokens_map_to_distinct_users", Boolean(idA && idB && idA !== idB), `a=${idA.slice(0, 8)} b=${idB.slice(0, 8)}`);

  const walletB = await req("GET", "/api/wallet/balance", { token: b.token });
  gate("wallet.customer_b_own_balance_ok", walletB.status === 200);

  const partnerWalletAsCustomer = await req("GET", "/api/providers/me/wallet", { token: a.token });
  gate(
    "rbac.customer_denied_partner_wallet",
    partnerWalletAsCustomer.status === 401 || partnerWalletAsCustomer.status === 403 || partnerWalletAsCustomer.status === 404,
    `status=${partnerWalletAsCustomer.status}`,
  );

  console.log("\n────────────────────────────────────────");
  if (failed === 0) {
    console.log("RESULT: LOOP3 SECURITY HTTP — FULL PASS");
    process.exit(0);
  }
  console.error(`RESULT: FAIL — ${failed} gate(s)`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
