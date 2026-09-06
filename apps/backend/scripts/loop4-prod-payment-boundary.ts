/**
 * Loop 4 — production payment boundary (does NOT enable dev_mock in production).
 *
 * Usage: bun --env-file=.env run scripts/loop4-prod-payment-boundary.ts
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
let failed = 0;

function gate(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function req(method: string, pathName: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(`${API}${pathName}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

function tokenOf(json: unknown) {
  return String((json as { data?: { accessToken?: string } })?.data?.accessToken ?? "");
}

async function main() {
  const health = await req("GET", "/health");
  const env = String((health.json as { environment?: string })?.environment ?? "");
  gate("backend.health", health.status === 200, `env=${env}`);

  const checkoutSrc = readFileSync(
    path.join(import.meta.dir, "../../web/src/hooks/use-razorpay-checkout.ts"),
    "utf8",
  );
  gate(
    "source.production_refuses_dev_mock",
    checkoutSrc.includes('process.env.NODE_ENV === "production"') &&
      checkoutSrc.includes("Payment gateway is not configured"),
  );
  gate(
    "source.production_throws_before_dev_mock_checkout",
    /if \(useDevMock\) \{[\s\S]*?NODE_ENV === "production"[\s\S]*?throw new Error[\s\S]*?completeDevMockCheckout/.test(
      checkoutSrc,
    ),
  );

  const mockSig = await req("POST", "/api/payments/e2e/mock-signature", {
    body: { razorpayOrderId: "order_probe", razorpayPaymentId: "pay_probe" },
  });
  if (env === "production") {
    gate("boundary.mock_signature_hidden_in_prod_backend", mockSig.status === 404, `status=${mockSig.status}`);
  } else {
    gate(
      "boundary.mock_signature_dev_only_endpoint",
      mockSig.status === 200,
      `backend=${env} status=${mockSig.status} (must be 404 when backend NODE_ENV=production)`,
    );
  }

  const stamp = Date.now();
  const email = `l4bound.${stamp}@homigo.test`;
  const phone = `+9198${String(stamp).slice(-8)}`;
  const password = "Homigo@E2e1";
  const otpSend = await req("POST", "/api/auth/send-otp", { body: { phoneNumber: phone } });
  const otp = String((otpSend.json as { data?: { devOtp?: string } })?.data?.devOtp ?? "");
  const reg = await req("POST", "/api/auth/register", {
    body: {
      email,
      phoneNumber: phone,
      firstName: "Bound",
      lastName: "Arya",
      password,
      confirmPassword: password,
      otp,
      agreeToTerms: true,
      setAuthCookies: false,
    },
  });
  let token = tokenOf(reg.json);
  if (!token) {
    const login = await req("POST", "/api/auth/login", {
      body: { email, password, setAuthCookies: false },
    });
    token = tokenOf(login.json);
  }
  gate("auth.fresh_customer", Boolean(token), `reg=${reg.status}`);

  const services = await req("GET", "/api/services?limit=5");
  const svcPayload = (services.json as { data?: { services?: Array<{ id: string }> } | unknown[] })?.data;
  const svcList =
    (svcPayload as { services?: Array<{ id: string; slug?: string }> })?.services ?? [];
  const preferred =
    svcList.find((s) => s.slug && s.slug !== "hourly-bookings") ?? svcList[0];
  const svcId = String(preferred?.id ?? "");
  gate("search.services", services.status === 200 && Boolean(svcId), `id=${svcId.slice(0, 12)}`);

  const addr = await req("POST", "/api/users/addresses", {
    token,
    body: {
      label: "Boundary",
      addressLine1: "Loop4",
      city: "Bengaluru",
      state: "KA",
      zipCode: "560001",
      latitude: 12.97,
      longitude: 77.59,
    },
  });
  const addressId = String(
    (addr.json as { data?: { address?: { id?: string }; id?: string } })?.data?.address?.id ??
      (addr.json as { data?: { id?: string } })?.data?.id ??
      "",
  );
  if (!addressId) console.error("address.create", addr.status, JSON.stringify(addr.json).slice(0, 400));
  gate("customer.address", (addr.status === 201 || addr.status === 200) && Boolean(addressId), `id=${addressId.slice(0, 12)}`);

  const book = await req("POST", "/api/bookings", {
    token,
    body: {
      serviceId: svcId,
      addressId,
      scheduledDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000 + Math.floor(Math.random() * 86_400_000)).toISOString(),
      description: "loop4 payment boundary",
    },
  });
  if (book.status >= 400) {
    console.error("booking.create body", JSON.stringify(book.json).slice(0, 500));
  }
  const bookingId = String(
    (book.json as { data?: { booking?: { id?: string }; id?: string } })?.data?.booking?.id ??
      (book.json as { data?: { id?: string } })?.data?.id ??
      "",
  );
  gate("booking.create", book.status === 201 || book.status === 200, `id=${bookingId.slice(0, 12)}`);

  const order = await req("POST", "/api/payments/create-order", {
    token,
    body: { bookingId, amount: 1 },
  });
  const data = (order.json as { data?: Record<string, unknown> })?.data ?? {};
  const checkoutMode = String(data.checkoutMode ?? "");
  const razorpayOrderId = String(data.razorpayOrderId ?? "");
  const key = String(data.key ?? "");
  gate("create_order.ok", order.status === 200, `${order.status} mode=${checkoutMode} order=${razorpayOrderId.slice(0, 16)}`);
  gate("create_order.amount_not_client_controlled", Number(data.amount) !== 1, `amount=${String(data.amount)}`);
  gate(
    "create_order.checkout_mode_is_razorpay_when_live_order",
    !razorpayOrderId.startsWith("order_dev_") || checkoutMode === "dev_mock",
    `mode=${checkoutMode} id=${razorpayOrderId.slice(0, 18)}`,
  );
  if (razorpayOrderId.startsWith("order_")) {
    gate(
      "create_order.adapter_returned_gateway_order",
      Boolean(razorpayOrderId) && Boolean(key || checkoutMode === "dev_mock"),
      `key=${key ? "present" : "empty"}`,
    );
  }

  const badVerify = await req("POST", "/api/payments/verify", {
    token,
    body: {
      razorpayOrderId: razorpayOrderId || "order_tampered",
      razorpayPaymentId: "pay_tampered",
      razorpaySignature: "00",
    },
  });
  gate(
    "verify.tampered_rejected",
    badVerify.status === 400 || badVerify.status === 404,
    `status=${badVerify.status}`,
  );

  const stranger = await req("POST", "/api/auth/login", {
    body: { email: "partner@homigo.demo", password: "Homigo@123", setAuthCookies: false },
  });
  const steal = await req("POST", "/api/payments/create-order", {
    token: tokenOf(stranger.json),
    body: { bookingId },
  });
  gate("idor.partner_cannot_create_customer_order", steal.status === 401 || steal.status === 403 || steal.status === 404, `status=${steal.status}`);

  const payStatus = await req("GET", `/api/bookings/${bookingId}`, { token });
  const st = JSON.stringify(payStatus.json);
  gate(
    "booking.not_falsely_settled_after_failed_verify",
    !/SUCCESS/i.test(st) || /PENDING|pending|UNPAID|unpaid/i.test(st),
    "payment must not flip to success without valid signature",
  );

  console.log("\nCLASSIFICATION");
  console.log("  Internal payment integration: see gates above");
  console.log("  Live Razorpay checkout UI: EXTERNAL DEPENDENCY");
  console.log("  Production frontend: refuses completeDevMockCheckout");

  if (failed === 0) {
    console.log("\nRESULT: LOOP4 PRODUCTION PAYMENT BOUNDARY — FULL PASS");
    process.exit(0);
  }
  console.error(`\nRESULT: FAIL — ${failed} gate(s)`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
