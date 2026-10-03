import { expect, test } from "@playwright/test";
import { resolveNotificationHref } from "../src/lib/notification-routing";

/**
 * P1-1 — partner push notifications.
 *
 * Discovery finding this suite encodes: the SERVER-side push path was already complete
 * (assignment-engine → notificationService.sendNotification → pushDeliveryService → Expo,
 * with `PUT /api/users/me/devices/push-token` for registration). The only real gap was the
 * partner mobile app never registering a token. These tests prove the server contract the new
 * mobile code depends on — especially that a device can only ever be bound to the caller's OWN
 * account (userId is derived from the auth token, never from the request body).
 */

const API = (process.env.E2E_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PARTNER_A = { email: "partner@homigo.demo", password: "Homigo@123" };

async function login(creds: { email: string; password: string }): Promise<string> {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...creds, setAuthCookies: false }),
  });
  const json = (await res.json()) as { data?: { accessToken?: string }; error?: string };
  expect(res.ok, json.error ?? "login failed").toBeTruthy();
  const token = json.data?.accessToken;
  expect(token, "no access token returned").toBeTruthy();
  return token!;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/** Expo-format token so `Expo.isExpoPushToken()` accepts it downstream. */
function fakeExpoToken(suffix: string): string {
  return `ExponentPushToken[p11test-${suffix}]`;
}

test.describe("P1-1 push token registration — auth + security", () => {
  test("401: registering a push token without auth is rejected", async () => {
    const res = await fetch(`${API}/api/users/me/devices/push-token`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "p11-noauth",
        expoPushToken: fakeExpoToken("noauth"),
        platform: "ANDROID",
      }),
    });
    expect(res.status).toBe(401);
  });

  test("401: a malformed/forged bearer token is rejected", async () => {
    const res = await fetch(`${API}/api/users/me/devices/push-token`, {
      method: "PUT",
      headers: { Authorization: "Bearer not-a-real-token", "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: "p11-forged",
        expoPushToken: fakeExpoToken("forged"),
        platform: "ANDROID",
      }),
    });
    expect(res.status).toBe(401);
  });

  test("no IDOR: a client-supplied userId in the body cannot bind a device to another account", async () => {
    const token = await login(PARTNER_A);
    const deviceId = `p11-idor-${Date.now()}`;

    // Deliberately inject a foreign userId — the server must ignore it entirely and use the
    // userId derived from the auth token.
    const res = await fetch(`${API}/api/users/me/devices/push-token`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({
        deviceId,
        expoPushToken: fakeExpoToken(`idor-${Date.now()}`),
        platform: "ANDROID",
        userId: "cl-some-other-partner-id",
        ownerId: "cl-some-other-partner-id",
      }),
    });
    const body = (await res.json()) as { success?: boolean; data?: { device?: { deviceId?: string } } };
    expect(res.ok, "registration should succeed for the authenticated caller").toBeTruthy();
    expect(body.data?.device?.deviceId).toBe(deviceId);

    // The device must now be listed under the AUTHENTICATED account — proving ownership came
    // from the token, not the injected body field.
    const list = await fetch(`${API}/api/users/me/devices`, { headers: authHeaders(token) });
    const listBody = (await list.json()) as { data?: { devices?: Array<{ deviceId: string }> } };
    expect(list.ok).toBeTruthy();
    expect(listBody.data?.devices?.some((d) => d.deviceId === deviceId)).toBeTruthy();

    // Cleanup.
    await fetch(`${API}/api/users/me/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
  });

  test("token rotation: re-registering the same deviceId with a new token replaces it, no duplicate device", async () => {
    const token = await login(PARTNER_A);
    const deviceId = `p11-rotate-${Date.now()}`;
    const first = fakeExpoToken(`rot1-${Date.now()}`);
    const second = fakeExpoToken(`rot2-${Date.now()}`);

    for (const expoPushToken of [first, second]) {
      const res = await fetch(`${API}/api/users/me/devices/push-token`, {
        method: "PUT",
        headers: authHeaders(token),
        body: JSON.stringify({ deviceId, expoPushToken, platform: "ANDROID" }),
      });
      expect(res.ok).toBeTruthy();
    }

    const list = await fetch(`${API}/api/users/me/devices`, { headers: authHeaders(token) });
    const listBody = (await list.json()) as { data?: { devices?: Array<{ deviceId: string }> } };
    const matching = (listBody.data?.devices ?? []).filter((d) => d.deviceId === deviceId);
    expect(matching, "rotation must update in place, not create a second device row").toHaveLength(1);

    await fetch(`${API}/api/users/me/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
  });

  test("idempotency: registering the SAME deviceId+token repeatedly stays a single device", async () => {
    const token = await login(PARTNER_A);
    const deviceId = `p11-idem-${Date.now()}`;
    const expoPushToken = fakeExpoToken(`idem-${Date.now()}`);

    await Promise.all(
      Array.from({ length: 4 }, () =>
        fetch(`${API}/api/users/me/devices/push-token`, {
          method: "PUT",
          headers: authHeaders(token),
          body: JSON.stringify({ deviceId, expoPushToken, platform: "ANDROID" }),
        }),
      ),
    );

    const list = await fetch(`${API}/api/users/me/devices`, { headers: authHeaders(token) });
    const listBody = (await list.json()) as { data?: { devices?: Array<{ deviceId: string }> } };
    expect((listBody.data?.devices ?? []).filter((d) => d.deviceId === deviceId)).toHaveLength(1);

    await fetch(`${API}/api/users/me/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
  });

  test("revocation: a revoked device disappears from the active device list", async () => {
    const token = await login(PARTNER_A);
    const deviceId = `p11-revoke-${Date.now()}`;

    await fetch(`${API}/api/users/me/devices/push-token`, {
      method: "PUT",
      headers: authHeaders(token),
      body: JSON.stringify({ deviceId, expoPushToken: fakeExpoToken(`rev-${Date.now()}`), platform: "ANDROID" }),
    });

    const before = await fetch(`${API}/api/users/me/devices`, { headers: authHeaders(token) });
    const beforeBody = (await before.json()) as { data?: { devices?: Array<{ deviceId: string }> } };
    expect(beforeBody.data?.devices?.some((d) => d.deviceId === deviceId)).toBeTruthy();

    const del = await fetch(`${API}/api/users/me/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    expect(del.ok).toBeTruthy();

    const after = await fetch(`${API}/api/users/me/devices`, { headers: authHeaders(token) });
    const afterBody = (await after.json()) as { data?: { devices?: Array<{ deviceId: string }> } };
    expect(afterBody.data?.devices?.some((d) => d.deviceId === deviceId)).toBeFalsy();
  });

  test("401: revoking a device without auth is rejected", async () => {
    const res = await fetch(`${API}/api/users/me/devices/p11-anything`, { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});

test.describe("P1-1 notification tap routing (pure logic)", () => {
  test("a new job request routes to the requests tab", () => {
    expect(resolveNotificationHref({ type: "BOOKING_REQUEST", bookingId: "bk_1" })).toBe("/(tabs)/requests");
  });

  test("payment and rating alerts route to their own HQ screens", () => {
    expect(resolveNotificationHref({ type: "PAYMENT_RECEIVED", bookingId: "bk_1" })).toBe("/hq/earnings-hq");
    expect(resolveNotificationHref({ type: "RATING_RECEIVED", bookingId: "bk_1" })).toBe("/hq/performance-reviews");
  });

  test("an unknown or empty payload falls back to the requests tab instead of guessing a job id", () => {
    expect(resolveNotificationHref(undefined)).toBe("/(tabs)/requests");
    expect(resolveNotificationHref({})).toBe("/(tabs)/requests");
    expect(resolveNotificationHref({ type: "SOMETHING_NEW" })).toBe("/(tabs)/requests");
  });

  test("non-string payload fields are ignored rather than coerced into a route", () => {
    expect(resolveNotificationHref({ type: 42, bookingId: { evil: true } } as never)).toBe("/(tabs)/requests");
  });
});
