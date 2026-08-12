// HOMIGO Booking Load Test (k6).
//
//   k6 run -e STAGE=100  scripts/load-test/k6/booking.js
//   k6 run -e STAGE=500  scripts/load-test/k6/booking.js
//   k6 run -e STAGE=1000 -e LOGIN_EMAIL=u@x -e LOGIN_PASSWORD=… -e ALLOW_WRITES=1 scripts/load-test/k6/booking.js
//
// Flow: search services → view provider → (authed) create → accept → complete → rate.
// Mutating steps require ALLOW_WRITES=1 and valid IDs (PROVIDER_ID, SERVICE_ID) — STAGING ONLY.
import { sleep, group } from "k6";
import { BASE, ALLOW_WRITES, baseOptions, login, authHeaders, get, post, writeSummary } from "./lib.js";

export const options = baseOptions();

export function setup() {
  return { token: login() };
}

export default function (data) {
  const token = data.token;
  const h = authHeaders(token);

  group("search services", () => {
    get("/api/services?limit=20", { tags: { name: "search_services" } });
    get("/api/services/featured", { tags: { name: "featured" } });
    get("/api/providers?limit=20", { tags: { name: "search_providers" }, headers: h });
  });

  group("view provider", () => {
    const sid = __ENV.SERVICE_ID;
    if (sid) get(`/api/services/${sid}`, { tags: { name: "service_detail" } });
  });

  if (ALLOW_WRITES && token && __ENV.PROVIDER_ID && __ENV.SERVICE_ID) {
    group("booking lifecycle", () => {
      const createRes = post(
        "/api/bookings",
        { providerId: __ENV.PROVIDER_ID, serviceId: __ENV.SERVICE_ID, scheduledAt: new Date(Date.now() + 86400000).toISOString(), address: "Load Test Addr", notes: "k6" },
        { headers: h, tags: { name: "create_booking" } },
      );
      let bookingId = null;
      try { bookingId = createRes.json("data.id"); } catch (_) { /* noop */ }
      if (bookingId) {
        post(`/api/bookings/${bookingId}/accept`, {}, { headers: h, tags: { name: "accept_booking" } });
        post(`/api/bookings/${bookingId}/complete`, {}, { headers: h, tags: { name: "complete_booking" } });
        post(`/api/ratings/${bookingId}`, { rating: 5, comment: "k6" }, { headers: h, tags: { name: "rate_booking" } });
      }
    });
  } else if (token) {
    group("read bookings", () => {
      get("/api/bookings/upcoming", { headers: h, tags: { name: "upcoming" } });
    });
  }

  sleep(1);
}

export function handleSummary(data) {
  return writeSummary("booking", data);
}
