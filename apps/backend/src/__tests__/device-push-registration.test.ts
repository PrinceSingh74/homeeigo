/**
 * Push-token registration and delivery routing — the contract both mobile apps rely on.
 *
 *   PUT    /api/users/me/devices/push-token   (register / refresh this device's Expo token)
 *   DELETE /api/users/me/devices/:deviceId    (unlink on sign-out)
 *   pushDeliveryService.sendToUser            (who receives a push, and what a failed ticket does)
 *
 * No push ever leaves the process: `Expo.prototype.sendPushNotificationsAsync` is replaced for the
 * whole file (and the no-external-egress preload blocks the network behind it). Every fixture is
 * unique to this run and removed in afterAll.
 *
 * Five tests below were first written as `test.failing` pins of known defects (token hand-over
 * between accounts, raw FCM tokens accepted, InvalidCredentials unlinking devices, logout leaving
 * the device linked); the fixes landed on 2026-09-28 and the pins became ordinary tests. The
 * "KNOWN DEFECT" notes at those tests describe what each one guards against.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import app from "../index";
import prisma from "../lib/prisma";
import { provenanceForNewUser } from "../lib/data-provenance";
import { RefreshTokenService } from "../services/refresh-token.service";
import { JWTService } from "../services/jwt.service";
import { devicePushService } from "../services/device-push.service";
import { pushDeliveryService, pushRetryPolicy } from "../services/push-delivery.service";

const RUN = `dpr${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const sessions = new RefreshTokenService(prisma, new JWTService());
const userIds: string[] = [];

/** What the patched sender was handed, and what it answers. */
const sender = {
  sent: [] as string[],
  calls: 0,
  answer: (_to: string): ExpoPushTicket => ({ status: "ok", id: `ticket-${RUN}` }),
  throwError: null as Error | null,
  /** Throw on this many calls, then answer (a transient provider failure). */
  failNext: 0,
  /** Tickets handed out first, one per message, before `answer` (ticket-level errors). */
  nextTickets: [] as ExpoPushTicket[],
};
const realSend = Expo.prototype.sendPushNotificationsAsync;
const priorRequirePush = process.env.HOMIGO_REQUIRE_PUSH;

beforeAll(() => {
  Expo.prototype.sendPushNotificationsAsync = async function (messages: ExpoPushMessage[]) {
    sender.calls += 1;
    if (sender.throwError) throw sender.throwError;
    if (sender.failNext > 0) { sender.failNext -= 1; throw new Error("503 from provider (transient)"); }
    return messages.map((m) => {
      const to = String(m.to);
      sender.sent.push(to);
      return sender.nextTickets.shift() ?? sender.answer(to);
    });
  };
  // Let pushDeliveryService past its test-runtime gate so the ticket handling runs — against the
  // stub above, never the provider.
  process.env.HOMIGO_REQUIRE_PUSH = "1";
  // Retries back off; tests keep the delays tiny.
  pushRetryPolicy.baseDelayMs = 1;
  pushRetryPolicy.maxDelayMs = 2;
});

afterAll(async () => {
  Expo.prototype.sendPushNotificationsAsync = realSend;
  if (priorRequirePush === undefined) delete process.env.HOMIGO_REQUIRE_PUSH;
  else process.env.HOMIGO_REQUIRE_PUSH = priorRequirePush;
  await prisma.userDevice.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notificationDelivery.deleteMany({ where: { recipientId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

let seq = 0;
async function seedUser() {
  const n = ++seq;
  const email = `${RUN}-${n}@push.test`;
  const u = await prisma.user.create({
    data: {
      ...provenanceForNewUser(email),
      email,
      phoneNumber: `+9173${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      firstName: "Push",
      lastName: `Probe${n}`,
      password: "x".repeat(20),
      role: "CUSTOMER",
      isEmailVerified: true,
      pushNotifications: true,
    },
  });
  userIds.push(u.id);
  const { accessToken, refreshToken } = await sessions.createSessionTokens({ userId: u.id, email });
  return { id: u.id, accessToken, refreshToken };
}

const token = (tag: string) => `ExponentPushToken[${RUN}-${tag}]`;
const device = (tag: string) => `${RUN}-device-${tag}`;

function register(accessToken: string | null, body: Record<string, unknown>) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return app.handle(
    new Request("http://localhost/api/users/me/devices/push-token", {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

function unlink(accessToken: string, deviceId: string) {
  return app.handle(
    new Request(`http://localhost/api/users/me/devices/${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  );
}

const rowsFor = (userId: string) => prisma.userDevice.findMany({ where: { userId } });

describe("PUT /api/users/me/devices/push-token — validation and auth", () => {
  test("no access token → 401, nothing stored", async () => {
    const res = await register(null, { deviceId: device("anon"), expoPushToken: token("anon"), platform: "ANDROID" });
    expect(res.status).toBe(401);
    expect(await prisma.userDevice.count({ where: { expoPushToken: token("anon") } })).toBe(0);
  });

  test("platform is the UPPERCASE enum: 'android' is refused, 'ANDROID' is stored", async () => {
    const u = await seedUser();
    const bad = await register(u.accessToken, { deviceId: device("case"), expoPushToken: token("case"), platform: "android" });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    expect(await rowsFor(u.id)).toHaveLength(0);

    const ok = await register(u.accessToken, { deviceId: device("case"), expoPushToken: token("case"), platform: "ANDROID" });
    expect(ok.status).toBe(200);
    const rows = await rowsFor(u.id);
    expect(rows.map((r) => [r.platform, r.isActive])).toEqual([["ANDROID", true]]);
  });
});

describe("ownership — a user can only register or unlink their OWN devices", () => {
  test("a body userId is ignored: the row belongs to the caller's JWT user", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const res = await register(b.accessToken, {
      userId: a.id,
      deviceId: device("own-1"),
      expoPushToken: token("own-1"),
      platform: "IOS",
    });
    expect(res.status).toBe(200);
    expect(await rowsFor(a.id)).toHaveLength(0);
    expect((await rowsFor(b.id)).map((r) => r.expoPushToken)).toEqual([token("own-1")]);
  });

  test("reusing another user's deviceId creates the caller's own row; the other user's row is untouched", async () => {
    const a = await seedUser();
    const b = await seedUser();
    await register(a.accessToken, { deviceId: device("shared-id"), expoPushToken: token("own-a"), platform: "ANDROID" });
    const res = await register(b.accessToken, {
      deviceId: device("shared-id"),
      expoPushToken: token("own-b"),
      platform: "ANDROID",
    });
    expect(res.status).toBe(200);
    const aRows = await rowsFor(a.id);
    expect(aRows.map((r) => [r.expoPushToken, r.isActive])).toEqual([[token("own-a"), true]]);
    expect((await rowsFor(b.id)).map((r) => r.expoPushToken)).toEqual([token("own-b")]);
  });

  test("DELETE with another user's deviceId unlinks nothing of theirs", async () => {
    const a = await seedUser();
    const b = await seedUser();
    await register(a.accessToken, { deviceId: device("victim"), expoPushToken: token("victim"), platform: "ANDROID" });
    const res = await unlink(b.accessToken, device("victim"));
    expect(res.status).toBe(200);
    const aRows = await rowsFor(a.id);
    expect(aRows.map((r) => r.isActive)).toEqual([true]);
  });

  test("DELETE of the caller's own device deactivates it (the sign-out unlink)", async () => {
    const a = await seedUser();
    await register(a.accessToken, { deviceId: device("mine"), expoPushToken: token("mine"), platform: "ANDROID" });
    expect((await unlink(a.accessToken, device("mine"))).status).toBe(200);
    const rows = await rowsFor(a.id);
    expect(rows.map((r) => r.isActive)).toEqual([false]);
    expect(rows[0]!.revokedAt).not.toBeNull();
    expect(await devicePushService.getActiveTokens(a.id)).toEqual([]);
  });
});

describe("upsert semantics", () => {
  test("the same token re-registered by the same user on the same device: one row, refreshed, token time kept", async () => {
    const a = await seedUser();
    const body = { deviceId: device("idem"), expoPushToken: token("idem"), platform: "ANDROID" };
    expect((await register(a.accessToken, body)).status).toBe(200);
    const [first] = await rowsFor(a.id);
    await new Promise((r) => setTimeout(r, 15));
    expect((await register(a.accessToken, body)).status).toBe(200);
    const rows = await rowsFor(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isActive).toBe(true);
    expect(rows[0]!.tokenUpdatedAt.getTime()).toBe(first!.tokenUpdatedAt.getTime());
    expect(rows[0]!.lastSeenAt.getTime()).toBeGreaterThan(first!.lastSeenAt.getTime());
  });

  test("a rotated token on the same device updates that row in place", async () => {
    const a = await seedUser();
    await register(a.accessToken, { deviceId: device("rot"), expoPushToken: token("rot-1"), platform: "IOS" });
    const res = await register(a.accessToken, { deviceId: device("rot"), expoPushToken: token("rot-2"), platform: "IOS" });
    expect(res.status).toBe(200);
    const rows = await rowsFor(a.id);
    expect(rows.map((r) => [r.expoPushToken, r.isActive])).toEqual([[token("rot-2"), true]]);
  });

  test("re-registering after a sign-out unlink reactivates the device", async () => {
    const a = await seedUser();
    const body = { deviceId: device("back"), expoPushToken: token("back"), platform: "ANDROID" };
    await register(a.accessToken, body);
    await unlink(a.accessToken, device("back"));
    expect((await register(a.accessToken, body)).status).toBe(200);
    expect(await devicePushService.getActiveTokens(a.id)).toEqual([token("back")]);
  });

  /**
   * KNOWN DEFECT — `user_devices.expo_push_token` is UNIQUE (migration 20260530120000), but
   * `DevicePushService.upsertToken` only DEACTIVATES the previous owner's row, which still holds the
   * token, then inserts/updates the new owner's row → P2002 → 500. Account B never receives push on
   * that phone (and A's row was already deactivated outside any transaction).
   * Fix (device-push.service.ts, both branches): inside one `prisma.$transaction`, DELETE rows
   * holding this token that are not (userId, deviceId) — instead of `updateMany(isActive:false)` —
   * then upsert (userId, deviceId).
   */
  test("the same physical token moving to another account on the phone is re-assigned, never shared", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const phone = { deviceId: device("handover"), expoPushToken: token("handover"), platform: "ANDROID" };
    expect((await register(a.accessToken, phone)).status).toBe(200);

    const res = await register(b.accessToken, phone);
    expect(res.status).toBe(200);
    expect(await devicePushService.getActiveTokens(b.id)).toEqual([token("handover")]);
    expect(await devicePushService.getActiveTokens(a.id)).toEqual([]);
  });

  /** Same defect, on the flow the apps now drive: A signs out (DELETE), then B signs in. */
  test("after A's sign-out unlink, B registering the same token on that phone succeeds", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const phone = { deviceId: device("handover-2"), expoPushToken: token("handover-2"), platform: "IOS" };
    await register(a.accessToken, phone);
    await unlink(a.accessToken, device("handover-2"));

    const res = await register(b.accessToken, phone);
    expect(res.status).toBe(200);
    expect(await devicePushService.getActiveTokens(b.id)).toEqual([token("handover-2")]);
  });

  /**
   * KNOWN DEFECT — any string of 10..512 chars is stored as `expoPushToken`
   * (schemas/ai.schema.ts registerPushTokenSchema). A raw FCM/APNs token is accepted with 200 and
   * then silently skipped at send time (`Expo.isExpoPushToken` in push-delivery.service.ts), so the
   * device gets nothing and nobody is told. Fix: `.refine((t) => Expo.isExpoPushToken(t))` on
   * `expoPushToken`.
   */
  test("a raw FCM token is refused at registration (it could never be delivered)", async () => {
    const a = await seedUser();
    const res = await register(a.accessToken, {
      deviceId: device("raw"),
      expoPushToken: `dGVzdA:APA91b${RUN}RawFcmTokenNotExpo`,
      platform: "ANDROID",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe("delivery routing — pushDeliveryService.sendToUser", () => {
  test("A's push goes to A's ACTIVE devices only — never to B's, never to A's unlinked device", async () => {
    const a = await seedUser();
    const b = await seedUser();
    await register(a.accessToken, { deviceId: device("ra-1"), expoPushToken: token("ra-1"), platform: "ANDROID" });
    await register(a.accessToken, { deviceId: device("ra-2"), expoPushToken: token("ra-2"), platform: "IOS" });
    await unlink(a.accessToken, device("ra-2"));
    await register(b.accessToken, { deviceId: device("rb-1"), expoPushToken: token("rb-1"), platform: "ANDROID" });

    sender.sent = [];
    const out = await pushDeliveryService.sendToUser(a.id, { title: "t", body: "b", preferenceAlreadyApplied: true });

    expect(sender.sent).toEqual([token("ra-1")]);
    expect(out.sent).toBe(1);
  });

  test("a DeviceNotRegistered ticket deactivates exactly that token", async () => {
    const a = await seedUser();
    await register(a.accessToken, { deviceId: device("dnr-1"), expoPushToken: token("dnr-1"), platform: "ANDROID" });
    await register(a.accessToken, { deviceId: device("dnr-2"), expoPushToken: token("dnr-2"), platform: "ANDROID" });
    sender.answer = (to) =>
      to === token("dnr-1")
        ? { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }
        : { status: "ok", id: "ok" };
    try {
      const out = await pushDeliveryService.sendToUser(a.id, { title: "t", body: "b", preferenceAlreadyApplied: true });
      expect(out.invalid).toEqual([token("dnr-1")]);
    } finally {
      sender.answer = () => ({ status: "ok", id: "ok" });
    }
    expect((await devicePushService.getActiveTokens(a.id)).sort()).toEqual([token("dnr-2")]);
  });

  /** A routed push's delivery row, as the notification router writes it (QUEUED, providerRef = notification id). */
  const deliveryFor = (userId: string, notificationId: string) =>
    prisma.notificationDelivery.create({
      data: {
        notificationId: `nd-${notificationId}`, recipientType: "USER", recipientId: userId, notificationType: "SYSTEM",
        category: "TRANSACTIONAL", channel: "PUSH", status: "QUEUED", providerRef: notificationId, idempotencyKey: `idem-${notificationId}`,
      },
    });

  test("X-45: a provider that keeps failing is retried a bounded number of times, then the delivery is marked FAILED", async () => {
    const a = await seedUser();
    await register(a.accessToken, { deviceId: device("fail"), expoPushToken: token("fail"), platform: "ANDROID" });
    const n = await prisma.notification.create({ data: { userId: a.id, title: "t", message: "m", type: "SYSTEM" } });
    await deliveryFor(a.id, n.id);
    sender.throwError = new Error("503 from provider");
    sender.calls = 0;
    try {
      const out = await pushDeliveryService.sendToUser(a.id, { title: "t", body: "b", notificationId: n.id, preferenceAlreadyApplied: true });
      expect(out).toMatchObject({ sent: 0, invalid: [], exhausted: 1 });
    } finally {
      sender.throwError = null;
    }
    expect(sender.calls).toBe(pushRetryPolicy.maxAttempts); // bounded: never an endless loop
    expect((await prisma.notification.findUnique({ where: { id: n.id } }))!.isPushed).toBe(false);
    expect(await prisma.notificationDelivery.findFirst({ where: { providerRef: n.id }, select: { status: true, reasonCode: true } })).toEqual({ status: "FAILED", reasonCode: "push_retries_exhausted" });
    expect(await devicePushService.getActiveTokens(a.id)).toEqual([token("fail")]); // a provider outage never unlinks a device
  });

  test("X-45: a transient failure followed by success delivers once and marks the notification pushed", async () => {
    const a = await seedUser();
    await register(a.accessToken, { deviceId: device("flaky"), expoPushToken: token("flaky"), platform: "ANDROID" });
    const n = await prisma.notification.create({ data: { userId: a.id, title: "t", message: "m", type: "SYSTEM" } });
    await deliveryFor(a.id, n.id);
    sender.calls = 0;
    sender.failNext = 1;
    const out = await pushDeliveryService.sendToUser(a.id, { title: "t", body: "b", notificationId: n.id, preferenceAlreadyApplied: true });
    expect(out).toMatchObject({ sent: 1, exhausted: 0 });
    expect(sender.calls).toBe(2);
    expect((await prisma.notification.findUnique({ where: { id: n.id } }))!.isPushed).toBe(true);
    expect((await prisma.notificationDelivery.findFirst({ where: { providerRef: n.id } }))!.status).toBe("QUEUED"); // accepted, receipt not known
  });

  test("X-45: a rate-limited ticket is retried; a permanent ticket error is not, and fails the delivery with its reason", async () => {
    const a = await seedUser();
    await register(a.accessToken, { deviceId: device("rate"), expoPushToken: token("rate"), platform: "ANDROID" });
    const n1 = await prisma.notification.create({ data: { userId: a.id, title: "t", message: "m", type: "SYSTEM" } });
    sender.calls = 0;
    sender.nextTickets = [{ status: "error", message: "slow down", details: { error: "MessageRateExceeded" } } as ExpoPushTicket];
    const out1 = await pushDeliveryService.sendToUser(a.id, { title: "t", body: "b", notificationId: n1.id, preferenceAlreadyApplied: true });
    expect(out1).toMatchObject({ sent: 1 });
    expect(sender.calls).toBe(2);

    const b = await seedUser();
    await register(b.accessToken, { deviceId: device("big"), expoPushToken: token("big"), platform: "ANDROID" });
    const n2 = await prisma.notification.create({ data: { userId: b.id, title: "t", message: "m", type: "SYSTEM" } });
    await deliveryFor(b.id, n2.id);
    sender.calls = 0;
    sender.nextTickets = [{ status: "error", message: "too big", details: { error: "MessageTooBig" } } as ExpoPushTicket];
    const out2 = await pushDeliveryService.sendToUser(b.id, { title: "t", body: "b", notificationId: n2.id, preferenceAlreadyApplied: true });
    expect(out2).toMatchObject({ sent: 0, permanent: 1 });
    expect(sender.calls).toBe(1);
    expect(await prisma.notificationDelivery.findFirst({ where: { providerRef: n2.id }, select: { status: true, reasonCode: true } })).toEqual({ status: "FAILED", reasonCode: "push_MessageTooBig" });
  });

  test("X-45: a duplicate event for an already-pushed notification never reaches the provider again", async () => {
    const a = await seedUser();
    await register(a.accessToken, { deviceId: device("dup"), expoPushToken: token("dup"), platform: "ANDROID" });
    const n = await prisma.notification.create({ data: { userId: a.id, title: "t", message: "m", type: "SYSTEM" } });
    sender.calls = 0;
    expect(await pushDeliveryService.sendToUser(a.id, { title: "t", body: "b", notificationId: n.id, preferenceAlreadyApplied: true })).toMatchObject({ sent: 1 });
    expect(await pushDeliveryService.sendToUser(a.id, { title: "t", body: "b", notificationId: n.id, preferenceAlreadyApplied: true })).toMatchObject({ sent: 0, duplicate: true });
    expect(sender.calls).toBe(1);
  });

  /**
   * KNOWN DEFECT — push-delivery.service.ts treats `InvalidCredentials` like `DeviceNotRegistered`
   * and deactivates the token. InvalidCredentials means the Expo project's FCM/APNs credentials are
   * missing or wrong — a server-side configuration fault, true for EVERY device at once. Today that
   * silently unlinks every recipient's devices. Fix: only `DeviceNotRegistered` invalidates a token;
   * log/alert InvalidCredentials without touching user_devices.
   */
  test("an InvalidCredentials ticket (project credentials fault) leaves the device linked", async () => {
    const a = await seedUser();
    await register(a.accessToken, { deviceId: device("cred"), expoPushToken: token("cred"), platform: "ANDROID" });
    sender.answer = () => ({ status: "error", message: "no FCM key", details: { error: "InvalidCredentials" } });
    try {
      await pushDeliveryService.sendToUser(a.id, { title: "t", body: "b", preferenceAlreadyApplied: true });
    } finally {
      sender.answer = () => ({ status: "ok", id: "ok" });
    }
    expect(await devicePushService.getActiveTokens(a.id)).toEqual([token("cred")]);
  });
});

describe("POST /api/auth/logout and the device", () => {
  /**
   * KNOWN GAP — both apps send `refreshToken` in the logout body; routes/auth.ts then takes the
   * refresh-token branch, which does not touch user_devices (only `allDevices`, or a body `deviceId`
   * sent WITHOUT a refresh token, unlinks). The apps therefore DELETE the device explicitly before
   * logout. Fix: in the refresh-token branch also `devicePushService.revokeDevice(userId, deviceId)`
   * for the deviceId bound to that refresh token (or the body deviceId).
   */
  test("server logout with the app's body (refreshToken + deviceId) unlinks that device", async () => {
    const a = await seedUser();
    await register(a.accessToken, { deviceId: device("lo"), expoPushToken: token("lo"), platform: "ANDROID" });
    const res = await app.handle(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.accessToken}` },
        body: JSON.stringify({ refreshToken: a.refreshToken, deviceId: device("lo"), clearAuthCookies: false }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await devicePushService.getActiveTokens(a.id)).toEqual([]);
  });
});
