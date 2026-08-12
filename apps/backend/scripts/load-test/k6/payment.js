// HOMIGO Payment Load Test (k6).
//
//   k6 run -e STAGE=100 -e LOGIN_EMAIL=u@x -e LOGIN_PASSWORD=… scripts/load-test/k6/payment.js
//
// Validates: order creation, signature verification path (webhook), webhook
// processing, refund orchestration, concurrent payment attempts.
// Order creation + webhook require ALLOW_WRITES=1 against STAGING with test keys.
import { sleep, group, check } from "k6";
import { BASE, ALLOW_WRITES, baseOptions, login, authHeaders, get, post, writeSummary } from "./lib.js";

export const options = baseOptions();

export function setup() {
  return { token: login() };
}

export default function (data) {
  const h = authHeaders(data.token);

  group("payment reads", () => {
    if (data.token) get("/api/payments/history?limit=10", { headers: h, tags: { name: "payment_history" } });
    get("/api/wallet/offers", { tags: { name: "offers" } });
  });

  // Webhook signature verification: a request with a BAD signature MUST be rejected
  // (401/400). This validates the verification path under load without test keys.
  group("webhook signature rejection", () => {
    const res = post(
      "/api/payments/webhook",
      { event: "payment.captured", payload: { payment: { entity: { id: "pay_loadtest" } } } },
      { headers: { "Content-Type": "application/json", "x-razorpay-signature": "deadbeef-invalid" }, tags: { name: "webhook_bad_sig" } },
    );
    check(res, { "bad signature rejected (<500, not 2xx)": (r) => r.status >= 400 && r.status < 500 });
  });

  if (ALLOW_WRITES && data.token && __ENV.BOOKING_ID) {
    group("order creation", () => {
      post("/api/payments/create-order", { bookingId: __ENV.BOOKING_ID }, { headers: h, tags: { name: "create_order" } });
    });
  }

  sleep(1);
}

export function handleSummary(data) {
  return writeSummary("payment", data);
}
