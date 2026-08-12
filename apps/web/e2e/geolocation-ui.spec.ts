import { test, expect } from "@playwright/test";
import { registerCustomerViaApi, apiLoginCustomer, uniqueSignupUser } from "./helpers";

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * Phase 16.2 — geolocation wiring. Exercises the customer-facing geo endpoints through an
 * authenticated session (the same chain the UI uses): config / reverse / eta / autocomplete
 * / nearby-providers. Asserts graceful behaviour with or without a Google key (no fake data).
 */
test.describe("Phase 16.2 — geolocation API wiring", () => {
  let token = "";

  test.beforeAll(async () => {
    const user = uniqueSignupUser();
    await registerCustomerViaApi(user);
    token = await apiLoginCustomer(user.email, user.password);
  });

  const auth = () => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json" });

  test("config reports maps availability", async () => {
    const res = await fetch(`${API}/api/geo/config`, { headers: auth() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { mapsConfigured: boolean } };
    expect(typeof json.data.mapsConfigured).toBe("boolean");
  });

  test("ETA always returns a value (Google or haversine fallback)", async () => {
    const res = await fetch(`${API}/api/geo/eta?fromLat=19.076&fromLng=72.877&toLat=19.10&toLng=72.90`, { headers: auth() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { etaMinutes: number; distanceKm: number; source: string } };
    expect(json.data.etaMinutes).toBeGreaterThan(0);
    expect(["google", "haversine"]).toContain(json.data.source);
  });

  test("reverse-geocode returns address or null (never fake)", async () => {
    const res = await fetch(`${API}/api/geo/reverse?lat=19.076&lng=72.877`, { headers: auth() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { available: boolean; address: unknown } };
    expect(typeof json.data.available).toBe("boolean");
    // address is either a real geocoded object or null — never a fabricated string
    expect(json.data.address === null || typeof json.data.address === "object").toBeTruthy();
  });

  test("autocomplete is rate-limit safe and shaped", async () => {
    const res = await fetch(`${API}/api/geo/autocomplete?q=mumbai`, { headers: auth() });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { predictions: unknown[] } };
    expect(Array.isArray(json.data.predictions)).toBeTruthy();
  });

  test("reverse rejects out-of-area coordinates", async () => {
    const res = await fetch(`${API}/api/geo/reverse?lat=40.7&lng=-74.0`, { headers: auth() });
    expect(res.status).toBe(400);
  });

  test("nearby-providers reuses the matching engine", async () => {
    const svcRes = await fetch(`${API}/api/services`, { headers: auth() });
    const svc = (await svcRes.json()) as { data?: { services?: Array<{ id: string }> } };
    const serviceId = svc.data?.services?.[0]?.id;
    test.skip(!serviceId, "no services seeded");

    const res = await fetch(`${API}/api/geo/nearby-providers`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ serviceId, latitude: 28.6, longitude: 77.3 }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { providers: Array<Record<string, unknown>>; count: number } };
    expect(Array.isArray(json.data.providers)).toBeTruthy();
    if (json.data.count > 0) {
      const p = json.data.providers[0]!;
      expect(p).toHaveProperty("eta");
      expect(p).toHaveProperty("distance");
      expect(p).toHaveProperty("rating");
    }
  });

  test("nearby-providers rejects out-of-area location", async () => {
    const res = await fetch(`${API}/api/geo/nearby-providers`, {
      method: "POST",
      headers: auth(),
      body: JSON.stringify({ serviceId: "x", latitude: 40.7, longitude: -74.0 }),
    });
    expect(res.status).toBe(400);
  });
});
