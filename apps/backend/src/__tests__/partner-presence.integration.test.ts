/**
 * Phase 1 Partner Presence — integration tests (isolated homigo_test DB).
 *   NODE_ENV=test bun test src/__tests__/partner-presence.integration.test.ts
 */
import "../load-env";
import { provenanceForNewUser } from "../lib/data-provenance";
import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { UserRole } from "@prisma/client";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { partnerPresenceService } from "../services/partner-presence.service";
import { RefreshTokenService } from "../services/refresh-token.service";
import { JWTService } from "../services/jwt.service";
import { partnerOperationsService } from "../services/partner-operations.service";
import {
  PRESENCE_FRESH_SEC,
  PRESENCE_STALE_SEC,
  PRESENCE_REDIS_TTL_SEC,
} from "../lib/partner-presence.config";
import { derivePresenceFreshness } from "../lib/partner-presence-freshness";
import { ForbiddenError, RateLimitError, UnauthorizedError, BadRequestError } from "../lib/app-error";
import { resetRateLimitSmart } from "../middleware/rate-limit.middleware";

const RUN_ID = `presence-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let sessionIdA: string;
let sessionIdB: string;
const deviceA = `device-a-${RUN_ID}`;
const deviceB = `device-b-${RUN_ID}`;
const jwt = new JWTService();
const refreshTokenService = new RefreshTokenService(prisma, jwt);

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN_ID);

  const tokensA = await refreshTokenService.createSessionTokens({
    userId: ctx.vendorUserId,
    email: `${RUN_ID}@adv.test`,
    deviceId: deviceA,
  });
  sessionIdA = tokensA.sessionId;

  const tokensB = await refreshTokenService.createSessionTokens({
    userId: ctx.vendorUserId,
    email: `${RUN_ID}@adv.test`,
    deviceId: deviceB,
  });
  sessionIdB = tokensB.sessionId;
}, 60_000);

afterAll(async () => {
  if (dbOk) {
    await prisma.partnerPresence.deleteMany({ where: { providerId: ctx.providerId } }).catch(() => {});
    await cleanupAdversarialFixtures(RUN_ID);
  }
}, 60_000);

beforeEach(async () => {
  if (dbOk && ctx?.providerId) {
    await resetRateLimitSmart(`presence:hb:${ctx.providerId}`);
  }
});

/**
 * Location sequence must strictly increase per provider — an anti-replay invariant, not test
 * bookkeeping. Hardcoding a sequence assumes this file sends the partner's first heartbeat, which
 * stopped being true once `seedAdversarialFixtures` began seeding presence: the fixture consumes
 * sequence 1, and a test that then sends 1 is rejected with SEQUENCE_REGRESSION. Read the row
 * instead, exactly as `heartbeatFresh` does.
 */
async function resetPresence(): Promise<void> {
  /**
   * Start from no presence at all, explicitly.
   *
   * `seedAdversarialFixtures` seeds a real heartbeat at (28.62, 77.37) so the booking suites race on
   * capacity rather than staleness. A test that then pings a different city is not testing what it
   * says it is: it trips SEQUENCE_REGRESSION, and once the sequence is derived, IMPOSSIBLE_JUMP —
   * the anti-spoofing gate correctly refusing a 16 km hop in one second. Neither is the subject here,
   * so the starting state is stated rather than inherited.
   */
  await prisma.partnerPresence.deleteMany({ where: { providerId: ctx.providerId } });
}

async function nextSequence(step = 1): Promise<number> {
  const current = await prisma.partnerPresence.findUnique({
    where: { providerId: ctx.providerId },
    select: { lastLocationSeq: true },
  });
  return (current?.lastLocationSeq ?? 0) + step;
}

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable");
    return true;
  }
  return false;
}

function hb(sessionId: string, deviceId: string, overrides: Record<string, unknown> = {}) {
  return {
    sessionId,
    deviceId,
    timestamp: new Date(),
    appState: "foreground" as const,
    platform: "android" as const,
    ...overrides,
  };
}

describe.serial("Partner presence — Phase 1 integration", () => {
  test("heartbeat success persists Postgres + Redis", async () => {
    if (skipIfNoDb()) return;
    await resetPresence();

    const result = await partnerPresenceService.heartbeat(
      { providerId: ctx.providerId, userId: ctx.vendorUserId },
      hb(sessionIdB, deviceB, {
        location: {
          latitude: 28.6139,
          longitude: 77.209,
          accuracy: 12,
          capturedAt: new Date(),
          sequence: await nextSequence(),
        },
      }),
    );

    expect(result.accepted).toBe(true);
    expect(result.snapshot.presenceFreshness).toBe("FRESH");
    expect(result.snapshot.location).not.toBeNull();

    const row = await prisma.partnerPresence.findUnique({ where: { providerId: ctx.providerId } });
    expect(row?.activeSessionId).toBe(sessionIdB);
    expect(row?.lastHeartbeatAt).not.toBeNull();

    const provider = await prisma.provider.findUnique({ where: { id: ctx.providerId } });
    expect(provider?.lastSeenAt).not.toBeNull();

    const loc = await prisma.location.findUnique({ where: { providerId: ctx.providerId } });
    expect(loc?.latitude).toBeCloseTo(28.6139, 3);

    expect(await partnerPresenceService.isRedisLive(ctx.providerId)).toBe(true);
  });

  test("stale session A rejected after session B promoted", async () => {
    if (skipIfNoDb()) return;

    await expect(
      partnerPresenceService.heartbeat(
        { providerId: ctx.providerId, userId: ctx.vendorUserId },
        hb(sessionIdA, deviceA),
      ),
    ).rejects.toMatchObject({ code: "STALE_SESSION" });
  });

  test("invalid session rejected", async () => {
    if (skipIfNoDb()) return;

    await expect(
      partnerPresenceService.heartbeat(
        { providerId: ctx.providerId, userId: ctx.vendorUserId },
        hb("nonexistent-session-id", deviceB),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  test("device mismatch rejected", async () => {
    if (skipIfNoDb()) return;

    await expect(
      partnerPresenceService.heartbeat(
        { providerId: ctx.providerId, userId: ctx.vendorUserId },
        hb(sessionIdB, "wrong-device"),
      ),
    ).rejects.toMatchObject({ code: "DEVICE_MISMATCH" });
  });

  test("future timestamp rejected", async () => {
    if (skipIfNoDb()) return;

    await expect(
      partnerPresenceService.heartbeat(
        { providerId: ctx.providerId, userId: ctx.vendorUserId },
        hb(sessionIdB, deviceB, { timestamp: new Date(Date.now() + 120_000) }),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  test("bad coordinates rejected", async () => {
    if (skipIfNoDb()) return;

    await expect(
      partnerPresenceService.heartbeat(
        { providerId: ctx.providerId, userId: ctx.vendorUserId },
        hb(sessionIdB, deviceB, {
          location: { latitude: 0, longitude: 0, capturedAt: new Date() },
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  test("reconnect with same active session succeeds", async () => {
    if (skipIfNoDb()) return;

    const result = await partnerPresenceService.heartbeat(
      { providerId: ctx.providerId, userId: ctx.vendorUserId },
      hb(sessionIdB, deviceB),
    );
    expect(result.accepted).toBe(true);
  });

  test("presence failure does not mutate lifecycle or job axes", async () => {
    if (skipIfNoDb()) return;

    const before = await prisma.provider.findUnique({
      where: { id: ctx.providerId },
      select: { lifecycleState: true, isOnline: true, currentStatus: true },
    });

    await expect(
      partnerPresenceService.heartbeat(
        { providerId: ctx.providerId, userId: ctx.vendorUserId },
        hb(sessionIdA, deviceA),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const after = await prisma.provider.findUnique({
      where: { id: ctx.providerId },
      select: { lifecycleState: true, isOnline: true, currentStatus: true },
    });
    expect(after?.lifecycleState).toBe(before?.lifecycleState);
    expect(after?.isOnline).toBe(before?.isOnline);
    expect(after?.currentStatus).toBe(before?.currentStatus);
  });

  test("wrong partner cannot heartbeat for another provider", async () => {
    if (skipIfNoDb()) return;

    const otherVendor = await prisma.user.create({
      data: {
        ...provenanceForNewUser(`${RUN_ID}-other@adv.test`),
        email: `${RUN_ID}-other@adv.test`,
        phoneNumber: `+9199${Math.floor(Math.random() * 1e8)}`,
        firstName: "Other",
        lastName: "Vendor",
        password: "x".repeat(20),
        role: UserRole.VENDOR,
      },
    });
    const otherProvider = await prisma.provider.create({
      data: { userId: otherVendor.id, isApproved: true, lifecycleState: "ACTIVE" },
    });
    const otherTokens = await refreshTokenService.createSessionTokens({
      userId: otherVendor.id,
      email: otherVendor.email!,
      deviceId: `other-${RUN_ID}`,
    });

    // Attempt to use ctx.providerId with other user's credentials — ownership guard
    await expect(
      partnerPresenceService.heartbeat(
        { providerId: ctx.providerId, userId: otherVendor.id },
        hb(otherTokens.sessionId, `other-${RUN_ID}`),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await prisma.partnerPresence.deleteMany({ where: { providerId: otherProvider.id } }).catch(() => {});
    await prisma.provider.delete({ where: { id: otherProvider.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: otherVendor.id } }).catch(() => {});
  });

  test("FRESH → STALE → EXPIRED derived boundaries", () => {
    const now = new Date();
    const fresh = new Date(now.getTime() - PRESENCE_FRESH_SEC * 1000);
    const stale = new Date(now.getTime() - (PRESENCE_FRESH_SEC + 5) * 1000);
    const expired = new Date(now.getTime() - (PRESENCE_STALE_SEC + 5) * 1000);

    expect(derivePresenceFreshness({ lastHeartbeatAt: fresh, now })).toBe("FRESH");
    expect(derivePresenceFreshness({ lastHeartbeatAt: stale, now })).toBe("STALE");
    expect(derivePresenceFreshness({ lastHeartbeatAt: expired, now })).toBe("EXPIRED");
  });

  test("Redis TTL config is bounded and configurable", () => {
    expect(PRESENCE_REDIS_TTL_SEC).toBeGreaterThanOrEqual(60);
    expect(PRESENCE_REDIS_TTL_SEC).toBeLessThanOrEqual(300);
  });

  test("availability toggle independent of presence heartbeat", async () => {
    if (skipIfNoDb()) return;

    await partnerOperationsService.setOnline(ctx.providerId, true);
    const snap = await partnerPresenceService.getSnapshot(ctx.providerId);
    expect(snap.operationallyLive).toBe(true);

    await partnerOperationsService.setOnline(ctx.providerId, false);
    const off = await partnerPresenceService.getSnapshot(ctx.providerId);
    expect(off.operationallyLive).toBe(false);
  });

  test("rate limiting rejects flood", async () => {
    if (skipIfNoDb()) return;

    let hitLimit = false;
    for (let i = 0; i < 20; i++) {
      try {
        await partnerPresenceService.heartbeat(
          { providerId: ctx.providerId, userId: ctx.vendorUserId },
          hb(sessionIdB, deviceB),
        );
      } catch (e) {
        if (e instanceof RateLimitError) {
          hitLimit = true;
          break;
        }
        throw e;
      }
    }
    expect(hitLimit).toBe(true);
  });
});

describe("Partner presence — failure simulation (no axis contamination)", () => {
  test("duplicate location heartbeat accepted without Location write amplification", async () => {
    if (skipIfNoDb()) return;
    await resetPresence();

    const lat = 28.6139;
    const lng = 77.209;
    const capturedAt = new Date();

    await partnerPresenceService.heartbeat(
      { providerId: ctx.providerId, userId: ctx.vendorUserId },
      hb(sessionIdB, deviceB, {
        location: { latitude: lat, longitude: lng, capturedAt, sequence: await nextSequence() },
      }),
    );

    const countBefore = await prisma.location.count({ where: { providerId: ctx.providerId } });

    const dup = await partnerPresenceService.heartbeat(
      { providerId: ctx.providerId, userId: ctx.vendorUserId },
      hb(sessionIdB, deviceB, {
        location: {
          latitude: lat,
          longitude: lng,
          capturedAt: new Date(capturedAt.getTime() + 1000),
          // Strictly after the heartbeat above — the duplicate-location check is what is under test,
          // not sequence handling, so this must advance rather than collide.
          sequence: await nextSequence(),
        },
      }),
    );

    expect(dup.duplicate).toBe(true);
    const countAfter = await prisma.location.count({ where: { providerId: ctx.providerId } });
    expect(countAfter).toBe(countBefore);
  });

  test("location ping stores capturedAt AND receivedAt separately", async () => {
    if (skipIfNoDb()) return;

    /**
     * Age the PREVIOUS fix before pinging.
     *
     * The anti-spoofing gate divides distance by elapsed time, so a 2 m move measured against a fix
     * from the same second implies an impossible speed and is rejected. The previous fix's age is
     * part of this test's premise and is therefore set, not inherited from whatever ran before.
     */
    await prisma.partnerPresence.updateMany({
      where: { providerId: ctx.providerId },
      data: { lastLocationAt: new Date(Date.now() - 60_000) },
    });

    const last = await prisma.partnerPresence.findUnique({
      where: { providerId: ctx.providerId },
      select: {
        lastHeartbeatAt: true,
        lastLocationAt: true,
        lastLocationLat: true,
        lastLocationLng: true,
        lastLocationSeq: true,
      },
    });
    /**
     * Captured deliberately in the past, which is what a real fix is: a device reads GPS, then
     * transmits. This read `Math.max(Date.now(), lastLocationAt + 1)`, so when no recent location
     * existed it became `Date.now()` — and the assertion below that receivedAt differs from
     * capturedAt then depended on at least one millisecond elapsing inside the service. It passed
     * only because an earlier test happened to leave a location behind that pushed capturedAt into
     * the past; once that state was cleared the two timestamps landed in the same millisecond and
     * the test failed. The gap is now stated rather than raced for.
     */
    const CAPTURE_LAG_MS = 2_000;
    const capturedAt = new Date(
      Math.max(Date.now() - CAPTURE_LAG_MS, (last?.lastLocationAt?.getTime() ?? 0) + 1),
    );
    const beforeHeartbeat = last?.lastHeartbeatAt?.toISOString() ?? null;

    const pinged = await partnerPresenceService.locationPing(
      { providerId: ctx.providerId, userId: ctx.vendorUserId },
      {
        sessionId: sessionIdB,
        deviceId: deviceB,
        location: {
          latitude: (last?.lastLocationLat ?? 28.6139) + 0.00002,
          longitude: last?.lastLocationLng ?? 77.209,
          accuracy: 12,
          capturedAt,
          sequence: (last?.lastLocationSeq ?? 0) + 1,
        },
      },
    );

    expect(pinged.accepted).toBe(true);
    expect(pinged.snapshot.location?.capturedAt).toBe(capturedAt.toISOString());
    expect(pinged.snapshot.location?.receivedAt).toBeTruthy();
    expect(pinged.snapshot.location?.receivedAt).not.toBe(pinged.snapshot.location?.capturedAt);

    const after = await prisma.partnerPresence.findUnique({
      where: { providerId: ctx.providerId },
      select: { lastHeartbeatAt: true, lastLocationAt: true, lastLocationReceivedAt: true },
    });
    // Location ping must not masquerade as a heartbeat — presence freshness stays independent.
    expect(after?.lastHeartbeatAt?.toISOString() ?? null).toBe(beforeHeartbeat);
    expect(after?.lastLocationAt?.toISOString()).toBe(capturedAt.toISOString());
    expect(after?.lastLocationReceivedAt).not.toBeNull();
  });
});
