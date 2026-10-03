import { expect, test } from "@playwright/test";

/**
 * P1-2 — server-side authorization for every endpoint the in-app map consumes.
 *
 * The map is a pure read surface: it calls `/api/providers/me/bookings` (partner's own jobs) and
 * `/api/providers/me/route/optimize` (partner's own route). Both derive the provider from the auth
 * token via `requireProvider()` and scope their queries by that `providerId` — there is no
 * client-supplied partnerId anywhere in the contract. These tests prove that holds at runtime.
 */

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PARTNER = { email: "partner@homigo.demo", password: "Homigo@123" };

async function login(creds: { email: string; password: string }): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...creds, setAuthCookies: false }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string }; error?: string };
  expect(res.ok, json.error ?? "login failed").toBeTruthy();
  return json.data!.accessToken!;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

test.describe("P1-2 map data — authentication", () => {
  test("401: bookings list requires auth", async () => {
    const res = await fetch(`${API}/api/providers/me/bookings?status=accepted`);
    expect(res.status).toBe(401);
  });

  test("401: route optimize requires auth", async () => {
    const res = await fetch(`${API}/api/providers/me/route/optimize`);
    expect(res.status).toBe(401);
  });

  test("401: a forged bearer token is rejected on both map endpoints", async () => {
    const headers = { Authorization: "Bearer forged.token.value" };
    expect((await fetch(`${API}/api/providers/me/bookings?status=accepted`, { headers })).status).toBe(401);
    expect((await fetch(`${API}/api/providers/me/route/optimize`, { headers })).status).toBe(401);
  });
});

test.describe("P1-2 map data — cross-partner isolation (no IDOR)", () => {
  test("every returned booking belongs to the authenticated partner", async () => {
    const token = await login(PARTNER);
    const res = await fetch(`${API}/api/providers/me/bookings?status=accepted&limit=25`, { headers: authHeaders(token) });
    expect(res.ok).toBeTruthy();
    const body = (await res.json()) as {
      data?: { bookings?: Array<{ id: string; providerId?: string }> };
    };

    // Resolve who this token actually is, then assert nothing foreign leaked in.
    const meRes = await fetch(`${API}/api/providers/me`, { headers: authHeaders(token) });
    const me = (await meRes.json()) as { data?: { id?: string; provider?: { id?: string } } };
    const myProviderId = me.data?.provider?.id ?? me.data?.id;
    expect(myProviderId, "could not resolve authenticated providerId").toBeTruthy();

    for (const b of body.data?.bookings ?? []) {
      if (b.providerId) expect(b.providerId).toBe(myProviderId);
    }
  });

  test("a client-supplied providerId query param cannot widen the result set", async () => {
    const token = await login(PARTNER);

    const clean = await fetch(`${API}/api/providers/me/bookings?status=accepted&limit=25`, { headers: authHeaders(token) });
    const cleanBody = (await clean.json()) as { data?: { bookings?: Array<{ id: string }>; total?: number } };

    // Inject a foreign providerId/userId — server must ignore them entirely.
    const injected = await fetch(
      `${API}/api/providers/me/bookings?status=accepted&limit=25&providerId=cl-some-other-provider&userId=cl-someone-else`,
      { headers: authHeaders(token) },
    );
    const injectedBody = (await injected.json()) as { data?: { bookings?: Array<{ id: string }>; total?: number } };

    const cleanIds = (cleanBody.data?.bookings ?? []).map((b) => b.id).sort();
    const injectedIds = (injectedBody.data?.bookings ?? []).map((b) => b.id).sort();
    expect(injectedIds).toEqual(cleanIds);
  });

  test("route optimize ignores an injected providerId and stays scoped to the caller", async () => {
    const token = await login(PARTNER);
    const res = await fetch(`${API}/api/providers/me/route/optimize?providerId=cl-some-other-provider`, {
      headers: authHeaders(token),
    });

    // 200 (has a live location) or 409 NO_LOCATION are both legitimate; a 200 must only ever
    // contain this partner's own bookings.
    expect([200, 409]).toContain(res.status);
    const body = (await res.json()) as {
      success?: boolean;
      code?: string;
      data?: { sequence?: Array<{ bookingId: string }> };
    };

    if (res.status === 409) {
      expect(body.code).toBe("NO_LOCATION");
      return;
    }

    const mine = await fetch(`${API}/api/providers/me/bookings?limit=100`, { headers: authHeaders(token) });
    const mineBody = (await mine.json()) as { data?: { bookings?: Array<{ id: string }> } };
    const myBookingIds = new Set((mineBody.data?.bookings ?? []).map((b) => b.id));

    for (const stop of body.data?.sequence ?? []) {
      expect(myBookingIds.has(stop.bookingId), `route leaked foreign booking ${stop.bookingId}`).toBeTruthy();
    }
  });
});

test.describe("P1-2 map is read-only — no side effects", () => {
  test("the map's endpoints do not mutate booking state", async () => {
    const token = await login(PARTNER);

    const before = await fetch(`${API}/api/providers/me/bookings?limit=50`, { headers: authHeaders(token) });
    const beforeBody = (await before.json()) as {
      data?: { bookings?: Array<{ id: string; status: string }>; total?: number };
    };

    // Exercise the exact calls the map screen makes.
    await fetch(`${API}/api/providers/me/bookings?status=accepted&limit=25`, { headers: authHeaders(token) });
    await fetch(`${API}/api/providers/me/route/optimize`, { headers: authHeaders(token) });

    const after = await fetch(`${API}/api/providers/me/bookings?limit=50`, { headers: authHeaders(token) });
    const afterBody = (await after.json()) as {
      data?: { bookings?: Array<{ id: string; status: string }>; total?: number };
    };

    expect(afterBody.data?.total).toBe(beforeBody.data?.total);
    const beforeStates = (beforeBody.data?.bookings ?? []).map((b) => `${b.id}:${b.status}`).sort();
    const afterStates = (afterBody.data?.bookings ?? []).map((b) => `${b.id}:${b.status}`).sort();
    expect(afterStates).toEqual(beforeStates);
  });
});
